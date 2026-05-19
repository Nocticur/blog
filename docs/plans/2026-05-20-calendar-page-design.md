# 日历页面设计稿

- 日期: 2026-05-20
- 路由: `/calendar/`
- 状态: 已确认,待实施

## 一、目标

在站点新增独立日历页面,聚合显示节日 / 生日 / 安排 / 文章发布日,采用现代化丰富网格风格,黑白克制基调,4 类事件局部点缀色,完整支持桌面/平板/移动端,所有数据源统一通过 `calendarConfig.ts` 配置。

## 二、垂直结构(自上而下)

1. 面包屑
2. 标题 + 描述(图标 tile 黑底白图)
3. EventOverview: 今日事件 + 未来 30 天概览
4. CalendarGrid: 月视图丰富网格
5. EventDetailPanel: 选中日的卡片列表

```
┌─ MainGridLayout ──────────────────────────────────┐
│ ┌─ card-base ─────────────────────────────────┐  │
│ │ Breadcrumb: 首页 / 日历                      │  │
│ │ [tile] 日历                                  │  │
│ │        副标题                                │  │
│ │ ───────────────────────────────────────────  │  │
│ │ 今日事件 (如果今天有)                        │  │
│ │ 未来 30 天 [卡] [卡] [卡] [卡] [卡] [卡]     │  │
│ │ ───────────────────────────────────────────  │  │
│ │ 月份导航  < 2026 年 5 月 >  [回到今日]       │  │
│ │ ┌─ 6×7 网格 ─────────────────────────────┐  │  │
│ │ │ 周一 周二 周三 …                        │  │  │
│ │ │ [日 + 农历 + 事件胶囊 ≤3 / +N more]    │  │  │
│ │ └────────────────────────────────────────┘  │  │
│ │ ───────────────────────────────────────────  │  │
│ │ 详情: 选中 5 月 20 日                        │  │
│ │ [色条][icon] 标题 — 副标题 [标签]            │  │
│ │ [色条][icon] 标题 — 副标题 [标签]            │  │
│ └─────────────────────────────────────────────┘  │
│ (右侧默认侧边栏保留)                              │
└───────────────────────────────────────────────────┘
```

## 三、文件结构

```
src/
├── pages/
│   ├── calendar.astro                    (新)受 pages.calendar 开关控制
│   └── api/holidays.json.ts              (新)构建时拉取 timor.tech 缓存
├── config/
│   ├── calendarConfig.ts                 (新)
│   └── index.ts                          扩展导出
├── types/config.ts                       扩展 pages.calendar + CalendarConfig
├── components/
│   ├── common/Breadcrumb.astro           (新)通用组件
│   └── pages/calendar/
│       ├── EventOverview.astro           (新)
│       ├── CalendarGrid.svelte           (新)Svelte 5 状态驱动
│       ├── EventDetailPanel.svelte       (新)
│       └── eventTypes.ts                 (新)类型/颜色/图标映射
├── utils/
│   ├── calendar-events.ts                (新)聚合 4 类事件
│   └── lunar-utils.ts                    (新)封装 lunar-typescript
├── i18n/
│   ├── i18nKey.ts                        追加 calendar.* 键
│   └── languages/*.ts                    每种语言追加翻译
└── config/navBarConfig.ts                追加 Calendar 入口
```

新依赖: `lunar-typescript` (~30KB,零依赖,处理农历/节气/生肖)。

## 四、配置示意 `calendarConfig.ts`

