// 「前缀 + @ + 后缀」组合控件的共享规则：前台登录/注册与后台创建表单统一使用。
// 邮箱域名清单以服务端配置接口为准，这里只提供拆分、组合与展示顺序。

export const FALLBACK_ALL_MAIL_DOMAINS = [
	"nocticur.eu.cc",
	"noctis.eu.cc",
	"caelus.eu.cc",
	"mourn.top",
];

export const FALLBACK_PUBLIC_MAIL_DOMAINS = FALLBACK_ALL_MAIL_DOMAINS.slice(0, 3);

export function splitMailboxAddress(value: string): { prefix: string; domain: string } {
	const text = value.trim().toLowerCase();
	const at = text.lastIndexOf("@");
	if (at < 0) return { prefix: text, domain: "" };
	return {
		prefix: text.slice(0, at).trim(),
		domain: text.slice(at + 1).trim(),
	};
}

export function composeMailboxAddress(prefix: string, domain: string): string {
	return `${prefix.trim().toLowerCase()}@${domain.trim().toLowerCase()}`;
}
