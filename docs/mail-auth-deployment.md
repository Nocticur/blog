# 邮箱登录注册改造：部署与成本核查记录

> 2026-09-16 交付。本次改造将 `/mail/` 从"匿名临时邮箱"升级为"注册 / 登录 + 固定邮箱收件"，
> 复用现有邮箱 Worker（dreamhunter2333/cloudflare_temp_email，D1 库 `cloudflare_temp_email`）
> 与现有博客 Worker 代理架构，未整套迁移参考项目（Loven7 Mail，MIT）。

## 一、架构与数据流

```
浏览器（/mail/）
  │  仅同源 /api/mail-auth/*，上游 JWT 永不进入浏览器
  ▼
博客服务端（Vercel Function ／ Cloudflare my-blog Worker ／ astro dev 中间件 —— 同一套 worker/index.js）
  ├─ GET  /api/mail-auth/config     ─── 注册域名(3 个公开后缀) + 登录域名(全部 4 个) + 长度限制
  ├─ GET  /api/mail-auth/admin/config ── 管理员创建配置（4 个后缀，默认 mourn.top，须管理员会话）
  ├─ POST /api/mail-auth/register   ─── 一条 INSERT 写入邮箱 D1 address 表（原子注册）
  ├─ POST /api/mail-auth/login      ─── 转发上游 POST /api/address_login（地址+密码认证）
  ├─ GET  /api/mail-auth/session    ─── 解密本地 Cookie（不请求上游）
  ├─ POST /api/mail-auth/logout     ─── 清除 Cookie
  └─ GET/PATCH/DELETE /api/mail-auth/mails…、/inbox ─── 注入 Cookie 中的 JWT 调上游邮件接口
```

- 注册：`INSERT INTO address (name, password, source_meta) VALUES (?,?,?)`，唯一约束 `address.name`
  保证重名返回 409、绝不覆盖；单条语句不存在"只有地址没有密码"的中间状态。
  密码以 SHA-256 十六进制存储，与上游地址登录的比对格式一致。
- 登录：复用上游 `/api/address_login`（密码为前端 SHA-256 的约定，本服务端代为计算），
  签发的地址 JWT 存入 AES-GCM 加密的 `mail_user_session` Cookie（HttpOnly、Secure、SameSite=Lax、7 天，
  活跃时滚动续期），与管理员会话 `mail_admin_session` 完全独立。
- 收件：阅读 / 刷新 / 删除 / 清空均由服务端持有 JWT 代理，前端拿不到令牌；写操作校验 Origin 同源。
- 注册域名白名单（服务端常量）：`nocticur.eu.cc`、`noctis.eu.cc`、`caelus.eu.cc`；
  `mourn.top` 只能由管理员经 `/api/mail-admin/admin/new_address` 创建（上游管理接口不做域名限制），
  该域邮箱仍用地址密码正常登录，登录侧不限域名。
- 邮箱表单统一为「前缀 + @ + 后缀下拉」共享组件（`MailAddressFields.svelte`）：
  普通登录与管理员登录下拉含全部四个后缀（默认 `nocticur.eu.cc`）；普通注册仅三个公开后缀；
  管理员"创建邮箱地址 / 创建用户账号"凭 `/api/mail-auth/admin/config`（管理员会话校验）获取四个后缀，
  默认 `mourn.top`。粘贴完整邮箱自动拆分；普通注册粘贴 `@mourn.top` 时置错误并拒绝提交，不加入选项。
- 旧临时邮箱通道已下线：博客 Worker 的 `/api/new_address|parsed_mails|…` 代理路由、
  vercel.json 的直连重写、astro dev 的 mailDevProxy 一并移除；公开注册仅剩
  `/api/mail-auth/register`（白名单 + 限流），上游 `/api/new_address` 保持关闭
  （`ENABLE_USER_CREATE_EMAIL` 不开启），直连上游无法创建任何邮箱。
- 限流：注册每 IP 每小时 5 次（含失败）；登录失败同 IP+账号 15 分钟 5 次。进程内存级（尽力而为）。

