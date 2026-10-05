# 后续填写清单

当前代码和公开页面所需的基础配置已接入。没有修改实际 .env、设置个人密码或代填内容。现有站点信息、生日、评论地址和相册资料保持原样。

## 启用后台时填写

| 项目 | 填写位置 | 用途与当前状态 |
| --- | --- | --- |
| WRITING_PASSWORD 或 WRITING_PASSWORD_HASH | 本机环境变量，或未提交的 .env；线上填 Vercel 项目环境变量 | 二选一。本机检查为未配置；未配置时后台无法登录 |
| GITHUB_TOKEN（兼容 GH_TOKEN） | Vercel 环境变量 | 线上保存需要；目标仓库 Contents 读写权限。本机未配置。本地开发保存无需此项 |
| WRITING_SESSION_SECRET | 同上 | 可选独立会话签名密钥；不填从后台密码派生 |
| WRITING_GITHUB_REPO | 同上 | 可选 owner/repo；不填从本地 Git remote 或 Vercel 所连仓库推导 |
| WRITING_GITHUB_BRANCH | 同上 | 可选；不填使用仓库默认分支 |

变量名称与注释见项目根目录 .env.example。只将自己的值填入环境变量或 .env，不要将密钥写入 src/data、前端配置或提交到 Git。配置线上变量后重新部署。本机状态可运行 pnpm check:configuration 查看；该命令不能确认 Vercel 的配置状态。

## 按需补充的内容

| 内容 | 填写位置 | 字段说明 |
| --- | --- | --- |
| 朋友圈 RSS/Atom | src/data/feeds.json，或后台「朋友圈订阅」 | name、url 必填；avatar、enabled 可选。当前为空 |
| 友链 | src/data/friends.json，或后台「友链」 | title、siteurl、imgurl、desc、weight、enabled；tags、image 可选。当前为空 |
| 动态 | src/content/dynamic/*.md，或后台「动态」 | published、正文；title、pinned、tags、photos、location、comment 可选；draft: true 为草稿 |
| 笔记 | src/content/life/notebooks/笔记本名/条目.md，或后台「笔记本」 | title、正文；date、tags、description、draft 可选 |
| 足迹 | src/content/life/places/*.md，或后台「足迹」 | name 或 title、正文；lat 与 lng 一起填写，可为 0；date、photos、experience 可选 |
| 规划 | src/content/life/routines/*.md，或后台「规划」 | title、正文；time、status（todo / active / done）、draft 可选 |
| 日程 | src/data/schedules.json | date（YYYY-MM-DD）、title；note、draft 可选。当前为空 |
| 相册 | src/data/gallery.json，或后台「相册」 | id、name；description、date、location、tags、cover 可选；已有相册保留 |
| 相册照片 | public/gallery/相册ID/，或后台「相册」上传 | 先保存相册元数据，再填相册 ID 上传图片 |
| 收款码 / 打赏链接 | src/config/sponsorConfig.ts 的 methods | qrCode 或 link；现有空值保留，填实际收款码路径或链接 |
| 赞助者名单 | src/data/sponsors.json，或后台「赞助者」 | name；amount、date、avatar 可选。当前为空 |
| 工具导航 | src/data/navigation.json，或后台「工具导航」 | 原导航已迁移并保留，无需重新填写 |

Markdown 示例仍为 draft: true，不会公开。准备发布时填写真实内容并修改 draft: false。后台上传返回 /uploads/模块/... 路径，可粘贴到 photos、cover 或 Markdown 图片语法。

JSON 列表为空时保持 [] 即可，不能将注释直接写入 JSON。朋友圈示例结构如下，仅供参考，未写入实际数据：

```json
[
  {
    "name": "填写朋友名称",
    "url": "https://example.com/rss.xml",
    "enabled": true
  }
]
```

## 已沿用的设置与生效方式

- src/config/siteConfig.ts 的页面开关分别控制各入口；相册等原先关闭的页面未擅自开启。
- 友链页面和申请脚本共用 src/data/friend-site.json，已迁入现有站点资料，无需重填。
- 评论沿用 src/config/commentConfig.ts 的现有 Waline 配置。动态评论位于详情页；记录文件名决定评论路径，发布后尽量不要重命名。
- 日历沿用现有生日与建站日；如需调整，修改 src/config/calendarConfig.ts。外部节假日接口不可用时仍展示内置节日。
- 本地开发保存内容后可预览；线上保存会产生仓库提交，需等待平台重新构建。静态托管本身不能运行写作 API，线上编辑使用已有 Vercel Functions 方案。
- 友链巡检每天北京时间 10:00 计划运行，也响应默认分支友链数据变更并支持手动触发；实际开始时间由 GitHub 调度决定。报告固定保存到 `codex/friend-status` 分支并保留 friend-link-report 附件。自动截图另需 Actions Secret `IMGBED_API_TOKEN`；图床地址默认 `https://image.nocticur.eu.cc`，可用 Variable `IMGBED_BASE_URL` 覆盖。后台上传头像在 Vercel 配置同名环境变量，详见 [友链管理与巡检](friend-operations.md)。
- 真实发布链路需要你填完 GitHub 凭据后再验证。本次没有推送、发布或调用付费服务。

## 部署前核对归属与安全设置

- 核对 `src/config/siteConfig.ts` 的域名、Umami 地址、websiteId 和 shareId，以及 `public/` 下百度、头条、Bing 验证文件和 IndexNow 密钥。代码无法确认这些服务账号的归属；复制参考项目的标识不能获得自己站点的验证或统计权限。
- 配置自己的 Waline 服务与管理员账号，并检查审核、访问权限和允许来源。源码中的第三方地址不代表该服务由本站维护。
- 后台登录有每个进程、每个客户端 15 分钟 10 次尝试限制，返回 `429` 和 `Retry-After`。Vercel 多实例及冷启动不会共享该计数；公开部署应额外配置平台 WAF 或共享存储限流，限制 `/api/writing/auth` 的 POST 请求。此轮未修改线上平台配置。
- 友链申请只下载公开 HTTP(S) HTML，限制 DNS 地址、跳转、大小和超时；不执行页面 JavaScript。只有 JavaScript 才生成的回链需人工确认，已有友链不能由公开 Issue 覆盖。
- 密码文章的客户端加密适合控制一般阅读，不提供服务端权限隔离；仓库公开时源码本身仍可被读取。真正私密内容应放在有服务端鉴权的存储中。
