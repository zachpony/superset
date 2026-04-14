import { SSHConnectionPool } from "@superset/ssh/connection";
import { SftpFsService } from "@superset/ssh/fs";
import {
	createFsHostService,
	type FsHostService,
	FsWatcherManager,
	getSearchIndex,
} from "@superset/workspace-fs/host";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db";
import { sshHosts, workspaces } from "../../db/schema";

export interface WorkspaceFilesystemManagerOptions {
	db: HostDb;
}

export class WorkspaceFilesystemManager {
	private readonly db: HostDb;
	private readonly watcherManager = new FsWatcherManager();
	private readonly serviceCache = new Map<string, FsHostService>();
	private static sshPool: SSHConnectionPool | null = null;

	constructor(options: WorkspaceFilesystemManagerOptions) {
		this.db = options.db;
	}

	private static getSSHPool(): SSHConnectionPool {
		if (!WorkspaceFilesystemManager.sshPool) {
			WorkspaceFilesystemManager.sshPool = new SSHConnectionPool();
		}
		return WorkspaceFilesystemManager.sshPool;
	}

	private lookupWorkspace(workspaceId: string) {
		const workspace = this.db.query.workspaces
			.findFirst({ where: eq(workspaces.id, workspaceId) })
			.sync();

		if (!workspace) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		return workspace;
	}

	resolveWorkspaceRoot(workspaceId: string): string {
		const workspace = this.lookupWorkspace(workspaceId);

		if (workspace.executionMode === "ssh") {
			if (!workspace.remotePath) {
				throw new Error("SSH workspace has no remotePath configured");
			}
			return workspace.remotePath;
		}

		if (!workspace.worktreePath) {
			throw new Error("Local workspace has no worktree path");
		}
		return workspace.worktreePath;
	}

	getServiceForWorkspace(workspaceId: string): FsHostService {
		const workspace = this.lookupWorkspace(workspaceId);

		if (workspace.executionMode === "ssh") {
			return this.getSSHServiceForWorkspace(workspace);
		}

		return this.getLocalServiceForWorkspace(workspace);
	}

	private getLocalServiceForWorkspace(workspace: {
		worktreePath: string | null;
	}): FsHostService {
		const rootPath = workspace.worktreePath;
		if (!rootPath) {
			throw new Error("Local workspace has no worktree path");
		}

		let service = this.serviceCache.get(rootPath);
		if (!service) {
			service = createFsHostService({
				rootPath,
				watcherManager: this.watcherManager,
			});
			this.serviceCache.set(rootPath, service);
			getSearchIndex({ rootPath, includeHidden: false }).catch(() => {});
		}
		return service;
	}

	private getSSHServiceForWorkspace(workspace: {
		sshHostId: string | null;
		remotePath: string | null;
	}): FsHostService {
		if (!workspace.sshHostId) {
			throw new Error("SSH workspace has no sshHostId configured");
		}
		if (!workspace.remotePath) {
			throw new Error("SSH workspace has no remotePath configured");
		}

		const cacheKey = `ssh:${workspace.sshHostId}:${workspace.remotePath}`;
		let service = this.serviceCache.get(cacheKey);
		if (!service) {
			const host = this.db.query.sshHosts
				.findFirst({ where: eq(sshHosts.id, workspace.sshHostId) })
				.sync();

			if (!host) {
				throw new Error(`SSH host not found: ${workspace.sshHostId}`);
			}

			const pool = WorkspaceFilesystemManager.getSSHPool();
			const connectionId = host.id;

			if (pool.getState(connectionId) === "not_found") {
				pool
					.connect({
						id: connectionId,
						config: {
							host: host.host,
							port: host.port,
							username: host.username,
							privateKeyPath: host.privateKeyPath ?? undefined,
							forwardAgent: host.forwardAgent === 1,
							connectTimeout: host.connectTimeout,
							keepaliveInterval: host.keepaliveInterval,
							keepaliveCountMax: 3,
							strictHostKeyChecking: "accept-new",
						},
					})
					.catch((err) => {
						console.error(
							`[filesystem] SSH connection failed for host ${connectionId}:`,
							err,
						);
					});
			}

			service = new SftpFsService(
				pool,
				connectionId,
				workspace.remotePath,
			) as unknown as FsHostService;
			this.serviceCache.set(cacheKey, service);
		}
		return service;
	}

	async close(): Promise<void> {
		this.serviceCache.clear();
		await this.watcherManager.close();
		if (WorkspaceFilesystemManager.sshPool) {
			await WorkspaceFilesystemManager.sshPool.disconnectAll();
			WorkspaceFilesystemManager.sshPool = null;
		}
	}
}
