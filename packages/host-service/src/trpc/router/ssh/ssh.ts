import { SSHConnectionPool } from "@superset/ssh/connection";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sshHosts } from "../../../db/schema";
import { protectedProcedure, router } from "../../index";

const pool = new SSHConnectionPool();

export const sshRouter = router({
	listHosts: protectedProcedure.query(({ ctx }) => {
		return ctx.db.select().from(sshHosts).all();
	}),

	addHost: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				host: z.string().min(1),
				port: z.number().int().positive().default(22),
				username: z.string().min(1),
				privateKeyPath: z.string().nullish(),
				forwardAgent: z.boolean().default(true),
				connectTimeout: z.number().int().positive().default(30000),
				keepaliveInterval: z.number().int().positive().default(15000),
			}),
		)
		.mutation(({ ctx, input }) => {
			const id = crypto.randomUUID();
			ctx.db
				.insert(sshHosts)
				.values({
					id,
					name: input.name,
					host: input.host,
					port: input.port,
					username: input.username,
					privateKeyPath: input.privateKeyPath ?? null,
					forwardAgent: input.forwardAgent ? 1 : 0,
					connectTimeout: input.connectTimeout,
					keepaliveInterval: input.keepaliveInterval,
				})
				.run();

			const created = ctx.db.query.sshHosts
				.findFirst({ where: eq(sshHosts.id, id) })
				.sync();
			if (!created)
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create SSH host",
				});
			return created;
		}),

	updateHost: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				host: z.string().min(1).optional(),
				port: z.number().int().positive().optional(),
				username: z.string().min(1).optional(),
				privateKeyPath: z.string().nullish(),
				forwardAgent: z.boolean().optional(),
				connectTimeout: z.number().int().positive().optional(),
				keepaliveInterval: z.number().int().positive().optional(),
			}),
		)
		.mutation(({ ctx, input }) => {
			const existing = ctx.db.query.sshHosts
				.findFirst({ where: eq(sshHosts.id, input.id) })
				.sync();

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `SSH host not found: ${input.id}`,
				});
			}

			const { id, ...fields } = input;
			const updates: Record<string, unknown> = {};
			if (fields.name !== undefined) updates.name = fields.name;
			if (fields.host !== undefined) updates.host = fields.host;
			if (fields.port !== undefined) updates.port = fields.port;
			if (fields.username !== undefined) updates.username = fields.username;
			if (fields.privateKeyPath !== undefined)
				updates.privateKeyPath = fields.privateKeyPath ?? null;
			if (fields.forwardAgent !== undefined)
				updates.forwardAgent = fields.forwardAgent ? 1 : 0;
			if (fields.connectTimeout !== undefined)
				updates.connectTimeout = fields.connectTimeout;
			if (fields.keepaliveInterval !== undefined)
				updates.keepaliveInterval = fields.keepaliveInterval;

			ctx.db.update(sshHosts).set(updates).where(eq(sshHosts.id, id)).run();

			const updated = ctx.db.query.sshHosts
				.findFirst({ where: eq(sshHosts.id, id) })
				.sync();
			if (!updated)
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update SSH host",
				});
			return updated;
		}),

	removeHost: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await pool.disconnect(input.id);
			ctx.db.delete(sshHosts).where(eq(sshHosts.id, input.id)).run();
			return { success: true };
		}),

	testConnection: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const host = ctx.db.query.sshHosts
				.findFirst({ where: eq(sshHosts.id, input.id) })
				.sync();

			if (!host) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `SSH host not found: ${input.id}`,
				});
			}

			try {
				await pool.connect({
					id: host.id,
					config: {
						host: host.host,
						port: host.port,
						username: host.username,
						privateKeyPath: host.privateKeyPath ?? undefined,
						forwardAgent: host.forwardAgent === 1,
						strictHostKeyChecking: "accept-new",
						connectTimeout: host.connectTimeout,
						keepaliveInterval: host.keepaliveInterval,
						keepaliveCountMax: 3,
					},
				});

				await pool.disconnect(host.id);

				ctx.db
					.update(sshHosts)
					.set({ lastConnectedAt: Date.now() })
					.where(eq(sshHosts.id, host.id))
					.run();

				return { success: true as const };
			} catch (err) {
				return {
					success: false as const,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}),

	getHostStatus: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx, input }) => {
			const host = ctx.db.query.sshHosts
				.findFirst({ where: eq(sshHosts.id, input.id) })
				.sync();

			if (!host) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `SSH host not found: ${input.id}`,
				});
			}

			const connectionState = pool.getState(input.id);

			return {
				id: host.id,
				name: host.name,
				connectionState,
				lastConnectedAt: host.lastConnectedAt,
			};
		}),
});
