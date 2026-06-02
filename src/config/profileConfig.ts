import type { ProfileConfig } from "../types/config";

export const profileConfig: ProfileConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	avatar: "assets/images/avatar.webp",

	// 下班时间头像（为空则始终使用上方 avatar）
	avatarOffWork: "assets/images/avatar2.webp",

	// 名字
	name: "MmzMing",

	// 首页展示名字（留空则使用 name）
	displayName: "MmzMing",

	// 职业/身份标签
	occupation: "[(伪)全栈工程师[啥都干工程师] / 技术博主]",

	// 个人签名（支持多条，会循环打字+删除效果）
	bio: [
		"哈基咪南北绿多，阿西噶阿西，阿西哈呀库奶龙，哈基咪哈基",
		"且视他人之疑目如盏盏鬼火，大胆地去走你的夜路",
		"万头攒动火树银花之处不必找我，如欲相见，我在各种悲喜交集处，能做的事就是长途跋涉返璞归真",
		"很喜欢一句话：孩子你一定要好好学习，不然长大了...就没有能力帮助别人了",
		"先生我好像病了，看到正确答案反到楞住了",
	],

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	// showName: true 时显示图标和名称，false 时只显示图标
	links: [
		{
			name: "qq",
			icon: "fa7-brands:qq",
			url: "https://qm.qq.com/q/2R07cjGTZ0",
			showName: false,
		},
		{
			name: "B站",
			icon: "fa7-brands:bilibili",
			url: "https://space.bilibili.com/15446538",
			showName: false,
		},
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/MmzMing",
			showName: false,
		},
		{
			name: "Email",
			icon: "fa7-solid:envelope",
			url: "mailto:784774835@qq.com",
			showName: false,
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
			showName: false,
		},
	],
};
