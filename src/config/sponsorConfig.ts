import type { SponsorConfig } from "../types/config";

export const sponsorConfig: SponsorConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "打赏",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 赞助用途说明
	usage: "",

	// 是否显示赞助者列表
	showSponsorsList: true,

	// 赞助方式列表
	methods: [
		{
			name: "微信支付",
			icon: "material-symbols:chat-bubble",
			// 收款码图片路径（需要放在 public 目录下）；旧收款码已移除，待更新
			qrCode: "",
			link: "",
			description: "",
			enabled: true,
		},
		{
			name: "支付宝支付",
			icon: "fa7-brands:alipay",
			// 收款码图片路径（需要放在 public 目录下）
			qrCode: "",
			link: "",
			description: "",
			enabled: true,
		},
	],

	// 赞助者列表（可选）
	sponsors: [],
};
