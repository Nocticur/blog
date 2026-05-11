import type { CollectionsApiConfig } from "../types/config";

// 使用 Google favicon 服务获取网站图标
// 格式：https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=<网站域名>&size=64
const favicon = (domain: string) =>
	`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`;

export const collectionsApiConfig: CollectionsApiConfig = {
	// 页面标题，留空则使用 i18n 翻译
	title: "",
	// 页面描述，留空则使用 i18n 翻译
	description: "",

	// API 收藏列表
	apis: [
		{
			name: "中科大测速",
			url: "https://test.ustc.edu.cn/",
			description: "中国科学技术大学网络测速，基于 LibreSpeed，支持 IPv4/IPv6",
			category: "测试数据",
			icon: favicon("test.ustc.edu.cn"),
			enabled: true,
		},
		{
			name: "ITDOG",
			url: "https://www.itdog.cn/",
			description:
				"在线 Ping、TCPing、网站测速、HTTP 测速、路由追踪、DNS 查询等网络工具",
			category: "测试数据",
			icon: favicon("itdog.cn"),
			enabled: true,
		},

		// AI 聊天
		{
			name: "豆包",
			url: "https://www.doubao.com/",
			description: "字节跳动旗下 AI 助手，支持对话、写作、翻译、代码等多种能力",
			category: "AI 聊天",
			icon: favicon("doubao.com"),
			enabled: true,
		},
		{
			name: "ChatGPT",
			url: "https://chatgpt.com/",
			description: "OpenAI 开发的对话式 AI，支持写作、编程、分析等多种任务",
			category: "AI 聊天",
			icon: favicon("chatgpt.com"),
			enabled: true,
		},
		{
			name: "Claude",
			url: "https://claude.ai/",
			description: "Anthropic 开发的 AI 助手，擅长长文本理解、代码与深度分析",
			category: "AI 聊天",
			icon: favicon("claude.ai"),
			enabled: true,
		},
		{
			name: "Gemini",
			url: "https://gemini.google.com/",
			description: "Google 推出的多模态 AI，支持文本、图片理解与代码生成",
			category: "AI 聊天",
			icon: favicon("gemini.google.com"),
			enabled: true,
		},
		// 图片
		{
			name: "在线图像工具箱",
			url: "https://phototool.cn/",
			description: "在线图片处理工具，支持格式转换、压缩、裁剪、批量下载等功能",
			category: "图片",
			icon: favicon("phototool.cn"),
			enabled: true,
		},
		// 小破站 / 二次元
		{
			name: "Bilibili API（非官方）",
			url: "https://github.com/SocialSisterYi/bilibili-API-collect",
			description: "B 站接口收集整理，涵盖视频、用户、弹幕、直播等",
			category: "小破站",
			icon: favicon("bilibili.com"),
			enabled: true,
		},
		{
			name: "Jikan API",
			url: "https://jikan.moe/",
			description: "MyAnimeList 非官方 REST API，查询动漫、漫画、角色信息",
			category: "小破站",
			icon: favicon("jikan.moe"),
			enabled: true,
		},
		{
			name: "AniList API",
			url: "https://anilist.gitbook.io/anilist-apiv2-docs/",
			description: "动漫追番平台 GraphQL API，支持查询、追番列表、评分等",
			category: "小破站",
			icon: favicon("anilist.co"),
			enabled: true,
		},
		{
			name: "Kitsu API",
			url: "https://kitsu.docs.apiary.io/",
			description: "动漫社区平台 API，提供动漫、漫画、用户库等 JSON:API 接口",
			category: "小破站",
			icon: favicon("kitsu.io"),
			enabled: true,
		},
		{
			name: "Danbooru API",
			url: "https://danbooru.donmai.us/wiki_pages/api",
			description:
				"知名二次元图库 Danbooru 的 REST API，支持标签搜索与图片获取",
			category: "小破站",
			icon: favicon("danbooru.donmai.us"),
			enabled: true,
		},
		{
			name: "Nekos.best API",
			url: "https://nekos.best/",
			description: "免费二次元图片与 GIF API，按表情/动作分类，无需鉴权",
			category: "小破站",
			icon: favicon("nekos.best"),
			enabled: true,
		},
		{
			name: "waifu.pics API",
			url: "https://waifu.pics/docs",
			description: "随机二次元图片 API，支持多种分类，简单易用",
			category: "小破站",
			icon: favicon("waifu.pics"),
			enabled: true,
		},
		// 知识库 / 学习
		{
			name: "Java 全栈知识体系",
			url: "https://pdai.tech/",
			description:
				"涵盖 Java 核心、并发、JVM、框架、数据库、架构等全栈知识体系",
			category: "知识库",
			icon: favicon("pdai.tech"),
			enabled: true,
		},
		{
			name: "JavaGuide",
			url: "https://javaguide.cn/",
			description:
				"Java 学习 + 面试指南，涵盖 Java 基础、集合、并发、JVM、Spring 等核心知识",
			category: "知识库",
			icon: favicon("javaguide.cn"),
			enabled: true,
		},
		{
			name: "异常教程",
			url: "https://www.exception.site/",
			description:
				"提供 IDEA、PyCharm、WebStorm 等 JetBrains 系列 IDE 激活码与安装教程",
			category: "知识库",
			icon: favicon("exception.site"),
			enabled: true,
		},
		{
			name: "力扣 LeetCode",
			url: "https://leetcode.cn/",
			description: "全球极客挚爱的技术成长平台，海量算法题库、面试题与竞赛",
			category: "知识库",
			icon: favicon("leetcode.cn"),
			enabled: true,
		},
		{
			name: "牛客网",
			url: "https://www.nowcoder.com/",
			description:
				"IT 求职备考与技术学习平台，提供笔试、面试题库与在线编程练习",
			category: "知识库",
			icon: favicon("nowcoder.com"),
			enabled: true,
		},

		// 实用工具 API
		{
			name: "IP-API",
			url: "https://ip-api.com/docs",
			description: "免费 IP 地理位置查询，返回国家、城市、ISP 等信息",
			category: "实用工具",
			icon: favicon("ip-api.com"),
			enabled: true,
		},
		{
			name: "ExchangeRate API",
			url: "https://www.exchangerate-api.com/docs/overview",
			description: "汇率查询 API，支持 160+ 货币实时与历史汇率",
			category: "实用工具",
			icon: favicon("exchangerate-api.com"),
			enabled: true,
		},
		{
			name: "QR Code API",
			url: "https://goqr.me/api/",
			description: "在线生成二维码，支持自定义尺寸、格式，无需注册",
			category: "实用工具",
			icon: favicon("goqr.me"),
			enabled: true,
		},
		{
			name: "Random User API",
			url: "https://randomuser.me/documentation",
			description: "随机生成用户数据，包含头像、姓名、邮箱等，适合 Mock",
			category: "实用工具",
			icon: favicon("randomuser.me"),
			enabled: true,
		},
		{
			name: "Cataas（猫咪 API）",
			url: "https://cataas.com/",
			description: "随机猫咪图片 API，支持添加文字水印，轻松获取猫猫",
			category: "实用工具",
			icon: favicon("cataas.com"),
			enabled: true,
		},
		{
			name: "OpenWeatherMap",
			url: "https://openweathermap.org/api",
			description: "全球天气数据 API，支持当前天气、预报和历史数据",
			category: "天气",
			icon: favicon("openweathermap.org"),
			enabled: true,
		},
		{
			name: "GitHub API",
			url: "https://docs.github.com/en/rest",
			description: "GitHub 官方 REST API，管理仓库、Issues、Pull Requests 等",
			category: "实用工具",
			icon: favicon("github.com"),
			enabled: true,
		},
	],

	// API 分类（可选，留空则自动生成）
	categories: [],
};
