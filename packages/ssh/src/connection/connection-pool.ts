import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ClientChannel, SFTPWrapper } from "ssh2";
import { Client } from "ssh2";
import type { SSHConnectionOptions, SSHHostConfig } from "./types";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;

interface PooledConnection {
	id: string;
	client: Client;
	config: SSHHostConfig;
	state: "connecting" | "connected" | "disconnected" | "reconnecting";
	reconnectAttempts: number;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	options: SSHConnectionOptions;
}

export class SSHConnectionPool {
	private connections = new Map<string, PooledConnection>();

	async connect(options: SSHConnectionOptions): Promise<void> {
		if (this.connections.has(options.id)) {
			const existing = this.connections.get(options.id);
			if (existing?.state === "connected") return;
			await this.disconnect(options.id);
		}

		const client = new Client();
		const entry: PooledConnection = {
			id: options.id,
			client,
			config: options.config,
			state: "connecting",
			reconnectAttempts: 0,
			reconnectTimer: null,
			options,
		};
		this.connections.set(options.id, entry);

		await this.establishConnection(entry);
	}

	private async establishConnection(entry: PooledConnection): Promise<void> {
		return new Promise((resolve, reject) => {
			const { config } = entry;

			entry.client.on("ready", () => {
				entry.state = "connected";
				entry.reconnectAttempts = 0;
				if (entry.options.onReconnected && entry.reconnectAttempts > 0) {
					entry.options.onReconnected(entry.id);
				}
				resolve();
			});

			entry.client.on("error", (err) => {
				if (entry.state === "connecting") {
					reject(err);
				}
			});

			entry.client.on("end", () => {
				if (entry.state === "connected") {
					entry.state = "disconnected";
					entry.options.onDisconnect?.(entry.id, "connection ended");
					this.scheduleReconnect(entry);
				}
			});

			entry.client.on("close", () => {
				if (entry.state === "connected") {
					entry.state = "disconnected";
					entry.options.onDisconnect?.(entry.id, "connection closed");
					this.scheduleReconnect(entry);
				}
			});

			const connectConfig: Record<string, unknown> = {
				host: config.host,
				port: config.port,
				username: config.username,
				readyTimeout: config.connectTimeout,
				keepaliveInterval: config.keepaliveInterval,
				keepaliveCountMax: config.keepaliveCountMax,
				agent: config.forwardAgent ? process.env.SSH_AUTH_SOCK : undefined,
			};

			if (config.privateKeyPath) {
				const expandedPath = resolve(
					config.privateKeyPath.replace(/^~/, homedir()),
				);
				try {
					connectConfig.privateKey = readFileSync(expandedPath);
					if (config.passphrase) {
						connectConfig.passphrase = config.passphrase;
					}
				} catch {
					reject(
						new Error(`Failed to read private key: ${expandedPath}`),
					);
					return;
				}
			} else if (config.password) {
				connectConfig.password = config.password;
			}

			entry.client.connect(connectConfig as Parameters<Client["connect"]>[0]);
		});
	}

	private scheduleReconnect(entry: PooledConnection): void {
		if (entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			entry.state = "disconnected";
			return;
		}

		entry.state = "reconnecting";
		entry.reconnectAttempts++;
		entry.options.onReconnecting?.(entry.id, entry.reconnectAttempts);

		const delay = RECONNECT_BASE_DELAY_MS * 2 ** (entry.reconnectAttempts - 1);
		entry.reconnectTimer = setTimeout(async () => {
			entry.client = new Client();
			try {
				await this.establishConnection(entry);
			} catch {
				this.scheduleReconnect(entry);
			}
		}, delay);
	}

	getClient(id: string): Client {
		const entry = this.connections.get(id);
		if (!entry || entry.state !== "connected") {
			throw new Error(
				`SSH connection ${id} is not available (state: ${entry?.state ?? "not found"})`,
			);
		}
		return entry.client;
	}

	getState(id: string): PooledConnection["state"] | "not_found" {
		return this.connections.get(id)?.state ?? "not_found";
	}

	async exec(
		id: string,
		command: string,
	): Promise<{ stdout: string; stderr: string; code: number }> {
		const client = this.getClient(id);
		return new Promise((resolve, reject) => {
			client.exec(command, (err, channel) => {
				if (err) return reject(err);
				let stdout = "";
				let stderr = "";
				channel.on("data", (data: Buffer) => {
					stdout += data.toString();
				});
				channel.stderr.on("data", (data: Buffer) => {
					stderr += data.toString();
				});
				channel.on("close", (code: number) => {
					resolve({ stdout, stderr, code: code ?? 0 });
				});
			});
		});
	}

	async shell(
		id: string,
		options?: { cols?: number; rows?: number; term?: string },
	): Promise<ClientChannel> {
		const client = this.getClient(id);
		return new Promise((resolve, reject) => {
			client.shell(
				{
					cols: options?.cols ?? 80,
					rows: options?.rows ?? 24,
					term: options?.term ?? "xterm-256color",
				},
				(err, channel) => {
					if (err) return reject(err);
					resolve(channel);
				},
			);
		});
	}

	async sftp(id: string): Promise<SFTPWrapper> {
		const client = this.getClient(id);
		return new Promise((resolve, reject) => {
			client.sftp((err, sftp) => {
				if (err) return reject(err);
				resolve(sftp);
			});
		});
	}

	async disconnect(id: string): Promise<void> {
		const entry = this.connections.get(id);
		if (!entry) return;

		if (entry.reconnectTimer) {
			clearTimeout(entry.reconnectTimer);
		}
		entry.state = "disconnected";
		entry.client.end();
		this.connections.delete(id);
	}

	async disconnectAll(): Promise<void> {
		const ids = Array.from(this.connections.keys());
		await Promise.all(ids.map((id) => this.disconnect(id)));
	}

	listConnections(): Array<{
		id: string;
		host: string;
		state: PooledConnection["state"];
	}> {
		return Array.from(this.connections.values()).map((entry) => ({
			id: entry.id,
			host: `${entry.config.username}@${entry.config.host}:${entry.config.port}`,
			state: entry.state,
		}));
	}
}