## 二、环境变量

### Vercel（生产站点，Settings → Environment Variables）

| 变量 | 必配 | 说明 |
| --- | --- | --- |
| `MAIL_ADMIN_SESSION_SECRET` | 已有 | 管理员会话密钥（≥32 字符） |
| `MAIL_USER_SESSION_SECRET` | 建议 | 用户会话密钥（≥32 字符），缺省回退管理员密钥 |
| `MAIL_UPSTREAM_ORIGIN` | 建议 | 上游邮箱 Worker 地址；默认 `https://apimail.noctis.eu.cc`，被拦截时改用 Worker 原生 `*.workers.dev` 地址 |
| `CLOUDFLARE_ACCOUNT_ID` | 注册必配 | Cloudflare 账户 ID |
| `CLOUDFLARE_D1_DATABASE_ID` | 注册必配 | 邮箱 D1 数据库 ID（仪表盘 → 存储 → D1） |
| `CLOUDFLARE_D1_API_TOKEN` | 注册必配 | 见下文 Token 创建 |

### Cloudflare（my-blog Worker，Settings → Variables）

- `MAIL_ADMIN_SESSION_SECRET`（已有）；可选 `MAIL_USER_SESSION_SECRET`、`MAIL_UPSTREAM_ORIGIN`。
- D1 访问二选一：配 `CLOUDFLARE_*` 三件套（同 Vercel），或在 wrangler.jsonc 增加指向
  `cloudflare_temp_email` 库的 `d1_databases` 绑定（绑定名必须为 `MAIL_DB`，代码自动优先使用）。
- 不配置 D1 凭据时：登录 / 收件正常，注册返回 500（提示未配置）。

### 本地开发（系统环境变量，与 .env.example 说明一致）

- 同 Vercel 清单；未配置 D1 凭据时本地仅可验证登录与收件。

### D1 API Token 创建（一次性）

1. 仪表盘 → My Profile → API Tokens → Create Token → Custom token。
2. 权限：`Account` → `D1` → `Edit`（如需进一步收敛，可用 Cloudflare 令牌的资源限定选择具体账户）。
3. 生成后立即填入 Vercel / 本地环境变量，Token 不会再次展示。

## 三、上游邮箱 Worker 的一次性配置核对（部署时执行）

当前生效配置（上一轮核查）：创建邮箱关闭、地址密码登录关闭，且部分生效值与控制台变量不一致。
上线本功能前，在邮箱 Worker（apimail.noctis.eu.cc 所在 Worker）完成：

| 项 | 期望值 | 途径 |
| --- | --- | --- |
| `ENABLE_ADDRESS_PASSWORD` | `true`（地址密码登录开关，登录注册的先决条件） | Settings → Variables（普通变量） |
| `ENABLE_USER_CREATE_EMAIL` | 保持关闭（公开创建入口保持封死） | 同上 |
| `ADMIN_PASSWORDS`（管理员口令） | 从普通变量迁入 **Secret**（Settings → Variables → Encrypt / `wrangler secret put`） | Secrets |
| `JWT_SECRET` | 从普通变量迁入 **Secret**；迁移后需重新登录所有会话 | Secrets |
| `DOMAINS` / 生效值核对 | 控制台变量与后台"生效配置"逐项比对，消除不一致项 | 管理后台 → 系统设置 |

注意：`ADMIN_PASSWORDS` 与 `JWT_SECRET` 迁入 Secret 属于敏感变更，建议在低峰期执行并立即验证
管理员登录与收信路由；JWT_SECRET 更换会使已登录的邮箱地址会话失效（重新登录即可）。

## 四、上线顺序

1. **备份**：D1 导出（现有 `cloudflare_temp_email` 库，Console → Storage → D1 → Export，
   或 `wrangler d1 export cloudflare_temp_email --remote --output=backup.sql`）；
   记录邮箱 Worker 当前部署版本与变量截图。
