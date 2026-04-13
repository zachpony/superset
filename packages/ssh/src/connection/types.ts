export interface SSHHostConfig {
	host: string;
	port: number;
	username: string;
	privateKeyPath?: string;
	passphrase?: string;
	password?: string;
	forwardAgent: boolean;
	strictHostKeyChecking: "yes" | "no" | "accept-new";
	proxyJump?: string;
	connectTimeout: number;
	keepaliveInterval: number;
	keepaliveCountMax: number;
}

export interface SSHConnectionOptions {
	id: string;
	config: SSHHostConfig;
	onDisconnect?: (id: string, reason: string) => void;
	onReconnecting?: (id: string, attempt: number) => void;
	onReconnected?: (id: string) => void;
}

export const DEFAULT_SSH_CONFIG: Omit<SSHHostConfig, "host" | "username"> = {
	port: 22,
	forwardAgent: true,
	strictHostKeyChecking: "accept-new",
	connectTimeout: 30_000,
	keepaliveInterval: 15_000,
	keepaliveCountMax: 3,
};
