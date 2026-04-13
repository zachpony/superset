import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SSHHostConfig } from "../connection/types";
import { DEFAULT_SSH_CONFIG } from "../connection/types";

interface SSHConfigBlock {
	host: string;
	hostname?: string;
	port?: number;
	user?: string;
	identityFile?: string;
	forwardAgent?: boolean;
	proxyJump?: string;
	strictHostKeyChecking?: string;
	connectTimeout?: number;
	serverAliveInterval?: number;
	serverAliveCountMax?: number;
}

export function parseSSHConfig(
	configPath?: string,
): Map<string, SSHConfigBlock> {
	const path = configPath ?? join(homedir(), ".ssh", "config");
	if (!existsSync(path)) return new Map();

	const content = readFileSync(path, "utf-8");
	const blocks = new Map<string, SSHConfigBlock>();
	let current: SSHConfigBlock | null = null;

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const spaceIdx = line.indexOf(" ");
		if (spaceIdx === -1) continue;

		const key = line.substring(0, spaceIdx).toLowerCase();
		const value = line.substring(spaceIdx + 1).trim();

		if (key === "host") {
			if (current) blocks.set(current.host, current);
			current = { host: value };
		} else if (current) {
			switch (key) {
				case "hostname":
					current.hostname = value;
					break;
				case "port":
					current.port = Number.parseInt(value, 10);
					break;
				case "user":
					current.user = value;
					break;
				case "identityfile":
					current.identityFile = value.replace("~", homedir());
					break;
				case "forwardagent":
					current.forwardAgent = value.toLowerCase() === "yes";
					break;
				case "proxyjump":
					current.proxyJump = value;
					break;
				case "stricthostkeychecking":
					current.strictHostKeyChecking = value;
					break;
				case "connecttimeout":
					current.connectTimeout = Number.parseInt(value, 10) * 1000;
					break;
				case "serveraliveinterval":
					current.serverAliveInterval =
						Number.parseInt(value, 10) * 1000;
					break;
				case "serveralivecountmax":
					current.serverAliveCountMax = Number.parseInt(value, 10);
					break;
			}
		}
	}

	if (current) blocks.set(current.host, current);
	return blocks;
}

export function resolveSSHConfig(
	hostAlias: string,
	overrides: Partial<SSHHostConfig> = {},
): SSHHostConfig {
	const configBlocks = parseSSHConfig();
	const block = configBlocks.get(hostAlias);

	const strictMap: Record<string, SSHHostConfig["strictHostKeyChecking"]> = {
		yes: "yes",
		no: "no",
		"accept-new": "accept-new",
	};

	return {
		host: overrides.host ?? block?.hostname ?? hostAlias,
		port: overrides.port ?? block?.port ?? DEFAULT_SSH_CONFIG.port,
		username: overrides.username ?? block?.user ?? "",
		privateKeyPath: overrides.privateKeyPath ?? block?.identityFile,
		forwardAgent:
			overrides.forwardAgent ??
			block?.forwardAgent ??
			DEFAULT_SSH_CONFIG.forwardAgent,
		strictHostKeyChecking:
			overrides.strictHostKeyChecking ??
			strictMap[block?.strictHostKeyChecking ?? ""] ??
			DEFAULT_SSH_CONFIG.strictHostKeyChecking,
		proxyJump: overrides.proxyJump ?? block?.proxyJump,
		connectTimeout:
			overrides.connectTimeout ??
			block?.connectTimeout ??
			DEFAULT_SSH_CONFIG.connectTimeout,
		keepaliveInterval:
			overrides.keepaliveInterval ??
			block?.serverAliveInterval ??
			DEFAULT_SSH_CONFIG.keepaliveInterval,
		keepaliveCountMax:
			overrides.keepaliveCountMax ??
			block?.serverAliveCountMax ??
			DEFAULT_SSH_CONFIG.keepaliveCountMax,
	};
}
