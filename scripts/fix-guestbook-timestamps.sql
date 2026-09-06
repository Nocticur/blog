-- 留言板历史数据修复：insertedAt 恢复为原始时间，ip 清空（原 IP 不可考，避免属地误显示）
-- 目标：Vercel + Neon（PostgreSQL），表名 wl_comment（waline.pgsql 官方建表）
-- id 与迁移插入序号一致：1..42（时间升序）。可在 Neon 控制台 SQL Editor 整体执行。

BEGIN;

UPDATE wl_comment SET insertedAt = '2026-07-18 01:52:31', ip = '' WHERE id = 1; /* 1: MmMing */
UPDATE wl_comment SET insertedAt = '2026-07-18 01:53:42', ip = '' WHERE id = 2; /* 2: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-07-18 02:14:38', ip = '' WHERE id = 3; /* 3: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-07-19 02:36:26', ip = '' WHERE id = 4; /* 4: xiaow */
UPDATE wl_comment SET insertedAt = '2026-07-19 02:47:40', ip = '' WHERE id = 5; /* 5: xh */
UPDATE wl_comment SET insertedAt = '2026-07-19 03:11:05', ip = '' WHERE id = 6; /* 6: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-07-19 05:30:04', ip = '' WHERE id = 7; /* 7: fqzlr */
UPDATE wl_comment SET insertedAt = '2026-07-19 05:33:20', ip = '' WHERE id = 8; /* 8: xh */
UPDATE wl_comment SET insertedAt = '2026-07-19 05:43:43', ip = '' WHERE id = 9; /* 9: fqzlr */
UPDATE wl_comment SET insertedAt = '2026-07-19 09:28:29', ip = '' WHERE id = 10; /* 10: xh */
UPDATE wl_comment SET insertedAt = '2026-07-19 11:01:02', ip = '' WHERE id = 11; /* 11: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-07-19 12:28:31', ip = '' WHERE id = 12; /* 12: MmMing */
UPDATE wl_comment SET insertedAt = '2026-07-19 12:38:46', ip = '' WHERE id = 13; /* 13: 语句 */
UPDATE wl_comment SET insertedAt = '2026-07-19 15:36:36', ip = '' WHERE id = 14; /* 14: MmMing */
UPDATE wl_comment SET insertedAt = '2026-07-21 05:45:27', ip = '' WHERE id = 15; /* 15: 小黄 */
UPDATE wl_comment SET insertedAt = '2026-07-21 10:12:00', ip = '' WHERE id = 16; /* 16: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-07-24 13:48:48', ip = '' WHERE id = 17; /* 17: 深圳 */
UPDATE wl_comment SET insertedAt = '2026-07-25 01:23:54', ip = '' WHERE id = 18; /* 18: fqzlr */
UPDATE wl_comment SET insertedAt = '2026-07-25 01:39:04', ip = '' WHERE id = 19; /* 19: xiaow */
UPDATE wl_comment SET insertedAt = '2026-07-25 04:38:24', ip = '' WHERE id = 20; /* 20: fqzlr */
UPDATE wl_comment SET insertedAt = '2026-07-25 04:41:20', ip = '' WHERE id = 21; /* 21: fqzlr */
UPDATE wl_comment SET insertedAt = '2026-07-25 05:33:31', ip = '' WHERE id = 22; /* 22: MmMing */
UPDATE wl_comment SET insertedAt = '2026-07-25 05:34:40', ip = '' WHERE id = 23; /* 23: MmMing */
UPDATE wl_comment SET insertedAt = '2026-07-28 03:38:20', ip = '' WHERE id = 24; /* 24: 拾玖 */
UPDATE wl_comment SET insertedAt = '2026-07-28 09:36:51', ip = '' WHERE id = 25; /* 25: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-07-28 15:24:44', ip = '' WHERE id = 26; /* 26: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-11 15:24:38', ip = '' WHERE id = 27; /* 27: rx */
UPDATE wl_comment SET insertedAt = '2026-08-11 16:02:05', ip = '' WHERE id = 28; /* 28: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-22 19:02:25', ip = '' WHERE id = 29; /* 29: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-24 13:02:47', ip = '' WHERE id = 30; /* 30: Alex */
UPDATE wl_comment SET insertedAt = '2026-08-24 15:41:16', ip = '' WHERE id = 31; /* 31: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-26 17:00:45', ip = '' WHERE id = 32; /* 32: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-26 17:01:00', ip = '' WHERE id = 33; /* 33: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-26 17:02:23', ip = '' WHERE id = 34; /* 34: MmMing */
UPDATE wl_comment SET insertedAt = '2026-08-27 03:05:56', ip = '' WHERE id = 35; /* 35: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-08-27 07:03:55', ip = '' WHERE id = 36; /* 36: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-08-29 09:30:30', ip = '' WHERE id = 37; /* 37: 染弦 */
UPDATE wl_comment SET insertedAt = '2026-08-29 11:03:46', ip = '' WHERE id = 38; /* 38: 哈基墩 */
UPDATE wl_comment SET insertedAt = '2026-08-31 03:21:06', ip = '' WHERE id = 39; /* 39: 656 */
UPDATE wl_comment SET insertedAt = '2026-09-01 07:49:40', ip = '' WHERE id = 40; /* 40: MmMing */
UPDATE wl_comment SET insertedAt = '2026-09-01 08:04:44', ip = '' WHERE id = 41; /* 41: MmMing */
UPDATE wl_comment SET insertedAt = '2026-09-03 05:30:08', ip = '' WHERE id = 42; /* 42: 哈基墩 */

COMMIT;
