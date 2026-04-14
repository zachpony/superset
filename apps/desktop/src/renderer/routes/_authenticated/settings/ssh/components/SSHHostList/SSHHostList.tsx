import { Button } from "@superset/ui/button";
import { Card, CardContent } from "@superset/ui/card";
import { toast } from "@superset/ui/sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
	HiOutlineFolderOpen,
	HiOutlinePencilSquare,
	HiOutlineSignal,
	HiOutlineTrash,
} from "react-icons/hi2";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { CreateSSHWorkspaceDialog } from "../CreateSSHWorkspaceDialog";

interface SSHHost {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	privateKeyPath: string | null;
	forwardAgent: number;
	connectTimeout: number;
	keepaliveInterval: number;
	lastConnectedAt: number | null;
}

interface SSHHostListProps {
	hostUrl: string;
	onEdit: (host: SSHHost) => void;
}

export function SSHHostList({ hostUrl, onEdit }: SSHHostListProps) {
	const queryClient = useQueryClient();
	const [testingId, setTestingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [openFolderHost, setOpenFolderHost] = useState<SSHHost | null>(null);

	const {
		data: hosts = [],
		isLoading,
		error,
	} = useQuery({
		queryKey: ["ssh-hosts", hostUrl],
		queryFn: async () => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.ssh.listHosts.query() as Promise<SSHHost[]>;
		},
	});

	const invalidateHosts = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["ssh-hosts", hostUrl] });
	}, [queryClient, hostUrl]);

	const handleTestConnection = useCallback(
		async (id: string) => {
			setTestingId(id);
			try {
				const client = getHostServiceClientByUrl(hostUrl);
				const result = await client.ssh.testConnection.mutate({ id });
				if (result.success) {
					toast.success("Connection successful");
					invalidateHosts();
				} else {
					toast.error(`Connection failed: ${result.error}`);
				}
			} catch {
				toast.error("Failed to test connection");
			} finally {
				setTestingId(null);
			}
		},
		[hostUrl, invalidateHosts],
	);

	const handleDelete = useCallback(
		async (id: string, name: string) => {
			setDeletingId(id);
			try {
				const client = getHostServiceClientByUrl(hostUrl);
				await client.ssh.removeHost.mutate({ id });
				toast.success(`Removed "${name}"`);
				invalidateHosts();
			} catch {
				toast.error("Failed to remove host");
			} finally {
				setDeletingId(null);
			}
		},
		[hostUrl, invalidateHosts],
	);

	if (isLoading) {
		return (
			<div className="space-y-3">
				{[1, 2].map((i) => (
					<div key={i} className="h-16 rounded-md bg-muted/50 animate-pulse" />
				))}
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Failed to load SSH hosts
					</p>
				</CardContent>
			</Card>
		);
	}

	if (hosts.length === 0) {
		return (
			<Card>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						No SSH hosts configured yet. Click "Add Host" to get started.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<div className="space-y-2">
				{hosts.map((host) => (
					<Card key={host.id}>
						<CardContent className="flex items-center justify-between py-3">
							<div className="flex-1 min-w-0">
								<div className="text-sm font-medium truncate">{host.name}</div>
								<div className="text-xs text-muted-foreground truncate">
									{host.username}@{host.host}:{host.port}
								</div>
								{host.lastConnectedAt && (
									<div className="text-xs text-muted-foreground mt-0.5">
										Last connected:{" "}
										{new Date(host.lastConnectedAt).toLocaleString()}
									</div>
								)}
							</div>
							<div className="flex items-center gap-1 ml-3">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setOpenFolderHost(host)}
									title="Open remote folder"
								>
									<HiOutlineFolderOpen className="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => handleTestConnection(host.id)}
									disabled={testingId === host.id}
									title="Test connection"
								>
									<HiOutlineSignal className="h-4 w-4" />
									{testingId === host.id ? (
										<span className="ml-1 text-xs">Testing…</span>
									) : null}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => onEdit(host)}
									title="Edit"
								>
									<HiOutlinePencilSquare className="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => handleDelete(host.id, host.name)}
									disabled={deletingId === host.id}
									title="Delete"
								>
									<HiOutlineTrash className="h-4 w-4 text-destructive" />
								</Button>
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			{openFolderHost && (
				<CreateSSHWorkspaceDialog
					open={!!openFolderHost}
					onOpenChange={(open) => {
						if (!open) setOpenFolderHost(null);
					}}
					hostUrl={hostUrl}
					host={openFolderHost}
				/>
			)}
		</>
	);
}

export type { SSHHost };
