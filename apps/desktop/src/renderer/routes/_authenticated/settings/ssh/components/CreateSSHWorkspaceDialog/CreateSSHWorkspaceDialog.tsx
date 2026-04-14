import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { useCallback, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { SSHHost } from "../SSHHostList";

interface CreateSSHWorkspaceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hostUrl: string;
	host: SSHHost;
}

export function CreateSSHWorkspaceDialog({
	open,
	onOpenChange,
	hostUrl,
	host,
}: CreateSSHWorkspaceDialogProps) {
	const [remotePath, setRemotePath] = useState("");
	const [workspaceName, setWorkspaceName] = useState("");
	const [isPending, setIsPending] = useState(false);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();

			if (!remotePath.trim()) {
				toast.error("Remote path is required");
				return;
			}

			setIsPending(true);
			try {
				const client = getHostServiceClientByUrl(hostUrl);
				const result = await client.workspaceCreation.createSSHWorkspace.mutate(
					{
						sshHostId: host.id,
						remotePath: remotePath.trim(),
						branch: "__auto__",
						workspaceName: workspaceName.trim() || undefined,
					},
				);

				toast.success(
					`Workspace "${result.workspace.name}" created on ${host.name}`,
				);
				setRemotePath("");
				setWorkspaceName("");
				onOpenChange(false);
			} catch (err) {
				toast.error(
					`Failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			} finally {
				setIsPending(false);
			}
		},
		[hostUrl, host, remotePath, workspaceName, onOpenChange],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Open Remote Folder</DialogTitle>
					<DialogDescription>
						Open a project on{" "}
						<span className="font-medium text-foreground">
							{host.username}@{host.host}
						</span>
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4 pt-2">
					<div className="space-y-1.5">
						<Label htmlFor="ssh-remote-path" className="text-sm font-medium">
							Remote Path <span className="text-destructive">*</span>
						</Label>
						<Input
							id="ssh-remote-path"
							placeholder="/home/user/my-project"
							value={remotePath}
							onChange={(e) => setRemotePath(e.target.value)}
							disabled={isPending}
							autoFocus
						/>
						<p className="text-xs text-muted-foreground">
							Absolute path to the project directory on the remote server
						</p>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="ssh-workspace-name" className="text-sm font-medium">
							Workspace Name
						</Label>
						<Input
							id="ssh-workspace-name"
							placeholder={`${host.name}:main`}
							value={workspaceName}
							onChange={(e) => setWorkspaceName(e.target.value)}
							disabled={isPending}
						/>
						<p className="text-xs text-muted-foreground">
							Optional — auto-generated from host name and branch if empty
						</p>
					</div>

					<div className="flex justify-end gap-2 pt-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending ? "Connecting…" : "Open Folder"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
