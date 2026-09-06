// 从旧留言导出生成时间戳/属地修复 SQL（在新库 Neon PostgreSQL 的 SQL Editor 执行）
// 注意：新库 id = 迁移时的插入序号（1..42，按时间升序），与旧库 objectId 无关。
import { readFileSync, writeFileSync } from "node:fs";

const d = JSON.parse(
	readFileSync(new URL("./.old-guestbook-export.json", import.meta.url), "utf8"),
);
const list = (d.data?.data ?? []).slice().sort((a, b) => a.time - b.time);
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

let sql = `-- 留言板历史数据修复：insertedAt 恢复为原始时间，ip 清空（原 IP 不可考，避免属地误显示）
-- 目标：Vercel + Neon（PostgreSQL），表名 wl_comment（waline.pgsql 官方建表）
-- id 与迁移插入序号一致：1..${list.length}（时间升序）。可在 Neon 控制台 SQL Editor 整体执行。

BEGIN;

`;
list.forEach((c, index) => {
	const id = index + 1;
	sql += `UPDATE wl_comment SET insertedAt = '${fmt(c.time)}', ip = '' WHERE id = ${id}; /* ${id}: ${c.nick} */\n`;
});
sql += "\nCOMMIT;\n";

writeFileSync(
	new URL("./fix-guestbook-timestamps.sql", import.meta.url),
	sql,
);
console.log(
	`已生成 scripts/fix-guestbook-timestamps.sql（${list.length} 条 UPDATE，id 1..${list.length}）`,
);
