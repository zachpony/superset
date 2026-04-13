import type { SFTPWrapper, Stats } from "ssh2";
import type { SSHConnectionPool } from "../connection/connection-pool";
import type {
	FsEntry,
	FsEntryKind,
	FsMetadata,
	FsReadResult,
	FsWriteResult,
	FsSearchMatch,
	FsContentMatch,
	FsWatchEvent,
} from "@superset/workspace-fs/core";

const MAX_READ_BYTES = 10 * 1024 * 1024; // 10MB default limit
const WATCH_POLL_INTERVAL_MS = 2_000;

function statsToKind(stats: Stats): FsEntryKind {
	if (stats.isDirectory()) return "directory";
	if (stats.isSymbolicLink()) return "symlink";
	if (stats.isFile()) return "file";
	return "other";
}

function makeRevision(stats: Stats): string {
	return `${stats.mtime}:${stats.size}`;
}

function permissionsString(mode: number): string {
	const perms = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
	const owner = perms[(mode >> 6) & 7];
	const group = perms[(mode >> 3) & 7];
	const other = perms[mode & 7];
	return `${owner}${group}${other}`;
}

export class SftpFsService {
	private sftpCache: SFTPWrapper | null = null;
	private watchIntervals = new Map<string, ReturnType<typeof setInterval>>();

	constructor(
		private readonly pool: SSHConnectionPool,
		private readonly connectionId: string,
		private readonly rootPath: string,
	) {}

	private async getSftp(): Promise<SFTPWrapper> {
		if (this.sftpCache) return this.sftpCache;
		this.sftpCache = await this.pool.sftp(this.connectionId);
		return this.sftpCache;
	}

	private resolvePath(absolutePath: string): string {
		if (!absolutePath.startsWith(this.rootPath)) {
			throw new Error(
				`Path ${absolutePath} is outside root ${this.rootPath}`,
			);
		}
		return absolutePath;
	}

	async listDirectory(input: {
		absolutePath: string;
	}): Promise<{ entries: FsEntry[] }> {
		const sftp = await this.getSftp();
		const resolvedPath = this.resolvePath(input.absolutePath);

		return new Promise((resolve, reject) => {
			sftp.readdir(resolvedPath, (err, list) => {
				if (err) return reject(err);
				const entries: FsEntry[] = list
					.filter((item) => !item.filename.startsWith("."))
					.map((item) => ({
						absolutePath: `${resolvedPath}/${item.filename}`,
						name: item.filename,
						kind: statsToKind(item.attrs as unknown as Stats),
					}))
					.sort((a, b) => {
						if (a.kind === "directory" && b.kind !== "directory")
							return -1;
						if (a.kind !== "directory" && b.kind === "directory")
							return 1;
						return a.name.localeCompare(b.name);
					});
				resolve({ entries });
			});
		});
	}

