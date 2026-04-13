import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { useCallback, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

interface SSHHostFormValues {
	name: string;
	host: string;
	port: number;
	username: string;
	privateKeyPath: string;
	forwardAgent: boolean;
}

interface SSHHostFormProps {
	hostUrl: string;
	initialValues?: SSHHostFormValues & { id: string };
	onSuccess: () => void;
	onCancel: () => void;
}

const DEFAULT_VALUES: SSHHostFormValues = {
	name: "",
	host: "",
	port: 22,
	username: "",
	privateKeyPath: "",
	forwardAgent: true,
};

export function SSHHostForm({
	hostUrl,
	initialValues,
	onSuccess,
	onCancel,
}: SSHHostFormProps) {
	const isEditing = !!initialValues;
	const [values, setValues] = useState<SSHHostFormValues>(
		initialValues
			? {
					name: initialValues.name,
					host: initialValues.host,
					port: initialValues.port,
					username: initialValues.username,
					privateKeyPath: initialValues.privateKeyPath,
					forwardAgent: initialValues.forwardAgent,
				}
			: DEFAULT_VALUES,
	);
	const [isPending, setIsPending] = useState(false);

	const handleChange = useCallback(
		(field: keyof SSHHostFormValues, value: string | number | boolean) => {
			setValues((prev) => ({ ...prev, [field]: value }));
		},
		[],
	);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();

			if (
				!values.name.trim() ||
				!values.host.trim() ||
				!values.username.trim()
			) {
				toast.error("Name, host, and username are required");
				return;
			}

			setIsPending(true);
			try {
				const client = getHostServiceClientByUrl(hostUrl);
				if (isEditing && initialValues) {
					await client.ssh.updateHost.mutate({
						id: initialValues.id,
						name: values.name.trim(),
						host: values.host.trim(),
						port: values.port,
						username: values.username.trim(),
						privateKeyPath: values.privateKeyPath.trim() || null,
						forwardAgent: values.forwardAgent,
					});
					toast.success("SSH host updated");
				} else {
					await client.ssh.addHost.mutate({
						name: values.name.trim(),
						host: values.host.trim(),
						port: values.port,
						username: values.username.trim(),
						privateKeyPath: values.privateKeyPath.trim() || null,
						forwardAgent: values.forwardAgent,
					});
					toast.success("SSH host added");
				}
				onSuccess();
			} catch (_err) {
				toast.error(
					isEditing ? "Failed to update SSH host" : "Failed to add SSH host",
				);
			} finally {
				setIsPending(false);
			}
		},
		[hostUrl, values, isEditing, initialValues, onSuccess],
	);

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-1.5">
				<Label htmlFor="ssh-name" className="text-sm font-medium">
					Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="ssh-name"
					placeholder="My Server"
					value={values.name}
					onChange={(e) => handleChange("name", e.target.value)}
					disabled={isPending}
				/>
			</div>

			<div className="grid grid-cols-[1fr_100px] gap-3">
				<div className="space-y-1.5">
					<Label htmlFor="ssh-host" className="text-sm font-medium">
						Host <span className="text-destructive">*</span>
					</Label>
					<Input
						id="ssh-host"
						placeholder="192.168.1.100 or example.com"
						value={values.host}
						onChange={(e) => handleChange("host", e.target.value)}
						disabled={isPending}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="ssh-port" className="text-sm font-medium">
						Port
					</Label>
					<Input
						id="ssh-port"
						type="number"
						min={1}
						max={65535}
						value={values.port}
						onChange={(e) =>
							handleChange("port", Number.parseInt(e.target.value, 10) || 22)
						}
						disabled={isPending}
					/>
				</div>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="ssh-username" className="text-sm font-medium">
					Username <span className="text-destructive">*</span>
				</Label>
				<Input
					id="ssh-username"
					placeholder="root"
					value={values.username}
					onChange={(e) => handleChange("username", e.target.value)}
					disabled={isPending}
				/>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="ssh-key-path" className="text-sm font-medium">
					Private Key Path
				</Label>
				<Input
					id="ssh-key-path"
					placeholder="~/.ssh/id_ed25519"
					value={values.privateKeyPath}
					onChange={(e) => handleChange("privateKeyPath", e.target.value)}
					disabled={isPending}
				/>
				<p className="text-xs text-muted-foreground">
					Leave empty to use the default SSH key
				</p>
			</div>

			<div className="flex items-center justify-between">
				<div className="space-y-0.5">
					<Label htmlFor="ssh-forward-agent" className="text-sm font-medium">
						Forward Agent
					</Label>
					<p className="text-xs text-muted-foreground">
						Forward your local SSH agent to the remote host
					</p>
				</div>
				<Switch
					id="ssh-forward-agent"
					checked={values.forwardAgent}
					onCheckedChange={(checked) => handleChange("forwardAgent", checked)}
					disabled={isPending}
				/>
			</div>

			<div className="flex justify-end gap-2 pt-2">
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={isPending}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending
						? isEditing
							? "Saving…"
							: "Adding…"
						: isEditing
							? "Save Changes"
							: "Add Host"}
				</Button>
			</div>
		</form>
	);
}
