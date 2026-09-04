import type { AnnouncementConfig } from "../types/config";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题
	title: "公告",

	// 公告列表
	items: [
		{
			tag: "欢迎",
			title: "欢迎来到我的博客",
			content:
				"欢迎来到我的博客。",
			time: "2026-08-13",
			link: "/about/",
			sort: 1,
		},
		{
			tag: "公告",
			title: "公告",
			content:
				"本站所有内容仅为个人观念，如有不适，请自行关闭。",
			time: "2026-08-13",
			sort: 2,
		},
		{
			tag: "友链",
			title: "互换友链",
			content: "如果你也有一个博客，欢迎与我交换友链。",
			time: "2026-08-13",
			link: "/friends/",
			sort: 4,
		},
	],

	// 是否允许用户关闭公告
	closable: false,
};