2. **上游配置**：按第三节启用 `ENABLE_ADDRESS_PASSWORD`、迁移 Secrets。
3. **Vercel 环境变量**：补齐第二节清单（先配置，暂不部署）。
4. **部署博客后端（本次代码）**：推送触发 Vercel 构建；`/api/mail-auth/*` 与旧临时邮箱路由同时生效。
   Cloudflare 侧 my-blog Worker 由 Git 构建同步更新（未配置 D1 凭据时注册不可用，登录收件正常）。
5. **验证清单**：
   - [ ] 三个公开域名分别注册；重复注册 409；mourn.top 在表单中不可选
   - [ ] 错误密码 401 提示；限流 429 提示
   - [ ] 刷新恢复登录（Cookie 7 天）；退出后回登录卡；过期后回登录卡
   - [ ] 普通会话访问 `/api/mail-admin/*` 返回 401；收件内容仅本地址
   - [ ] 直连 `https://apimail.noctis.eu.cc/api/new_address` 仍被拒绝（创建保持关闭）
   - [ ] 管理员创建 `@mourn.top` 邮箱 → 地址密码可正常登录
   - [ ] 真实外部收件：从外部邮箱发信到新注册地址，60 秒内出现在收件箱（由用户发送测试邮件验收）
6. **回滚**：Vercel 回退到上一部署即可；D1 只新增 `address` 行，无需数据回滚。

## 五、成本核查记录（免费运行边界）

| 资源 | 套餐 | 免费额度 | 本次改动后的用量估算 | 备注 |
| --- | --- | --- | --- | --- |
| Workers（邮箱 Worker + 请求） | Free | 10 万次请求/天 | 收件轮询 60s：每活跃用户 ≈ 60 次/小时（代理请求 1:1 转发上游），页面隐藏/离线暂停、失败退避至 5 分钟 | 上限内；若用户量增长可拉长轮询间隔 |
| D1 | Free | 5 GB 存储 / 500 万行读/天 | 当前库约 176 KB；注册只新增 `address` 行，邮件行由收信自然增长 | 远低于上限 |
| KV | Free | 10 万读/天 | 本功能不新增 KV 读写 | — |
| R2 | Paid（账户已有） | 按用量计费 | 邮箱未绑定 R2，本次不接入；潜在计费边界 = 附件转存 R2 的存储+A 类操作，当前为 $0.00 | 保持解绑即无费用 |
| Vercel | Hobby | 个人非商业 | Function 调用随轮询增长（同 Workers 量级） | Hobby 限制内 |

结论：当前邮箱云服务费用为 **$0.00**（R2 付费计划本账期未产生费用；邮箱未使用 R2）。
以上不包含域名续费，也不构成长期无限免费的承诺；发信（SMTP/转发到任意收件人）需要付费
Workers 套餐，本次明确不实现。

## 六、本次代码变更清单

- 新增 `worker/mail-auth.js`、`worker/mail-user-session.js`、`api/mail-auth/[[...path]].js`。
- `worker/index.js`：接入 `/api/mail-auth/*`，移除旧临时邮箱代理；上游地址改为
  `MAIL_UPSTREAM_ORIGIN` 环境配置（默认 apimail.noctis.eu.cc）。
- `vercel.json`：新增 mail-auth 重写与 no-store 头，移除旧直连重写。
- `astro.config.mjs`：dev 代理同时覆盖 mail-admin / mail-auth，移除旧 mailDevProxy。
- 前端：`MailApp.svelte` 登录/注册卡片 + 收件箱（60 秒自动刷新、失败指数退避、离线/隐藏暂停、
  401 回登录表单）、`mail-api.ts` 全面改为 Cookie 会话、`mail.css` 登录卡样式、`MailAppFallback` 骨架。
- 测试：`test-mail-worker`（注册原子性/白名单/限流/会话/代理/旧路由下线）、`test-mail-api`、
  `test-mail-browser`（登录/注册/冲突/退出/过期/拦截/移动端/净化）全部重写并通过；
  管理端测试（api/vercel/browser）回归通过。`pnpm type-check`、`pnpm build` 通过。
