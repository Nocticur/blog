export type ContentModuleId =
	| "routines"
	| "notebooks"
	| "dynamic"
	| "places"
	| "friends"
	| "navigation"
	| "gallery"
	| "sponsors"
	| "feeds";
export type AdminPageId =
	| "dashboard"
	| "writing"
	| "settings"
	| "announcements"
	| ContentModuleId;
export type AdminNavigationItem = {
	id: AdminPageId;
	label: string;
	icon: string;
};

export const contentModules: Array<
	AdminNavigationItem & {
		id: ContentModuleId;
		group: "记录" | "站点";
		isList: boolean;
	}
> = [
	{
		id: "routines",
		label: "规划记录",
		group: "记录",
		icon: "□",
		isList: false,
	},
	{ id: "notebooks", label: "笔记本", group: "记录", icon: "▥", isList: false },
	{ id: "dynamic", label: "动态", group: "记录", icon: "≋", isList: false },
	{ id: "places", label: "足迹", group: "记录", icon: "⌖", isList: false },
	{ id: "friends", label: "友链", group: "站点", icon: "↗", isList: true },
	{
		id: "navigation",
		label: "工具导航",
		group: "站点",
		icon: "⌘",
		isList: true,
	},
	{ id: "gallery", label: "相册", group: "站点", icon: "▧", isList: true },
	{ id: "sponsors", label: "赞助者", group: "站点", icon: "♡", isList: true },
	{ id: "feeds", label: "朋友圈订阅", group: "站点", icon: "◉", isList: true },
];

export const adminNavigationGroups: Array<{
	label: string;
	items: AdminNavigationItem[];
}> = [
	{
		label: "常用",
		items: [
			{ id: "dashboard", label: "工作台", icon: "⌂" },
			{ id: "writing", label: "文章管理", icon: "▤" },
		],
	},
	{
		label: "记录",
		items: contentModules.filter((item) => item.group === "记录"),
	},
	{
		label: "站点",
		items: [
			{ id: "settings", label: "站点管理", icon: "◇" },
			{ id: "announcements", label: "公告管理", icon: "◈" },
			...contentModules.filter((item) => item.group === "站点"),
		],
	},
];

export function isContentModule(id: string): id is ContentModuleId {
	return contentModules.some((item) => item.id === id);
}

export function resolveAdminPage(hash: string): AdminPageId {
	const id = hash.replace(/^#/, "").replace(/^admin-/, "");
	if (id === "content") return "dynamic";
	const item = adminNavigationGroups
		.flatMap((group) => group.items)
		.find((item) => item.id === id);
	return item?.id ?? "dashboard";
}