```ts
export const calendarConfig: CalendarConfig = {
  title: "",
  description: "",
  showComment: false,

  holidayApi: {
    enable: true,
    url: "https://timor.tech/api/holiday/year/",
    fallbackOnError: true,
    years: [2026, 2027],
  },

  builtinHolidays: [
    { name: "立春", date: { type: "solar", month: 2, day: 4 } },
    { name: "七夕", date: { type: "lunar", month: 7, day: 7 } },
  ],

  birthdays: [
    { name: "我的生日", date: { type: "lunar", month: 8, day: 15 }, note: "..." },
    { name: "建博周年", date: { type: "solar", month: 5, day: 7 } },
  ],

  schedules: [
    { title: "毕业答辩", date: "2026-06-15", note: "..." },
    {
      title: "周报",
      recurring: { freq: "weekly", weekday: 5 },
    },
    {
      title: "结婚纪念日",
      recurring: { freq: "yearly", month: 10, day: 1, lunar: false },
    },
  ],

  show: {
    posts: true,
    lunarDate: true,
    weekNumber: false,
  },

  overview: {
    futureDays: 30,
    maxItems: 6,
  },
}
```

### 类型摘要(写入 `src/types/config.ts`)

```ts
type SolarOrLunarDate = { type: "solar" | "lunar"; month: number; day: number }

type HolidayItem = {
  name: string
  date: SolarOrLunarDate
  icon?: string
  note?: string
}

type BirthdayItem = {
  name: string
  date: SolarOrLunarDate
  note?: string
  icon?: string
}

type ScheduleItem = {
  title: string
  note?: string
  icon?: string
  date?: string                                      // "YYYY-MM-DD"
  recurring?: {
    freq: "yearly" | "monthly" | "weekly"
    month?: number
    day?: number
    weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    lunar?: boolean
  }
}

type CalendarConfig = {
  title?: string
  description?: string
  showComment?: boolean
  holidayApi: {
    enable: boolean
    url: string
    fallbackOnError: boolean
    years: number[]
  }
  builtinHolidays: HolidayItem[]
  birthdays: BirthdayItem[]
  schedules: ScheduleItem[]
  show: { posts: boolean; lunarDate: boolean; weekNumber: boolean }
  overview: { futureDays: number; maxItems: number }
}
```

## 五、事件颜色与图标

| type | icon | 色板(亮/暗) | i18n 标签 |
|---|---|---|---|
| holiday | `material-symbols:celebration` | red-500 / red-400 | 节日 |
| birthday | `material-symbols:cake` | pink-500 / pink-400 | 生日 |
| schedule | `material-symbols:event` | sky-500 / sky-400 | 安排 |
| post | `material-symbols:article` | neutral-700 / neutral-300 | 文章 |

色彩只用在「左侧 4px 色条」「胶囊背景的低透明度填充 12%」「8px 圆点」等局部位置。整页主基调黑白灰,跟随 `collections.astro` 风格。

## 六、数据流

### 构建期(SSG)

```
calendar.astro frontmatter (Astro SSG):
  ├── 检查 siteConfig.pages.calendar,关闭则 302 /404/
  ├── 取 calendarConfig
  ├── if holidayApi.enable: 调 /api/holidays.json(内部 endpoint)
  │     └── 该 endpoint 内部对 timor.tech 按 years[] 循环 fetch + try/catch
  │         合并 builtinHolidays,失败回退仅用 builtin
  ├── fetch /api/allPostMeta.json (已存在)→ 文章列表
  ├── 不在 SSG 期展开 birthdays/schedules: 仅把原始配置 JSON 嵌入页面
  └── 把 holidays + posts + birthdays + schedules 四份原始数据
       序列化到 <script type="application/json" id="calendar-data">
```

### 运行期(客户端)

```
CalendarGrid.svelte onMount:
  ├── 读 #calendar-data JSON
  ├── 用 lunar-utils 把当前显示年份内的所有「农历事件」与「重复事件」
  │     展开为公历日期 → events[]
  ├── 按 dateKey (YYYY-MM-DD) 分桶
  ├── 渲染当前 displayYear / displayMonth 的 6×7 网格
  ├── 点击日 → 更新 selectedDateKey → EventDetailPanel 联动
  └── 月份切换 → 重新 expand + 渲染
```

农历展开按"显示年份及其后一年"做缓存,翻月不重算。

## 七、面包屑通用组件

`src/components/common/Breadcrumb.astro`:

