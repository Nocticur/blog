# 项目修复与功能完善

本轮在保留现有首页、视觉风格、生活模块与后台的基础上，参考 `MmzMing/my-blog` 提交 `4faa53cc0ed3db8356302f016aa9466fc148ff1a` 完善功能。没有覆盖个人配置或推送、部署改动。

## 已修复

- 目录和日历将标题、ID 当作文本处理，避免 HTML 注入；日历首次加载即可初始化。
- 内容管理、文章读取和相关构建脚本统一限制 Frontmatter 为 YAML / JSON，禁止执行 JavaScript 引擎；Markdown / MDX 均支持版本冲突保护。
- 文章日期检查真实日历日期，非法日期在写入前拒绝；图片文件名使用 UUID，避免同秒上传覆盖。
- 友链申请校验真实锚点回链，检查 DNS 公网地址并固定连接地址，约束同源跳转、超时和响应大小；已有友链修改转人工审核。
- 密码文章的自动摘要与章节不进入公开卡片及关系图；留言板刷新与退出登录清除已删除或失去权限的服务端消息。
- LQIP 缓存结合图片内容指纹，替换同路径图片后更新占位；`.env.*` 默认忽略，示例文件保留。
- 本地开发提供最近构建生成的 Pagefind 索引，修复搜索索引请求 404；内容变更后需重新构建索引。
- 后台登录增加尝试次数限制。限制的部署边界见 [配置清单](configuration-checklist.md)。
- 更新 Astro、Sharp 与漏洞相关依赖；图标直接读取已安装的 Iconify 数据，移除引入 ZIP 解压漏洞的 `astro-icon`。

## 功能与维护改进

- 分类与标签生成静态聚合页，保留中文及大小写差异；含路径保留字符的名称生成无冲突的单段路径。`pages.categories` 关闭时不生成聚合详情页，文章上的分类／标签链接退回已有归档筛选。
- 分享图片依次使用生成图、封面、默认图，并生成绝对 HTTP(S) 地址。
- 桌面文章目录支持按章节折叠；文章卡片与渲染入口统一，构建共享渲染缓存，开发环境保持内容实时更新。
- 后台提供元信息表单、JSON 标量字段编辑、图片插入、草稿发布与撤回、安全 Markdown 预览及 GitHub 提交链接。预览不执行 MDX 组件，完整效果以构建结果为准。
- 音乐 UI 控制器改为模块，避免重复挂载监听，并在父容器移除后释放全局监听。
- CI 加入 TypeScript、单元与安全回归、完整构建及浏览器回归，并修复已有 Biome 错误。
- README 修正配置位置、后台入口及静态托管与线上编辑的差别；隐私说明补充实际使用的 IP 欢迎语和后台本机存储。

## 验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm type-check
pnpm check:quality
pnpm test:unit
pnpm test:security-browser
pnpm build
pnpm test:browser
pnpm audit
```

浏览器测试需要 Chrome，使用本机开发服务器并拦截后台保存请求，不发布测试内容。测试涵盖中文分类／标签、日历首次初始化、分享元数据、后台表单和发布、编辑工作区、导航、冲突状态、欢迎语及恶意 HTML。外部服务账号归属、真实 GitHub 写入和线上部署结果仍需在配置凭据后验证。

依赖审计是针对锁文件的已知漏洞检查，不代表不存在未知漏洞。升级依据包括 [Astro / Sharp AVIF 安全公告](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2)。部署配置与用户数据填写见 [配置清单](configuration-checklist.md)。

本机已通过冻结锁文件安装、Astro / TypeScript 检查、Biome 检查、单元与安全回归、完整构建和浏览器回归；依赖审计为 0 项已知漏洞。Biome 仍有 7 条非阻断警告及风格建议，构建保留大于 500 kB 的包体积提示和 Astro 生成的 MDX 指令提示，后续可继续优化类型与拆包。
