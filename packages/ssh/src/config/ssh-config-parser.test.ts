import { describe, expect, test } from "bun:test";
import { parseSSHConfigString, resolveSSHConfig } from "./ssh-config-parser";

describe("parseSSHConfigString", () => {
	test("parses a simple SSH config", () => {
		const config = `
Host myserver
  HostName 192.168.1.100
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
  ForwardAgent yes

Host devbox
  HostName dev.example.com
  User root
`;
		const result = parseSSHConfigString(config);

		expect(result.length).toBe(2);
		expect(result[0].host).toBe("myserver");
		expect(result[0].hostname).toBe("192.168.1.100");
		expect(result[0].user).toBe("deploy");
		expect(result[0].port).toBe(2222);
		expect(result[0].identityFile).toBe("~/.ssh/id_ed25519");
		expect(result[0].forwardAgent).toBe(true);

		expect(result[1].host).toBe("devbox");
		expect(result[1].hostname).toBe("dev.example.com");
		expect(result[1].user).toBe("root");
		expect(result[1].port).toBeUndefined();
	});

	test("handles empty config", () => {
		expect(parseSSHConfigString("")).toEqual([]);
	});

	test("handles config with comments", () => {
		const config = `
# This is a comment
Host test
  # Another comment
  HostName test.example.com
  User testuser
`;
		const result = parseSSHConfigString(config);
		expect(result.length).toBe(1);
		expect(result[0].hostname).toBe("test.example.com");
	});

	test("handles ForwardAgent no", () => {
		const config = `
Host noagent
  HostName example.com
  ForwardAgent no
`;
		const result = parseSSHConfigString(config);
		expect(result[0].forwardAgent).toBe(false);
	});

	test("parses ConnectTimeout in seconds and converts to ms", () => {
		const config = `
Host slowbox
  HostName slow.example.com
  ConnectTimeout 60
`;
		const result = parseSSHConfigString(config);
		expect(result[0].connectTimeout).toBe(60_000);
	});

	test("parses ServerAliveInterval and ServerAliveCountMax", () => {
		const config = `
Host keepalive
  HostName ka.example.com
  ServerAliveInterval 30
  ServerAliveCountMax 5
`;
		const result = parseSSHConfigString(config);
		expect(result[0].serverAliveInterval).toBe(30_000);
		expect(result[0].serverAliveCountMax).toBe(5);
	});
});

describe("resolveSSHConfig", () => {
	function makeBlocks(
		entries: Array<{
			host: string;
			hostname?: string;
			port?: number;
			user?: string;
			identityFile?: string;
			forwardAgent?: boolean;
		}>,
	) {
		const map = new Map<string, (typeof entries)[0]>();
		for (const e of entries) map.set(e.host, e);
		return map;
	}

	test("returns defaults when no config entries match", () => {
		const result = resolveSSHConfig("unknown-host", {}, new Map());
		expect(result.host).toBe("unknown-host");
		expect(result.port).toBe(22);
		expect(result.username).toBe("");
	});

	test("uses overrides when provided", () => {
		const result = resolveSSHConfig(
			"unknown-host",
			{ port: 2222, username: "custom" },
			new Map(),
		);
		expect(result.port).toBe(2222);
		expect(result.username).toBe("custom");
	});

	test("merges SSH config block with defaults", () => {
		const blocks = makeBlocks([
			{
				host: "myserver",
				hostname: "192.168.1.100",
				user: "deploy",
				port: 2222,
				identityFile: "~/.ssh/id_rsa",
				forwardAgent: true,
			},
		]);

		const result = resolveSSHConfig("myserver", {}, blocks);
		expect(result.host).toBe("192.168.1.100");
		expect(result.port).toBe(2222);
		expect(result.username).toBe("deploy");
		expect(result.privateKeyPath).toBe("~/.ssh/id_rsa");
		expect(result.forwardAgent).toBe(true);
	});

	test("overrides take priority over SSH config", () => {
		const blocks = makeBlocks([
			{ host: "myserver", hostname: "192.168.1.100", port: 2222 },
		]);

		const result = resolveSSHConfig(
			"myserver",
			{ port: 3333, username: "override-user" },
			blocks,
		);
		expect(result.port).toBe(3333);
		expect(result.username).toBe("override-user");
	});
});