```astro
---
interface BreadcrumbItem {
  label: string
  href?: string   // 不填则当前页(无链接)
  icon?: string
}
interface Props {
  items: BreadcrumbItem[]
  class?: string
}
---
<nav aria-label="Breadcrumb" class={...}>
  <ol class="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
    {items.map((it, i) => (
      <li class="flex items-center gap-1">
        {i > 0 && <Icon name="material-symbols:chevron-right" class="text-xs" />}
        {it.href ? (
          <a href={it.href} class="hover:text-(--primary) transition-colors">
            {it.icon && <Icon name={it.icon} />} {it.label}
          </a>
        ) : (
          <span class="text-neutral-900 dark:text-neutral-100 font-medium">{it.label}</span>
        )}
      </li>
    ))}
  </ol>
</nav>
```

移动端 `<640px` 仅显示「← 上一级名称」回退按钮。

## 八、响应式

| 断点 | 网格格高 | 每格事件 | 未来概览 | 备注 |
|---|---|---|---|---|
| ≥1024 | 100px | 1-3 标题 | 6 列网格 | 完整 |
| 768-1023 | 80px | 1-2 标题 | 3 列 | 简化 |
| <768 | 52px | 圆点 ≤4 | 横滑卡片 | 标题 tile 28px,面包屑收起 |

触控热区始终 ≥ 40px(通过 padding 补齐)。

## 九、配色

| 元素 | 配色 |
|---|---|
| 标题图标 tile | `bg-black dark:bg-white` + `text-white dark:text-black` |
| 选中日高亮 | `ring-2 ring-neutral-900 dark:ring-neutral-100` |
| 今日 ring | `ring-1 ring-neutral-900/40 dark:ring-neutral-100/40` |
| 分隔线 | `border-neutral-200 dark:border-neutral-800` |
| 卡片悬浮 | `hover:border-neutral-900 dark:hover:border-neutral-100` |
| 文章 type | `bg-neutral-700 dark:bg-neutral-300`(取代 primary) |
| 节日/生日/安排 | 各自彩色,但仅局部使用 |

## 十、边界与错误

- `pages.calendar = false` → `Astro.redirect("/404/")`
- timor.tech 请求失败 → 仅用 `builtinHolidays`,控制台 warn
- 农历换算 throw → 单条事件 skip,不影响其他
- 配置项缺失字段 → 跳过该条
- 客户端 fetch 失败(走 page-load 重渲染场景) → 用 ssr 嵌入数据保底
- Swup 切换页面 → 监听 `astro:page-load` 重新初始化

## 十一、i18n 追加键

```
calendar
calendarDescription
calendarToday
calendarTomorrow
calendarDaysLater         (例 "{n} 天后")
calendarBirthday
calendarHoliday
calendarSchedule
calendarPost
calendarLunar
calendarUpcoming          ("近期")
calendarTodayEvents       ("今日")
calendarNoEvents          ("今日没有日程")
calendarMore              ("+{n} 更多")
calendarBackToToday
```

五个语言文件全部补齐。

## 十二、开关接入

- `siteConfig.pages` 新增 `calendar: boolean`,默认 `true`
- `types/config.ts` 中 `pages` 类型扩展
- `types/config.ts` `LinkPreset` 枚举追加 `Calendar = 10`
- `i18n/translation.ts` 的 preset → I18nKey 映射追加
- `navBarConfig.ts` 在「工具」子菜单加入(也可在「我的」)
- `config/index.ts` barrel 导出 `calendarConfig`

## 十三、不做的(YAGNI)

- 不实现完整 iCal RRULE(只支持 yearly/monthly/weekly 三种 freq)
- 不做周视图、日视图切换
- 不做事件编辑/CRUD(纯配置驱动)
- 不接第三方日历同步(Google Calendar/iCloud)
- 不做拖拽
- 不实现 24 节气(可后续扩展,先放进 builtinHolidays 即可)
- 不增加全局水波纹/动画背景,保持页面专注
