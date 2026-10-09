# 首页五幕相片与鲸鱼娘维护说明

首页桌面端横向展示的五张相片，图片、左侧文字、下方文案和日期都由 [homeConfig.ts](../src/config/homeConfig.ts) 中的 `homeBlinds` 配置控制。文字与日期由页面单独渲染，不是图片的一部分。

[HomeBlinds.astro](../src/components/layout/HomeBlinds.astro) 负责组装五幕及角色素材，[HomeBlindsScene.astro](../src/components/layout/HomeBlindsScene.astro) 负责每张相片的图片、左侧文字、下方文案和日期版式。日常换图、改字只需修改配置和素材。

## 五张图片的位置

`public` 是静态资源目录。浏览器访问路径从 `/assets/` 开始，不包含 `public`。本地开发时可在静态路径前加 `http://localhost:4321` 直接查看图片；部署后使用网站实际域名。

| 幕次 | 本地绝对路径 | 浏览器静态路径 | 图片配置字段 |
| --- | --- | --- | --- |
| 第一幕：筑一间小屋 | `D:\blog\public\assets\images\home-blinds\act2\1.webp` | `/assets/images/home-blinds/act2/1.webp` | `homeBlinds.reveal.backgroundImage` |
| 第二幕：小屋落户 | `D:\blog\public\assets\images\home-blinds\act3\1.webp` | `/assets/images/home-blinds/act3/1.webp` | `homeBlinds.scenes.items[0].image` |
| 第三幕：尘满窗台 | `D:\blog\public\assets\images\home-blinds\act3\2.webp` | `/assets/images/home-blinds/act3/2.webp` | `homeBlinds.scenes.items[1].image` |
| 第四幕：重燃灯火 | `D:\blog\public\assets\images\home-blinds\act3\3.webp` | `/assets/images/home-blinds/act3/3.webp` | `homeBlinds.scenes.items[2].image` |
| 第五幕：抵达之前 | `D:\blog\public\assets\images\home-blinds\act3\4.webp` | `/assets/images/home-blinds/act3/4.webp` | `homeBlinds.scenes.items[3].image` |

第一幕的文字配置在 `homeBlinds.scenes.composite`，图片则复用 `homeBlinds.reveal.backgroundImage`。替换第一幕图片时，前一层的全屏揭示背景也会一起改变。`composite` 中没有独立的 `image` 字段，不能仅在这里添加路径来换图。

`homeBlinds.reveal.foregroundImage` 是前一层的前景图，`homeBlinds.scenes.cycleImages` 是五幕背后的循环背景；它们都不是表中五张相片的独立图片配置。

## 左侧文字、下方文案与日期

各幕使用相同字段：

| 字段 | 页面位置或用途 |
| --- | --- |
| `eyebrow` | 相片左侧竖排英文 |
| `title` | 相片左侧竖排中文标题 |
| `description` | 相片下方文案 |
| `date` | 相片右下角日期；删除该字段或设为空字符串即可隐藏 |
| `alt` | 图片替代文本，供无障碍读取和图片加载失败时使用 |

### 第一幕：`homeBlinds.scenes.composite`

| 字段 | 当前值 |
| --- | --- |
| `eyebrow` | `PROLOGUE / RUN` |
| `title` | 筑一间小屋 |
| `description` | 以代码为梁、热爱为瓦，荒原上筑起一间自己的小屋。 |
| `date` | `2026 / 05 / 07` |
| `alt` | 第一幕插画 |

### 第二幕：`homeBlinds.scenes.items[0]`

| 字段 | 当前值 |
| --- | --- |
| `eyebrow` | `SCENE 02 / LIGHT` |
| `title` | 小屋落户 |
| `description` | 一纸备案落定，小屋自此有门有牌，堂堂正正晒着太阳。 |
| `date` | `2026 / 06 / 10` |
| `alt` | 第二幕插画 |

### 第三幕：`homeBlinds.scenes.items[1]`

| 字段 | 当前值 |
| --- | --- |
| `eyebrow` | `SCENE 03 / WIND` |
| `title` | 尘满窗台 |
| `description` | 人往学海拾新，倦意悄悄落了窗，小屋静候，蒙上薄尘。 |
| `date` | `2026 / 06 / 21` |
| `alt` | 第三幕插画 |

### 第四幕：`homeBlinds.scenes.items[2]`

| 字段 | 当前值 |
| --- | --- |
| `eyebrow` | `SCENE 04 / PAGE` |
| `title` | 重燃灯火 |
| `description` | 拂去薄尘，重燃灯火，一砖一瓦再把小屋细细打磨。 |
| `date` | `2026 / 08 / 18` |
| `alt` | 第四幕插画 |

### 第五幕：`homeBlinds.scenes.items[3]`

| 字段 | 当前值 |
| --- | --- |
| `eyebrow` | `FINALE / ARRIVE` |
| `title` | 抵达之前 |
| `description` | 笔墨暂歇，来日方长；下一程山水，且歌且行。 |
| `date` | `2026 / 09 / 01` |
| `alt` | 第五幕插画 |

## 如何替换图片与文字

1. 把新图片放入 `D:\blog\public\assets\images\home-blinds` 下的对应目录。可以用同名、同格式文件替换原图，也可以保留原图并使用新文件名。
2. 使用新文件名时，在 `homeConfig.ts` 中修改上表对应的图片字段，填写以 `/assets/` 开头的浏览器静态路径。扩展名必须与实际文件格式一致，不要只把 PNG 或 JPG 的文件名改成 `.webp`。
3. 修改对应幕次的 `eyebrow`、`title`、`description` 和 `date`。更换画面后同步更新 `alt`。日期是手动填写的字符串，不会根据文件时间或当前日期自动变化；可沿用 `YYYY / MM / DD` 格式。
4. 保存后在首页滚动到五幕相片区域，检查图片是否加载、文案是否溢出以及日期是否完整。使用同名素材替换后如仍显示旧图，刷新页面并清除该页缓存。

例如，修改第二幕时编辑 `homeBlinds.scenes.items` 数组的第一个对象：

```ts
{
  eyebrow: "SCENE 02 / LIGHT",
  title: "新的标题",
  description: "新的下方文案。",
  image: "/assets/images/home-blinds/act3/new-photo.webp",
  alt: "新照片的内容描述",
  date: "2026 / 10 / 06",
},
```

## 鲸鱼娘角色素材

首页跳动角色使用 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 项目的鲸鱼娘“待机呼吸休闲”动画。

| 项目 | 配置或路径 |
| --- | --- |
| 上游原始文件 | `dsh-pet/assets/webm/待机呼吸休闲.webm` |
| 本地绝对路径 | `D:\blog\public\assets\images\home-blinds\act4\whale-girl.webm` |
| 浏览器静态路径 | `/assets/images/home-blinds/act4/whale-girl.webm` |
| 角色素材配置 | `homeBlinds.scenes.standImages` |
| 来源项目 | <https://github.com/PC2005-cloud/dsh-pet> |

上游对该素材的使用要求为：允许开源使用、禁止商用，并要求注明来源项目链接。素材来源与上游使用要求记录在本说明中，分发或复用时一并保留来源说明。

本站以透明 WebM 使用该动画，已在 Edge 核验显示效果。上游 [README 的兼容性说明](https://github.com/PC2005-cloud/dsh-pet#兼容性) 表明 Chrome、Edge 和 Firefox 支持此 VP9-Alpha WebM 透明格式；Safari 可能将透明区域显示为黑色底。
