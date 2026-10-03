# 参考项目功能补齐

保留现有黑白主题、首页和静态构建。个人数据与服务密钥未代填，待填项见 [配置清单](configuration-checklist.md)。

| 入口 | 已接入能力 |
| --- | --- |
| /dynamic/ | Markdown、照片、置顶、标签与年份筛选、分页；详情页沿用现有评论服务，以记录路径隔离评论 |
| /life/notebooks/ | 按目录分组、标签筛选、详情阅读；保留笔记本目录名，避免同名条目冲突 |
| /life/routines/ | 时间、状态、目标说明与 Markdown 正文；访客只读 |
| /life/places/ | 本地地图数据、缩放、足迹标记、日期、照片与正文；无需地图密钥 |
| /calendar/ | 月份切换、农历、生日、节日、公开文章、日程、日期详情与后续事件 |
| /pengyou/ | 构建时读取 RSS/Atom、跨源去重、按时间排序、作者筛选、分页及构建更新时间 |
| /timeline/ | 最近最多 300 次 Git 提交、按月分组及 GitHub 提交链接；历史缺失时显示空状态 |
| 文章分享菜单 | 作者、标题换行、简介和二维码海报，预览与 PNG 下载 |
| /admin/#writing | 文章编辑器；后台另有动态、笔记、足迹、规划、友链、导航、相册、赞助者、订阅源管理；旧 /writing/ 跳转后台 |
| /categories/分类/ 与 /tags/标签/ | 静态聚合页、文章卡片与关联标签；单篇文章标签页设置 noindex,follow |

新增内容管理支持完整 Markdown / JSON 编辑、图片上传、路径校验和版本冲突保护。本地开发写入项目文件；线上 Vercel Function 提交 GitHub 后由部署平台重新构建。现有文章编辑器保存时保留密码、评论开关和其他自定义字段。新增模块不使用默认密码，未设置后台密码时拒绝登录。

Markdown / MDX 记录可通过元信息表单编辑并保留未知字段，支持草稿发布与撤回、基础 Markdown 安全预览及上传图片插入正文。JSON 列表提供字符串、数值、布尔字段编辑，嵌套结构仍可在源码区编辑。线上保存成功后显示本次提交链接；提交完成和部署上线是两个独立状态。

友链、导航、相册、赞助者和订阅源的数据位于 src/data/*.json；原配置导出保留。友链申请脚本与后台使用同一份 JSON。友链巡检每日运行，只生成 Actions 摘要和报告，不自动删除或修改友链。

日历直接共享构建时节日数据，不向本站发起 HTTP 请求。节假日外部接口失败时使用内置传统节日，不将其当作完整的法定放假或调休安排。日历隐藏草稿和密码文章。动态、笔记和生活记录的草稿不生成公开详情页。

离线地图使用 [Natural Earth 公有领域数据](https://www.naturalearthdata.com/about/terms-of-use/)，数据随站点发布。朋友圈有单源超时、响应体大小上限及并发限制；单源失败不阻断构建。订阅内容需重新构建才能刷新。

验证命令：

- pnpm check
- pnpm type-check
- pnpm test:features
- pnpm test:writing-api
- pnpm build
- pnpm check:configuration（仅显示本机配置是否存在，不输出密钥）
- node scripts/test-feature-browser.mjs（默认访问本机 4322 端口，可用 FEATURE_TEST_ORIGIN 指定；需 Chrome）

浏览器测试的编辑请求采用拦截数据，不向仓库发布测试内容。真实 GitHub 提交、线上部署和外部评论服务仍需在填写凭据后验证。
