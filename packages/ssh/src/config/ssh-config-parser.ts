import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

export function parseSSHConfigString(content: string): SSHConfigBlock[] {
	const blocks: SSHConfigBlock[] = [];
	let current: SSHConfigBlock | null = null;

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const spaceIdx = line.indexOf(" ");
		if (spaceIdx === -1) continue;

		const key = line.substring(0, spaceIdx).toLowerCase();
		const value = line.substring(spaceIdx + 1).trim();

		if (key === "host") {
			if (current) blocks.push(current);
			current = { host: value };
		} else if (current) {
			applyConfigKey(current, key, value);
		}
	}

	if (current) blocks.push(current);
	return blocks;
}

function applyConfigKey(
	block: SSHConfigBlock,
	key: string,
	value: string,
): void {
	switch (key) {
		case "hostname":
			block.hostname = value;
			break;
		case "port":
			block.port = Number.parseInt(value, 10);
			break;
		case "user":
			block.user = value;
			break;
		case "identityfile":
			block.identityFile = value;
			break;
		case "forwardagent":
			block.forwardAgent = value.toLowerCase() === "yes";
			break;
		case "proxyjump":
			block.proxyJump = value;
			break;
		case "stricthostkeychecking":
			block.strictHostKeyChecking = value;
			break;
		case "connecttimeout":
			block.connectTimeout = Number.parseInt(value, 10) * 1000;
			break;
		case "serveraliveinterval":
			block.serverAliveInterval = Number.parseInt(value, 10) * 1000;
			break;
		case "serveralivecountmax":
			block.serverAliveCountMax = Number.parseInt(value, 10);
			break;
	}
}

export function parseSSHConfig(
	configPath?: string,
): Map<string, SSHConfigBlock> {
	const path = configPath ?? join(homedir(), ".ssh", "config");
	if (!existsSync(path)) return new Map();

	const content = readFileSync(path, "utf-8");
	const blocks = parseSSHConfigString(content);
	const map = new Map<string, SSHConfigBlock>();
	for (const block of blocks) {
		map.set(block.host, block);
	}
	return map;
}

export function resolveSSHConfig(
	hostAlias: string,
	overrides: Partial<SSHHostConfig> = {},
	configBlocks?: Map<string, SSHConfigBlock>,
): SSHHostConfig {
	const blocks = configBlocks ?? parseSSHConfig();
	const block = blocks.get(hostAlias);

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
