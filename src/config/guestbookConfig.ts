import type { GuestbookConfig } from "../types/config";

export const guestbookConfig: GuestbookConfig = {
	// 公告与规则待更新：正式文案确定前使用中性占位，避免展示旧站长内容
	announcements: [
		{
			id: "guestbook-notice-pending",
			title: "公告与规则待更新",
			summary: "留言板公告与规则正在整理中，正式内容将稍后发布。",
			lead: "",
			rules: [],
		},
	],
};
