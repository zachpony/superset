import { describe, expect, test } from "bun:test";
import { SSHConnectionPool } from "./connection-pool";

describe("SSHConnectionPool", () => {
	test("initializes with empty connections", () => {
		const pool = new SSHConnectionPool();
		expect(pool.listConnections()).toEqual([]);
	});

	test("getState returns not_found for unknown connection", () => {
		const pool = new SSHConnectionPool();
		expect(pool.getState("nonexistent")).toBe("not_found");
	});

	test("getClient throws for unknown connection", () => {
		const pool = new SSHConnectionPool();
		expect(() => pool.getClient("nonexistent")).toThrow(
			"SSH connection nonexistent is not available",
		);
	});

	test("connect rejects with invalid host", async () => {
		const pool = new SSHConnectionPool();
		try {
			await pool.connect({
				id: "test-bad",
				config: {
					host: "192.0.2.1",
					port: 22,
					username: "nobody",
					connectTimeout: 1000,
					keepaliveInterval: 10000,
					keepaliveCountMax: 3,
					forwardAgent: false,
					strictHostKeyChecking: "no",
				},
			});
			expect(true).toBe(false);
		} catch (err) {
			expect(err).toBeDefined();
		}
	});

	test("disconnect is idempotent for unknown connections", async () => {
		const pool = new SSHConnectionPool();
		await pool.disconnect("nonexistent");
		expect(pool.getState("nonexistent")).toBe("not_found");
	});
});
