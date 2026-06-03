# 悬浮歌词面板设计文档

## 概述

为博客音乐播放器增加一个全局悬浮歌词面板，固定在视窗底部，跨页面保持显示，提供双行歌词展示效果。

## 背景

现有音乐播放器（`MusicPlayer.astro`）已具备歌词抽屉功能，但仅在侧边栏组件内显示，且懒加载模式下需展开才能查看。用户希望增加一个类似网易云音乐的底部悬浮歌词面板，随时可见。

## 目标

- 播放音乐时，歌词以悬浮面板形式固定显示在视窗底部
- 跨页面导航（Swup SPA）保持显示状态
- 不影响 Live2D 看板娘的拖拽交互
- 保留原有歌词抽屉功能，两者独立控制

## 非目标

- 不替代原有歌词抽屉组件
- 不支持逐字歌词（KRC 格式）
- 不支持歌词编辑功能

## 架构设计

### 组件位置

```
Layout.astro
├── <MusicManager />      ← 全局音频状态管理（已有）
├── <FloatingLyrics />    ← 新增：全局悬浮歌词面板
├── <slot />              ← Swup 容器（页面内容）
```

`FloatingLyrics` 位于 Swup 容器外部，因此页面切换时不会被卸载。

### 数据流

```
MusicManager (audio timeupdate)
    ↓ dispatch CustomEvent: fm:lrc-index
FloatingLyrics (监听 fm:lrc-index)
    ↓ 读取 __fireflyMusic.getState()
    ↓ 更新 DOM 文本
```

### 层级控制

| 元素 | z-index |
|------|---------|
| Live2D 看板娘 | 999 |
| 悬浮歌词面板 | 990 |
| 导航栏/浮动按钮 | 50-100 |
| 页面内容 | 1-10 |

## 组件设计

### FloatingLyrics.astro

**Props**: 无（完全自包含，通过事件驱动）

**内部状态**:
- `visible`: 是否显示面板（持久化到 localStorage）
- `currentIndex`: 当前歌词行索引
- `lyrics`: 歌词数组缓存

**DOM 结构**:
```
.floating-lyrics (fixed, bottom: 0, z-index: 990)
  ├── .lyrics-bg (backdrop-filter: blur(12px))
  ├── .lyrics-content
  │     ├── .lyric-prev (上一行, 可选)
  │     ├── .lyric-current (当前行, 主题色加粗)
  │     └── .lyric-next (下一行, 可选)
  └── .btn-close (关闭按钮)
```

### MusicPlayer.astro 修改

在歌词抽屉按钮（`.btn-lrc-toggle`）旁新增悬浮歌词切换按钮：

```
<!-- Top Right: Lyric Toggle + Floating Lyric Toggle -->
<button class="btn-lrc-toggle ...">...</button>
<button class="btn-floating-lrc-toggle ..." title="悬浮歌词">...</button>
```

点击该按钮时，dispatch 自定义事件 `fm:toggle-floating-lyrics`，由 `FloatingLyrics` 监听处理。

## 视觉设计

### 桌面端

- 高度：72px
- 背景：`rgba(var(--page-bg-rgb), 0.85)` + `backdrop-filter: blur(12px)`
- 当前歌词：16px，主题色，font-weight: 600
- 副歌词（上一行/下一行）：13px，`text-neutral-500`，opacity: 0.7
- 内边距：`py-3 px-4`
- 过渡：`transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`

### 移动端

- 高度：56px
- 当前歌词：14px
- 副歌词：12px
- 底部安全区适配：`padding-bottom: env(safe-area-inset-bottom, 0)`

### 动画

- 显示/隐藏：`translateY(100%)` ↔ `translateY(0)`，350ms
- 歌词切换：`opacity` + `transform` 过渡，200ms

## 性能优化

1. **DOM 更新批处理**：使用 `requestAnimationFrame` 批量处理歌词切换
2. **GPU 加速**：仅使用 `transform` 和 `opacity` 属性做动画
3. **页面不可见时暂停**：监听 `visibilitychange`，`document.hidden` 时跳过更新
4. **事件节流**：歌词索引变化时才更新 DOM，避免 `timeupdate` 高频触发导致重绘

## 跨浏览器兼容

- `backdrop-filter`：提供纯色背景降级（`background-color`）
- `env(safe-area-inset-bottom)`：iOS 安全区适配，不支持的浏览器回退到 0
- `CustomEvent`：所有现代浏览器均支持

## 歌词同步精准度

复用现有 `MusicManager` 的歌词同步逻辑：

```js
audio.addEventListener('timeupdate', () => {
    const ct = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
        if (ct >= lyrics[i].time) idx = i;
        else break;
    }
    if (idx !== currentLrcIndex) {
        currentLrcIndex = idx;
        emit('fm:lrc-index', { index: idx });
    }
});
```

精度依赖 `audio.currentTime` 的更新频率（通常 250ms 一次），对于 LRC 格式（精度到 10ms）已足够。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/features/FloatingLyrics.astro` | 新增 | 悬浮歌词面板组件 |
| `src/components/features/MusicPlayer.astro` | 修改 | 新增悬浮歌词切换按钮 |
| `src/layouts/Layout.astro` | 修改 | 引入 FloatingLyrics 组件 |
| `src/i18n/i18nKey.ts` | 修改 | 新增翻译键 |
| `src/i18n/languages/*.ts` | 修改 | 各语言翻译 |

## 待办事项

- [ ] 创建 `FloatingLyrics.astro` 组件
- [ ] 修改 `MusicPlayer.astro` 新增切换按钮
- [ ] 修改 `Layout.astro` 引入组件
- [ ] 添加 i18n 翻译键
- [ ] 测试 Swup 页面切换后的状态保持
- [ ] 测试 Live2D 拖拽不受干扰
- [ ] 移动端适配测试
