# 友链管理与巡检

后台的「友链」只需填写站点名称、站点描述、站点链接和头像链接，点击「添加友链」后保存。高级设置可填写标签、排序权重、自定义封面和对方友链页地址。已填写的头像链接直接使用；选择上传图片时才会调用图床。

## 图床配置

Vercel 项目环境变量配置 `IMGBED_BASE_URL=https://image.nocticur.eu.cc` 和 `IMGBED_API_TOKEN`，用于后台上传头像。GitHub 仓库另配置 Actions Secret `IMGBED_API_TOKEN`，用于自动截图；Actions Variable `IMGBED_BASE_URL` 可覆盖相同的默认图床域名。凭据只留在服务端，不写入友链数据或客户端代码。

头像上传使用 `blog/friends/avatars` 目录，自动截图使用 `blog/friends/screenshots` 目录。接口采用 `/upload?returnFormat=full&uploadFolder=...`、multipart `file` 和 Bearer Token，禁止携带凭据跟随跳转。图片不超过 3 MiB。图床没有配置时仍可添加使用现成头像链接的友链，巡检继续执行。

## 执行时间与报告

`Friend link check` 每天北京时间 10:00 计划运行（实际开始时间由 GitHub 调度决定），默认分支上的 `src/data/friends.json` 变更会触发，也可以在 Actions 手动运行。GitHub 友链申请流程写入友链后会调用同一个工作流，补足 `GITHUB_TOKEN` 产生的提交通常不会触发其他 push 工作流的情况。所有报告任务共享串行队列，不取消已经运行的检查。

工作流读取最新默认分支上的启用友链，只访问公网 HTTP(S) 地址；每次解析都校验全部 DNS 答案，连接使用校验过的地址，并限制跳转、时间和响应大小。首页可跟随公网跨域跳转；公开申请的友链页面仍保持同源要求。填写 `linkpage` 后才检测指向 `src/data/friend-site.json` 中本站地址的真实链接，未填写时报告「未检测」。

状态为 `ok`（正常）、`restricted`（401/403/429，检测受限）、`error`（访问异常）和 `unknown`（尚未检测）。反链失败不改变首页可访问状态。任何异常都不会自动停用或删除友链。超过 48 小时的报告由页面标记过期，公开状态接口不可用时仍显示原有卡片。

报告固定写入独立 `codex/friend-status` 分支的 `reports/friend-links.json`。首次通过 GitHub API 创建不继承博客源码的独立提交，包含禁止部署的 `vercel.json`；后续通过 Contents API 携带文件 SHA 更新，发生版本冲突时有限重试，拒绝覆盖较新的报告，不使用强制推送。主分支的 Vercel 配置也禁止此报告分支自动部署。报告通过 `/api/friend-status` 读取并缓存五分钟，每次运行还保留 `friend-link-report` 附件。

## 截图规则与限制

首次检测到正常站点时生成首页截图，已有截图满七天才刷新。使用 1280 × 800 的 JPEG，图床上传成功后才更新地址和时间；浏览器或上传失败会保留上次成功截图。自定义封面优先于自动截图。

截图使用独立浏览器上下文，禁用页面 JavaScript、Service Worker、WebSocket 和下载；HTML、样式、字体、图片及跳转由 Node 代理验证并固定公网 DNS，限制为最多 200 个请求、每个资源 3 MiB、全部资源 24 MiB 和约 35 秒。完全依赖 JavaScript 渲染的网站可能无法生成完整封面，可在高级设置指定自定义封面。截图失败不会改变检测状态。

本地可运行 `pnpm check:friends` 生成 `reports/friend-links.json`；只有配置图床环境变量才会上传截图。脚本不会自行推送报告，发布脚本仅用于 Actions。验证可运行 `node --test scripts/test-friend-health.mjs scripts/test-friend-request.mjs`。
