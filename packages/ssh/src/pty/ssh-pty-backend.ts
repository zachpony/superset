import type { ClientChannel } from "ssh2";
import type { SSHConnectionPool } from "../connection/connection-pool";

export interface SSHPtyOptions {
	connectionId: string;
	cols: number;
	rows: number;
	term?: string;
	cwd?: string;
	env?: Record<string, string>;
	shell?: string;
}

export interface SSHPtyEvents {
	onData: (data: string) => void;
	onExit: (code: number) => void;
}

export class SSHPtyBackend {
	private channel: ClientChannel | null = null;
	private exited = false;

	constructor(
		private readonly pool: SSHConnectionPool,
		private readonly options: SSHPtyOptions,
		private readonly events: SSHPtyEvents,
	) {}

	async spawn(): Promise<void> {
		const { connectionId, cols, rows, term, cwd, env, shell } = this.options;

		this.channel = await this.pool.shell(connectionId, {
			cols,
			rows,
			term: term ?? "xterm-256color",
		});

		this.channel.on("data", (data: Buffer) => {
			this.events.onData(data.toString("utf-8"));
		});

		this.channel.stderr.on("data", (data: Buffer) => {
			this.events.onData(data.toString("utf-8"));
		});

		this.channel.on("close", (code: number) => {
			this.exited = true;
			this.events.onExit(code ?? 0);
		});

		this.channel.on("exit", (code: number) => {
			this.exited = true;
			this.events.onExit(code ?? 0);
		});

		// Set up initial working directory and environment
		const initCommands: string[] = [];

		if (env) {
			for (const [key, value] of Object.entries(env)) {
				const escaped = value.replace(/'/g, "'\\''");
				initCommands.push(`export ${key}='${escaped}'`);
			}
		}

		if (cwd) {
			initCommands.push(`cd ${JSON.stringify(cwd)}`);
		}

		if (shell && shell !== process.env.SHELL) {
			initCommands.push(`exec ${shell}`);
		}

		if (initCommands.length > 0) {
			// Send init commands silently, clearing the terminal afterwards
			const initScript = `${initCommands.join(" && ")} && clear\n`;
			this.channel.write(initScript);
		}
	}

	write(data: string): void {
		if (this.channel && !this.exited) {
			this.channel.write(data);
		}
	}

	resize(cols: number, rows: number): void {
		if (this.channel && !this.exited) {
			this.channel.setWindow(rows, cols, 0, 0);
		}
	}

	kill(signal?: string): void {
		if (this.channel && !this.exited) {
			if (signal) {
				this.channel.signal(signal);
			} else {
				this.channel.close();
			}
		}
	}

	isAlive(): boolean {
		return !this.exited && this.channel !== null;
	}

	destroy(): void {
		if (this.channel) {
			this.channel.destroy();
			this.channel = null;
		}
		this.exited = true;
	}
}
