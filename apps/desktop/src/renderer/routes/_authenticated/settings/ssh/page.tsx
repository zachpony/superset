import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useSettingsSearchQuery } from "renderer/stores/settings-state";
import { getMatchingItemsForSection } from "../utils/settings-search";
import { SSHHostSettings } from "./components/SSHHostSettings";

export const Route = createFileRoute("/_authenticated/settings/ssh/")({
	component: SSHSettingsPage,
});

function SSHSettingsPage() {
	const searchQuery = useSettingsSearchQuery();

	const visibleItems = useMemo(() => {
		if (!searchQuery) return null;
		return getMatchingItemsForSection(searchQuery, "ssh").map(
			(item) => item.id,
		);
	}, [searchQuery]);

	return <SSHHostSettings visibleItems={visibleItems} />;
}
