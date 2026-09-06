// 留言板历史数据迁移：旧 Waline（waline.mmzhiku.xyz）→ 新 Waline（waline.noctis.eu.cc）
//
// 用法：
//   1. 准备 scripts/.waline-admin.json（已被 .gitignore 忽略）：
//        { "email": "你的管理邮箱", "password": "你的管理密码" }
//   2. 试运行（只打印，不写入）： node scripts/migrate-guestbook.mjs --dry-run
//      正式迁移：               node scripts/migrate-guestbook.mjs --apply
//
// 原理：Waline 管理员 POST /api/comment 会跳过验证码/限流/审核但强制 insertedAt=now、
// user_id=管理员；随后用管理员 PUT /api/comment/:id（无字段白名单）把 insertedAt、ua
// 改回原值并把 user_id 置空，避免历史留言挂上「站长」徽章。

import { readFileSync } from "node:fs";

const NEW_SERVER = "https://waline.noctis.eu.cc";
const EXPORT_FILE = new URL("./.old-guestbook-export.json", import.meta.url);
const CRED_FILE = new URL("./.waline-admin.json", import.meta.url);
const CHANNEL_PATH = "/guestbook/";

const APPLY = process.argv.includes("--apply");

function fail(msg) {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

const exportData = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
const comments = (exportData.data?.data ?? []).slice().sort((a, b) => a.time - b.time);
if (comments.length === 0) fail("导出文件里没有评论");

const { email, password } = JSON.parse(readFileSync(CRED_FILE, "utf8"));
if (!email || !password) fail("凭证文件缺少 email 或 password");

async function api(path, { method = "GET", body, token } = {}) {
	const res = await fetch(`${NEW_SERVER}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok || json.errno !== 0) {
		fail(`${method} ${path} -> HTTP ${res.status} ${json.errmsg ?? ""}`);
	}
	return json;
}

// ── 1. 管理员登录 ─────────────────────────────────────────
console.log("登录管理端…");
const login = await api("/api/token", {
	method: "POST",
	body: { email, password },
});
const token = login.data?.token;
if (!token) fail("登录成功但未返回 token");
console.log("✓ 登录成功");

// ── 2. 逐条迁移 ───────────────────────────────────────────
// 从导出的 browser/os 字段合成尽量接近原始的 UA 字符串，
// 让新站的浏览器/系统解析结果与历史显示一致。
function synthesizeUa(browser = "", os = "") {
	const b = browser.toLowerCase();
	const version = browser.match(/([\d.]+)$/)?.[1] ?? "126.0.0.0";
	if (os.includes("Android")) {
		return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`;
	}
	if (os.includes("iOS") || os.includes("iPhone")) {
		return `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`;
	}
	if (os.includes("Mac")) {
		const safariVersion = b.includes("safari") ? version : "17.0";
		if (b.includes("chrome")) {
			return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
		}
		return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariVersion} Safari/605.1.15`;
	}
	if (os.includes("Linux")) {
		return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
	}
	// 默认 Windows
	if (b.includes("edge")) {
		return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36 Edg/${version}.0.0.0`;
	}
	if (b.includes("quark")) {
		return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36 Quark/${version}`;
	}
	return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
}

console.log(`开始迁移 ${comments.length} 条留言（${APPLY ? "APPLY" : "DRY-RUN"}）…`);
let done = 0;
for (const c of comments) {
	const insertedAt = new Date(c.time).toISOString();
	const ua = synthesizeUa(c.browser, c.os);
	const body = {
		url: CHANNEL_PATH,
		comment: c.comment,
		nick: c.nick,
		link: c.link || "",
		mail: "",
		ua,
	};

	if (!APPLY) {
		console.log(
			`[dry] ${new Date(c.time).toISOString().slice(0, 16)} ${c.nick}: ${(c.orig || c.comment || "").replace(/<[^>]+>/g, "").slice(0, 30)}`,
		);
		done += 1;
		continue;
	}

	// 创建（管理员：自动 approved）
	const created = await api("/api/comment", { method: "POST", body, token });
	const objectId = created.data?.objectId;
	if (!objectId) fail(`第 ${done + 1} 条创建成功但未返回 objectId`);

	// 修正历史元数据：真实时间 + 清除管理员绑定（避免「站长」徽章）
	await api(`/api/comment/${objectId}`, {
		method: "PUT",
		token,
		body: { insertedAt, user_id: null },
	});

	done += 1;
	console.log(
		`✓ [${done}/${comments.length}] ${insertedAt.slice(0, 16)} ${c.nick} -> ${objectId}`,
	);
}

console.log(APPLY ? `\n完成：${done} 条已迁移。` : `\n试运行完成：${done} 条。加 --apply 执行正式迁移。`);
