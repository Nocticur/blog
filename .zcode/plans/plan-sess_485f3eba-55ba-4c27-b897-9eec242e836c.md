# 写作空间线上化：Vercel Serverless + GitHub 写回

## 目标
让 `/writing/` 写作空间在 Vercel 线上站点可用：登录 → 文章列表 → 新建/编辑/删除，**保存即提交到 GitHub 仓库**，Vercel 自动重建后文章上线（约 2-3 分钟）。参考 Firefly-hyde 的"同域 serverless 函数持有凭据 + 服务端鉴权 + Git 写回"模式。本地 dev 工作流保持不变。

## 架构

```
线上(Vercel)：浏览器 ──/api/writing/*──▶ Vercel Function(持 env 密钥) ──GitHub Contents API──▶ 仓库提交 ──▶ Vercel 自动重建
本地(dev)：  浏览器 ──/api/writing/*──▶ astro dev middleware ──▶ 直接写本地文件（现有流程不变）
```

两端同一路由契约、同一鉴权方式，前端一套代码自适应。

## 文件改动

### 1. 新增 `api/writing/[[...path]].js`（Vercel Serverless Function）
Vercel 自动发现，无需改 vercel.json。Node runtime，路由分发与 dev middleware 一致（pathname 去尾斜杠）：
- `POST /api/writing/auth`：接收 `{password}`，服务端 sha256 后与 env 哈希比对，签发 HMAC 会话 token（7 天过期），返回 `{token, mode:"deployed", repo, branch, tokenReady}`。**密码哈希从此不进前端 bundle**
- `GET /api/writing/posts`：列表 = 同域静态 `/api/allPostMeta.json`（已发布文章元数据，秒出）∪ GitHub Contents API 列 `src/content/posts/` 文件名（一次调用），差集（草稿）逐篇拉取解析 frontmatter，合并返回
- `GET /api/writing/posts?file=x`：Contents API 读单篇，gray-matter 解析
- `POST/PUT /api/writing/posts`：body 含表单+content+可选 repo → buildMarkdown → Contents API PUT 提交（GET sha 区分新建/更新），**保存即发布**，返回 `{ok, file, url: commit.html_url}`
- `DELETE /api/writing/posts?file=x`：Contents API DELETE（先取 sha）
- 非 `/auth` 请求一律先验 `x-writing-auth` 头的 session token（HMAC 签名+有效期）
- 错误响应沿用现有中文文案风格；GitHub 401/403/404/超时细分提示
- repo 解析优先级：请求参数 → `WRITING_GITHUB_REPO` → `VERCEL_GIT_REPO_OWNER/VERCEL_GIT_REPO_SLUG`（Vercel 自动提供，零配置）

### 2. 新增共享模块 `src/lib/writing-server.mjs`（plain ESM，避免 TS 编译差异）
从 astro.config.mjs 迁出/新增，两端共用：
- `verifyPassword(password, env)`、`signSession`/`verifySession`（node:crypto HMAC-SHA256）
- `buildMarkdown(form, content)`（现 astro.config.mjs 204-222 行逻辑迁入）
- `resolveRepo(env)`、session secret 解析（`WRITING_SESSION_SECRET` 缺省时从密码哈希派生）

### 3. `astro.config.mjs` dev middleware 改造
- 新增 `POST /auth` 路由（与线上同语义，返回 `{token, mode:"dev", ...}`），复用共享模块
- 鉴权从「头 = passwordHash 严格比对」升级为「头 = 有效 session token」
- 原 posts CRUD（写本地文件）与 `POST /publish`（推 GitHub）保留不变

### 4. `src/components/pages/WritingStudio.svelte` 前端适配
- `handleLogin`：改为 `POST /api/writing/auth/`，存返回 token 到 sessionStorage（AUTH_KEY 复用）；删除 WebCrypto 客户端比对；**移除 `passwordHash` prop**（writing.astro 同步清理）
- `onMount` 会话恢复：直接 `loadList()`，token 失效由 401 → `handleSessionExpired()` 处理（机制现成）
- auth 响应的 `mode` 存入状态：`deployed` 时——保存成功提示改为「已提交 · 查看提交链接 · Vercel 构建 2-3 分钟后生效」，隐藏「上传 GitHub」按钮（保存已含提交），仓库输入框保留（预填服务端返回的 repo，可改，随保存/删除请求带给服务端）；`dev` 时 UI 与现状完全一致
- offline 判定逻辑不变（fetch 失败即 offline；线上有 function 后不再触发）

### 5. `writing.astro` / `writingConfig.ts` / `.env.example`
- writing.astro：去掉 `passwordHash` prop（defaultRepo 等保留或由 auth 响应承载，视实现取简）
- writingConfig.ts：注释更新（线上部署需要的环境变量清单、会话 token 机制）
- .env.example：新增「线上部署（Vercel）」段：`WRITING_PASSWORD`/`WRITING_PASSWORD_HASH`、`GITHUB_TOKEN`、`WRITING_SESSION_SECRET`（建议，`openssl rand -hex 32`）、`WRITING_GITHUB_REPO`（可选）、`WRITING_GITHUB_BRANCH`（可选）

## 环境变量汇总（Vercel 后台配置）
| 变量 | 必配 | 说明 |
|---|---|---|
| `WRITING_PASSWORD` 或 `WRITING_PASSWORD_HASH` | 是 | 登录密码（服务端校验） |
| `GITHUB_TOKEN` | 是 | fine-grained PAT，Contents 读写 |
| `WRITING_SESSION_SECRET` | 建议 | 会话签名密钥，缺省从密码哈希派生 |
| `WRITING_GITHUB_REPO` / `WRITING_GITHUB_BRANCH` | 否 | 缺省自动用 Vercel 所连仓库/默认分支 |

## 边界说明
- Cloudflare Workers（wrangler）为纯静态，线上写作仅支持 Vercel 部署；CF 站上仍显示 offline
- 草稿 = `draft: true` 随仓库提交（PROD 构建过滤不公开），与现有语义一致
- 参考项目的 KV 通道（说说/公告）、图床、站点配置编辑不在本次范围，仅文章编写发布
- 线上保存有 2-3 分钟构建延迟，UI 会明确提示

## 验证
1. `pnpm type-check` + biome（无新增问题）
2. 本地 dev 全流程回归：登录（新 auth 端点）→ 列表/编辑/保存/删除 → 上传按钮
3. Function 本地验证：node 脚本直接调用 handler 模拟请求（auth/列表/保存/删除/401/参数校验），GitHub 负路径（无 token → 中文报错）
4. 线上端到端需你在 Vercel 配好环境变量后验证，我会给出 smoke 步骤清单
