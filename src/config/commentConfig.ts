import type { CommentConfig } from "../types/config";

export const commentConfig: CommentConfig = {
	// 评论系统类型: none, twikoo, waline, giscus, disqus, artalk，默认为none，即不启用评论系统
	type: "waline",

	//twikoo评论系统配置，版本1.7.4
	twikoo: {
		envId: "https://twikoo.vercel.app",
		// 设置 Twikoo 评论系统语言
		lang: "zh-CN",
		// 是否启用文章访问量统计功能
		visitorCount: true,
	},

	//waline评论系统配置
	waline: {
		// waline 后端服务地址
		// waline 后端服务地址（新 Waline 实例，旧评论不迁移，旧数据由旧服务管理员处理）
		serverURL: "https://waline.noctis.eu.cc/",
		// 自定义图片上传接口：指向本站服务端代理 /api/image-upload（代理固定调用图床
		// https://mourn.eu.cc/，token 仅存于服务端环境变量）。
		// 图床真实上传 API（鉴权头、文件字段、返回 JSON）尚未确认，暂不启用。
		// 确认并部署代理后再取消注释，避免上线不可用接口：
		// imageUploadURL: "/api/image-upload",
		// 设置 Waline 评论系统语言
		lang: "zh-CN",
		// 设置 Waline 评论系统表情地址
		emoji: [
			"https://unpkg.com/@waline/emojis@1.4.0/weibo",
			"https://unpkg.com/@waline/emojis@1.4.0/bilibili",
			"https://unpkg.com/@waline/emojis@1.4.0/bmoji",
		],
		// 可配置兼容的自建图片接口；留空时使用 Waline 原生内嵌图片
		// 评论登录模式。可选值如下：
		//   'enable'   —— 默认，允许访客匿名评论和用第三方 OAuth 登录评论，兼容性最佳。
		//   'force'    —— 强制必须登录后才能评论，适合严格社区，关闭匿名评论。
		//   'disable'  —— 禁止所有登录和 OAuth，仅允许匿名评论（填写昵称/邮箱），适用于极简留言。
		login: "enable",
		// 是否启用文章访问量统计功能
		visitorCount: false,
	},

	// artalk评论系统配置
	artalk: {
		// artalk后端程序 API 地址
		server: "https://artalk.example.com/",
		// 设置 Artalk 语言
		locale: "zh-CN",
		// 是否启用文章访问量统计功能
		visitorCount: true,
	},

	//giscus评论系统配置
	giscus: {
		// 设置 Giscus 评论系统仓库
		repo: "Nocticur/my-blog",
		// 设置 Giscus 评论系统仓库ID
		repoId: "R_kgDOSXWjBQ",
		// 设置 Giscus 评论系统分类
		category: "General",
		// 获取 Giscus 评论系统分类ID
		categoryId: "DIC_kwDOSXWjBc4C8jP5",
		// 获取 Giscus 评论系统映射方式
		mapping: "pathname",
		// 获取 Giscus 评论系统严格模式
		strict: "0",
		// 获取 Giscus 评论系统反应功能
		reactionsEnabled: "1",
		// 获取 Giscus 评论系统元数据功能
		emitMetadata: "0",
		// 获取 Giscus 评论系统输入位置
		inputPosition: "top",
		// 获取 Giscus 评论系统语言
		lang: "zh-CN",
		// 获取 Giscus 评论系统加载方式
		loading: "lazy",
	},

	//disqus评论系统配置
	disqus: {
		// 获取 Disqus 评论系统
		shortname: "firefly",
	},
};
