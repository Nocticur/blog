// Cloudflare 区域 WAF 规则快照（只读）：在改动线上规则前导出现有规则留档。
//
// 需要环境变量：
//   CLOUDFLARE_API_TOKEN  — 至少具备 Zone → Zone WAF → Read 权限的 API Token
//   CLOUDFLARE_ZONE_ID    — noctis.eu.cc 的区域 ID（或改用 CLOUDFLARE_ZONE_NAME）
//
// 用法：node scripts/cf-waf-snapshot.mjs
// 输出：.mail-admin-backups/cf-waf-snapshot-<时间戳>/<phase>.json 与 summary.md
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API = "https://api.cloudflare.com/client/v4";
// 覆盖本次故障相关的两个阶段，外加转换规则便于排查
const PHASES = [
	"http_request_custom_rules",
	"http_ratelimit",
	"http_request_transform",
];

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
	console.error("缺少 CLOUDFLARE_API_TOKEN 环境变量（Zone WAF 只读权限即可）");
	process.exit(1);
}

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function cf(path) {
	const response = await fetch(`${API}${path}`, { headers });
	const body = await response.json();
	if (!body.success) {
		throw new Error(`Cloudflare API ${path} 失败: ${JSON.stringify(body.errors)}`);
	}
	return body.result;
}

async function resolveZoneId() {
	if (process.env.CLOUDFLARE_ZONE_ID) return process.env.CLOUDFLARE_ZONE_ID;
	const name = process.env.CLOUDFLARE_ZONE_NAME;
	if (!name) {
		console.error("需要 CLOUDFLARE_ZONE_ID 或 CLOUDFLARE_ZONE_NAME");
		process.exit(1);
	}
	const zones = await cf(`/zones?name=${encodeURIComponent(name)}`);
	if (!zones.length) throw new Error(`找不到区域 ${name}`);
	return zones[0].id;
}

const zoneId = await resolveZoneId();
const zone = await cf(`/zones/${zoneId}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(".mail-admin-backups", `cf-waf-snapshot-${stamp}`);
await mkdir(outDir, { recursive: true });

const lines = [
	`# Cloudflare WAF 快照 — ${zone.name}（${zone.id}）`,
	``,
	`生成时间：${new Date().toISOString()}`,
	`用途：修改“数据库”规则（补充 POST /api/address_login 例外）前留档，便于回滚对照。`,
	``,
];

for (const phase of PHASES) {
	try {
		const entrypoint = await cf(`/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
		const file = join(outDir, `${phase}.json`);
		await writeFile(file, JSON.stringify(entrypoint, null, 2));
		lines.push(`## ${phase}`, ``);
		for (const rule of entrypoint.rules ?? []) {
			lines.push(
				`- [${rule.enabled ? "启用" : "停用"}] ${rule.description || rule.id} — 动作 ${rule.action}`,
				`  - 表达式：\`${rule.expression}\``,
			);
			if (/noctis\.eu\.cc|apimail/.test(rule.expression)) {
				lines.push(`  - ⚠ 与本次故障相关（命中 noctis.eu.cc 主机）`);
			}
		}
		lines.push(``);
		console.log(`已导出 ${phase}（${entrypoint.rules?.length ?? 0} 条规则）`);
	} catch (error) {
		lines.push(`## ${phase}`, ``, `导出失败：${error.message}`, ``);
		console.warn(`跳过 ${phase}: ${error.message}`);
	}
}

await writeFile(join(outDir, "summary.md"), lines.join("\n"));
console.log(`快照已保存到 ${outDir}`);
