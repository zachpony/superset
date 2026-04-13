import { Button } from "@superset/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { HiOutlinePlus } from "react-icons/hi2";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../utils/settings-search";
import { SSHHostForm } from "../SSHHostForm";
import { type SSHHost, SSHHostList } from "../SSHHostList";

interface SSHHostSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

export function SSHHostSettings({ visibleItems }: SSHHostSettingsProps) {
	const showHosts = isItemVisible(SETTING_ITEM_ID.SSH_HOSTS, visibleItems);
	const { activeHostUrl } = useLocalHostService();
	const queryClient = useQueryClient();

	const [formMode, setFormMode] = useState<
		{ type: "closed" } | { type: "add" } | { type: "edit"; host: SSHHost }
	>({ type: "closed" });

	const handleFormSuccess = useCallback(() => {
		setFormMode({ type: "closed" });
		if (activeHostUrl) {
			queryClient.invalidateQueries({
				queryKey: ["ssh-hosts", activeHostUrl],
			});
		}
	}, [queryClient, activeHostUrl]);

	const handleEdit = useCallback((host: SSHHost) => {
		setFormMode({ type: "edit", host });
	}, []);

	const handleCancel = useCallback(() => {
		setFormMode({ type: "closed" });
	}, []);

	return (
		<div className="p-6 max-w-4xl w-full">
			<div className="mb-8">
				<h2 className="text-xl font-semibold">SSH Remote Development</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Configure SSH hosts for remote development
				</p>
			</div>

			<div className="space-y-6">
				{showHosts && (
					<div>
						<div className="flex items-center justify-between mb-4">
							<div className="space-y-0.5">
								<h3 className="text-sm font-medium">SSH Hosts</h3>
								<p className="text-xs text-muted-foreground">
									Manage your remote SSH host connections
								</p>
							</div>
							{formMode.type === "closed" && (
								<Button
									variant="default"
									size="sm"
									className="gap-2"
									onClick={() => setFormMode({ type: "add" })}
									disabled={!activeHostUrl}
								>
									<HiOutlinePlus className="h-4 w-4" />
									Add Host
								</Button>
							)}
						</div>

						{!activeHostUrl ? (
							<p className="text-sm text-muted-foreground">
								Waiting for host service to start…
							</p>
						) : (
							<>
								{formMode.type !== "closed" && (
									<div className="mb-4 rounded-md border border-border p-4">
										<h4 className="text-sm font-medium mb-3">
											{formMode.type === "edit"
												? `Edit "${formMode.host.name}"`
												: "Add SSH Host"}
										</h4>
										<SSHHostForm
											hostUrl={activeHostUrl}
											initialValues={
												formMode.type === "edit"
													? {
															id: formMode.host.id,
															name: formMode.host.name,
															host: formMode.host.host,
															port: formMode.host.port,
															username: formMode.host.username,
															privateKeyPath:
																formMode.host.privateKeyPath ?? "",
															forwardAgent: formMode.host.forwardAgent === 1,
														}
													: undefined
											}
											onSuccess={handleFormSuccess}
											onCancel={handleCancel}
										/>
									</div>
								)}

								<SSHHostList hostUrl={activeHostUrl} onEdit={handleEdit} />
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
