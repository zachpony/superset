import { eq } from "drizzle-orm";
import type { HostDb } from "@superset/host-service/db";
import { workspaces } from "@superset/host-service/db";

export interface WorkspaceContext {
	mode: "local" | "ssh";
	sshHostId?: string;
	remotePath?: string;
	localPath?: string;
}

export class WorkspaceContextResolver {
	constructor(private readonly db: HostDb) {}

	resolveContext(workspaceId: string): WorkspaceContext {
		const workspace = this.db.query.workspaces
			.findFirst({ where: eq(workspaces.id, workspaceId) })
			.sync();

		if (!workspace) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		if (workspace.executionMode === "ssh") {
			if (!workspace.sshHostId) {
				throw new Error(
					`SSH workspace ${workspaceId} has no sshHostId configured`,
				);
			}
			if (!workspace.remotePath) {
				throw new Error(
					`SSH workspace ${workspaceId} has no remotePath configured`,
				);
			}

			return {
				mode: "ssh",
				sshHostId: workspace.sshHostId,
				remotePath: workspace.remotePath,
			};
		}

		return {
			mode: "local",
			localPath: workspace.worktreePath ?? undefined,
		};
	}
}