	async readFile(input: {
		absolutePath: string;
		offset?: number;
		maxBytes?: number;
		encoding?: string;
	}): Promise<FsReadResult> {
		const sftp = await this.getSftp();
		const resolvedPath = this.resolvePath(input.absolutePath);
		const maxBytes = input.maxBytes ?? MAX_READ_BYTES;

		const stats = await this.statPath(sftp, resolvedPath);
		if (!stats) throw new Error(`File not found: ${resolvedPath}`);

		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let totalBytes = 0;
			const offset = input.offset ?? 0;

			const stream = sftp.createReadStream(resolvedPath, {
				start: offset,
				end: offset + maxBytes - 1,
			});

			stream.on("data", (chunk: Buffer) => {
				chunks.push(chunk);
				totalBytes += chunk.length;
			});

			stream.on("end", () => {
				const buffer = Buffer.concat(chunks);
				const exceededLimit = stats.size > offset + maxBytes;

				resolve({
					kind: "text",
					content: buffer.toString(
						(input.encoding as BufferEncoding) ?? "utf-8",
					),
					byteLength: totalBytes,
					exceededLimit,
					revision: makeRevision(stats),
				});
			});

			stream.on("error", reject);
		});
	}

	async getMetadata(input: {
		absolutePath: string;
	}): Promise<FsMetadata | null> {
		const sftp = await this.getSftp();
		const resolvedPath = this.resolvePath(input.absolutePath);
		const stats = await this.statPath(sftp, resolvedPath);
		if (!stats) return null;

		return {
			absolutePath: resolvedPath,
			kind: statsToKind(stats),
			size: stats.size,
			createdAt: null,
			modifiedAt: new Date(stats.mtime * 1000).toISOString(),
			accessedAt: new Date(stats.atime * 1000).toISOString(),
			mode: stats.mode,
			permissions: permissionsString(stats.mode & 0o777),
			owner: String(stats.uid),
			group: String(stats.gid),
			symlinkTarget: undefined,
			revision: makeRevision(stats),
		};
	}

	async writeFile(input: {
		absolutePath: string;
		content: string | Uint8Array;
		encoding?: string;
		options?: { create: boolean; overwrite: boolean };
		precondition?: { ifMatch: string };
	}): Promise<FsWriteResult> {
		const sftp = await this.getSftp();
		const resolvedPath = this.resolvePath(input.absolutePath);

		if (input.precondition?.ifMatch) {
			const stats = await this.statPath(sftp, resolvedPath);
			if (stats && makeRevision(stats) !== input.precondition.ifMatch) {
				return {
					ok: false,
					reason: "conflict",
					currentRevision: makeRevision(stats),
				};
			}
		}

		const exists = !!(await this.statPath(sftp, resolvedPath));
		if (exists && !input.options?.overwrite) {
			return { ok: false, reason: "exists" };
		}
		if (!exists && !input.options?.create) {
			return { ok: false, reason: "not-found" };
		}

		const data =
			typeof input.content === "string"
				? Buffer.from(input.content, (input.encoding as BufferEncoding) ?? "utf-8")
				: Buffer.from(input.content);

		// Atomic write: write to temp file then rename
		const tmpPath = `${resolvedPath}.tmp.${Date.now()}`;

		return new Promise((resolve, reject) => {
			const stream = sftp.createWriteStream(tmpPath);
			stream.on("error", reject);
			stream.end(data, () => {
				sftp.rename(tmpPath, resolvedPath, async (err) => {
					if (err) {
						sftp.unlink(tmpPath, () => {});
						return reject(err);
					}
					const newStats = await this.statPath(sftp, resolvedPath);
					resolve({
						ok: true,
						revision: newStats ? makeRevision(newStats) : "unknown",
					});
				});
			});
		});
	}

	async createDirectory(input: {
		absolutePath: string;
		recursive?: boolean;
	}): Promise<{ absolutePath: string; kind: "directory" }> {
		const resolvedPath = this.resolvePath(input.absolutePath);

		if (input.recursive) {
			await this.pool.exec(
				this.connectionId,
				`mkdir -p ${JSON.stringify(resolvedPath)}`,
			);
		} else {
			const sftp = await this.getSftp();
			await new Promise<void>((resolve, reject) => {
				sftp.mkdir(resolvedPath, (err) => {
					if (err) return reject(err);
					resolve();
				});
			});
		}

		return { absolutePath: resolvedPath, kind: "directory" };
	}

	async deletePath(input: {
		absolutePath: string;
		permanent?: boolean;
	}): Promise<{ absolutePath: string }> {
		const resolvedPath = this.resolvePath(input.absolutePath);
		await this.pool.exec(
			this.connectionId,
			`rm -rf ${JSON.stringify(resolvedPath)}`,
		);
		return { absolutePath: resolvedPath };
	}

	async movePath(input: {
		sourceAbsolutePath: string;
		destinationAbsolutePath: string;
	}): Promise<{ fromAbsolutePath: string; toAbsolutePath: string }> {
		const sftp = await this.getSftp();
		const src = this.resolvePath(input.sourceAbsolutePath);
		const dst = this.resolvePath(input.destinationAbsolutePath);

		await new Promise<void>((resolve, reject) => {
			sftp.rename(src, dst, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});

		return { fromAbsolutePath: src, toAbsolutePath: dst };
	}

	async copyPath(input: {
		sourceAbsolutePath: string;
		destinationAbsolutePath: string;
	}): Promise<{ fromAbsolutePath: string; toAbsolutePath: string }> {
		const src = this.resolvePath(input.sourceAbsolutePath);
		const dst = this.resolvePath(input.destinationAbsolutePath);
		await this.pool.exec(
			this.connectionId,
			`cp -r ${JSON.stringify(src)} ${JSON.stringify(dst)}`,
		);
		return { fromAbsolutePath: src, toAbsolutePath: dst };
	}

	async searchFiles(input: {
		query: string;
		includeHidden?: boolean;
		includePattern?: string;
		excludePattern?: string;
		limit?: number;
	}): Promise<{ matches: FsSearchMatch[] }> {
		const limit = input.limit ?? 100;
		const hiddenFlag = input.includeHidden ? "" : '-not -path "*/.*"';
		const nameFilter = input.query ? `-iname "*${input.query}*"` : "";
		const cmd = `find ${JSON.stringify(this.rootPath)} ${hiddenFlag} ${nameFilter} -maxdepth 10 2>/dev/null | head -n ${limit}`;

		const { stdout } = await this.pool.exec(this.connectionId, cmd);

		const matches: FsSearchMatch[] = stdout
			.split("\n")
			.filter(Boolean)
			.map((line, idx) => ({
				absolutePath: line,
				relativePath: line.replace(`${this.rootPath}/`, ""),
				name: line.split("/").pop() ?? "",
				kind: "file" as FsEntryKind,
				score: 1 - idx / limit,
			}));

		return { matches };
	}

	async searchContent(input: {
		query: string;
		includeHidden?: boolean;
		includePattern?: string;
		excludePattern?: string;
		limit?: number;
	}): Promise<{ matches: FsContentMatch[] }> {
		const limit = input.limit ?? 100;
		const hiddenFlag = input.includeHidden ? "--hidden" : "";
		const cmd = `cd ${JSON.stringify(this.rootPath)} && rg --line-number --column --no-heading ${hiddenFlag} -m ${limit} ${JSON.stringify(input.query)} 2>/dev/null || grep -rn ${JSON.stringify(input.query)} . 2>/dev/null | head -n ${limit}`;

		const { stdout } = await this.pool.exec(this.connectionId, cmd);

		const matches: FsContentMatch[] = stdout
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const parts = line.split(":");
				const file = parts[0] ?? "";
				const lineNum = Number.parseInt(parts[1] ?? "1", 10);
				const col = Number.parseInt(parts[2] ?? "1", 10);
				const preview = parts.slice(3).join(":");

				return {
					absolutePath: file.startsWith("/")
						? file
						: `${this.rootPath}/${file}`,
					relativePath: file.startsWith("./")
						? file.substring(2)
						: file,
					line: lineNum,
					column: col,
					preview: preview.trim(),
				};
			});

		return { matches };
	}

	async *watchPath(input: {
		absolutePath: string;
		recursive?: boolean;
	}): AsyncIterable<{ events: FsWatchEvent[] }> {
		const resolvedPath = this.resolvePath(input.absolutePath);
		const sftp = await this.getSftp();
		let lastSnapshot = await this.buildSnapshot(sftp, resolvedPath);

		const pollId = `${this.connectionId}:${resolvedPath}`;

		while (true) {
			await new Promise((resolve) =>
				setTimeout(resolve, WATCH_POLL_INTERVAL_MS),
			);

			try {
				const currentSnapshot = await this.buildSnapshot(
					sftp,
					resolvedPath,
				);
				const events = this.diffSnapshots(lastSnapshot, currentSnapshot);
				lastSnapshot = currentSnapshot;

				if (events.length > 0) {
					yield { events };
				}
			} catch {
				yield {
					events: [
						{ kind: "overflow", absolutePath: resolvedPath },
					],
				};
			}
		}
	}

	private async buildSnapshot(
		sftp: SFTPWrapper,
		dirPath: string,
	): Promise<Map<string, number>> {
		return new Promise((resolve) => {
			const snapshot = new Map<string, number>();
			sftp.readdir(dirPath, (err, list) => {
				if (err) return resolve(snapshot);
				for (const item of list) {
					snapshot.set(
						`${dirPath}/${item.filename}`,
						item.attrs.mtime,
					);
				}
				resolve(snapshot);
			});
		});
	}

	private diffSnapshots(
		prev: Map<string, number>,
		curr: Map<string, number>,
	): FsWatchEvent[] {
		const events: FsWatchEvent[] = [];

		for (const [path, mtime] of curr) {
			if (!prev.has(path)) {
				events.push({ kind: "create", absolutePath: path });
			} else if (prev.get(path) !== mtime) {
				events.push({ kind: "update", absolutePath: path });
			}
		}

		for (const [path] of prev) {
			if (!curr.has(path)) {
				events.push({ kind: "delete", absolutePath: path });
			}
		}

		return events;
	}

	private async statPath(
		sftp: SFTPWrapper,
		path: string,
	): Promise<Stats | null> {
		return new Promise((resolve) => {
			sftp.stat(path, (err, stats) => {
				if (err) return resolve(null);
				resolve(stats);
			});
		});
	}

	async close(): Promise<void> {
		for (const interval of this.watchIntervals.values()) {
			clearInterval(interval);
		}
		this.watchIntervals.clear();
		this.sftpCache = null;
	}
}
