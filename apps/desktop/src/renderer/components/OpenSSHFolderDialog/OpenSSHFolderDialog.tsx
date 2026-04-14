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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

interface SSHHost {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
}

interface OpenSSHFolderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (workspaceId: string) => void;
}

export function OpenSSHFolderDialog({
	open,
	onOpenChange,
	onSuccess,
}: OpenSSHFolderDialogProps) {
	const { activeHostUrl } = useLocalHostService();
	const [selectedHostId, setSelectedHostId] = useState<string>("");
	const [remotePath, setRemotePath] = useState("");
	const [isPending, setIsPending] = useState(false);

	const { data: hosts = [], isLoading: hostsLoading } = useQuery({
		queryKey: ["ssh-hosts", activeHostUrl],
		queryFn: async () => {
			if (!activeHostUrl) return [];
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.ssh.listHosts.query() as Promise<SSHHost[]>;
		},
		enabled: !!activeHostUrl && open,
	});

	const selectedHost = hosts.find((h) => h.id === selectedHostId);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();

			if (!activeHostUrl) {
				toast.error("Host service not ready");
				return;
			}
			if (!selectedHostId) {
				toast.error("Please select an SSH host");
				return;
			}
			if (!remotePath.trim()) {
				toast.error("Remote path is required");
				return;
			}

			setIsPending(true);
			try {
				const client = getHostServiceClientByUrl(activeHostUrl);
				const result = await client.workspaceCreation.createSSHWorkspace.mutate(
					{
						sshHostId: selectedHostId,
						remotePath: remotePath.trim(),
						branch: "__auto__",
					},
				);

				toast.success(`已打开远程项目 "${result.workspace.name}"`);
				setRemotePath("");
				setSelectedHostId("");
				onOpenChange(false);
				onSuccess?.(result.workspace.id);
			} catch (err) {
				toast.error(
					`连接失败: ${err instanceof Error ? err.message : String(err)}`,
				);
			} finally {
				setIsPending(false);
			}
		},
		[activeHostUrl, selectedHostId, remotePath, onOpenChange, onSuccess],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>打开远程服务器项目</DialogTitle>
					<DialogDescription>
						通过 SSH 连接到远程服务器，打开其上的项目目录
					</DialogDescription>
				</DialogHeader>

				{!activeHostUrl ? (
					<p className="text-sm text-muted-foreground py-4 text-center">
						正在等待 Host Service 启动…
					</p>
				) : (
					<form onSubmit={handleSubmit} className="space-y-4 pt-2">
						<div className="space-y-1.5">
							<Label className="text-sm font-medium">
								SSH 主机 <span className="text-destructive">*</span>
							</Label>
							{hostsLoading ? (
								<div className="h-9 rounded-md bg-muted/50 animate-pulse" />
							) : hosts.length === 0 ? (
								<div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
									未配置 SSH 主机。请先在 Settings → SSH 中添加。
								</div>
							) : (
								<Select
									value={selectedHostId}
									onValueChange={setSelectedHostId}
									disabled={isPending}
								>
									<SelectTrigger>
										<SelectValue placeholder="选择 SSH 主机…" />
									</SelectTrigger>
									<SelectContent>
										{hosts.map((host) => (
											<SelectItem key={host.id} value={host.id}>
												<span className="font-medium">{host.name}</span>
												<span className="ml-2 text-muted-foreground text-xs">
													{host.username}@{host.host}:{host.port}
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="ssh-remote-path" className="text-sm font-medium">
								远程路径 <span className="text-destructive">*</span>
							</Label>
							<Input
								id="ssh-remote-path"
								placeholder={
									selectedHost
										? `/home/${selectedHost.username}/my-project`
										: "/home/user/my-project"
								}
								value={remotePath}
								onChange={(e) => setRemotePath(e.target.value)}
								disabled={isPending || hosts.length === 0}
								autoFocus={hosts.length > 0}
							/>
							<p className="text-xs text-muted-foreground">
								远程服务器上项目目录的绝对路径
							</p>
						</div>

						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isPending}
							>
								取消
							</Button>
							<Button
								type="submit"
								disabled={isPending || hosts.length === 0 || !selectedHostId}
							>
								{isPending ? "连接中…" : "打开项目"}
							</Button>
						</div>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
