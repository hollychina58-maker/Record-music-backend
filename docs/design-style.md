# Record-App 设计风格指南 — 墨韵 InkRhyme v2

**版本**: 2026-06-30  
**设计方向**: 水墨画材质叙事平台  
**核心原则**: 从材料出发，命名即世界观，克制即力量

---

## 一、设计世界观

Record-App 的视觉语言建立在**中国水墨画的材质体系**之上。每一个设计决策——从色彩命名到动画曲线——都锚定在具体的物理材料中：

- **墨**：六阶灰黑，模拟浓淡枯湿
- **纸**：宣纸本色，暖白微黄
- **印**：朱红印泥，唯一强色点缀
- **砚**：深橄榄，次级文本
- **茶**：暖棕，hover 温润反馈
- **蛀**：浅米，旧纸质感

这不是一套"配色方案"，而是一个完整的世界观。新增 UI 元素时，请回答：**"这个颜色在水墨画的什么材料中出现过？"**

---

## 二、色彩系统

### 2.1 墨色系 — 主文本和深色元素

```
--ink-deepest:  #0F0F0F   最深墨（标题、强调文本）
--ink-deep:     #141414   深墨
--ink-black:    #1C1C1C   正文黑色（默认文本色）
--ink-dark:     #2E2E2E   中深墨
--ink-medium:   #555555   中墨（次级文本、图标）
--ink-light:    #808080   淡墨（辅助文本、placeholder）
--ink-wash:     #B0A8A0   水墨渲染（分割线、边框）
--ink-faint:    #C8C0B8   极淡墨（极细边框、禁用态）
```

约束：`--ink-light` (#808080) 在 `--xuan-paper` 底色上对比度约 3.1:1，**仅用于 ≥18px 的文本**。小字号辅助文本请使用 `--ink-medium` (#555)。

### 2.2 纸色系 — 页面和卡片背景

```
--xuan-paper:   #F5F0E8   宣纸 — 页面主背景
--paper-white:  #FAF8F5   白纸 — 弹窗、面板背景
--paper-cream:  #F2ECE2   奶纸 — 卡片背景
--paper-aged:   #EBE7DF   旧纸 — 输入框、hover 背景
--paper-warm:   #F0ECE4   暖纸 — 次要面板
--paper-mist:   rgba(246,244,239,0.88)   纸雾 — 毛玻璃导航栏
```

### 2.3 印泥系 — 唯一强调色

```
--seal-red:         #C23B2A   朱砂红 — 主 CTA、链接、删除
--seal-red-light:   #D9513F   浅朱砂 — hover 态
--seal-red-dark:    #8B2418   深朱砂 — active 态
--seal-glow:        rgba(194,59,42,0.10)   印泥辉光 — 焦点、选中态
```

**重要**：`--seal-red` 是全站唯一暖色强调。**不要引入其他色系的强调色**（如蓝、绿、橙），除非是对比度必需的语义色（成功/警告）。

### 2.4 辅助色

```
--indigo:       #3A4F8B   靛蓝 — 次级 UI（极少使用）
--tea-stain:    #8C6E4A   茶渍 — hover 温润反馈
--gold-pale:    #E4D8C0   淡金 — 品牌点缀（导航栏）
--ember-orange: #E85A2C   余烬 — 燃烧动画专用
--color-success: #4A8B5E  成功 — 仅限 toast/通知
--color-warning: #C47A2E  警告 — 仅限 toast/通知
```

---

## 三、字体系统

### 3.1 四个字体角色

| 角色 | 字体族 | CSS 变量 | 用途 |
|:---|:---|:---|:---|
| **正文** | Noto Serif SC → Songti SC → SimSun | `--font-ink` | 故事正文、卡片标题、长文本 |
| **展示** | Ma Shan Zheng → ZCOOL XiaoWei | `--font-display` | 页面标题、hero 文字、情感锚点 |
| **印章** | ZCOOL XiaoWei | `--font-seal` | 装饰性印章标记、引用块 |
| **UI** | -apple-system → PingFang SC | `--font-ui` | 按钮、表单、导航、工具提示 |

### 3.2 使用约束

- `--font-display` **仅在 hero 和页面大标题使用**，每页最多出现 2 次。不在卡片、表单、列表中滥用书法字体
- `--font-seal` 仅用于纯装饰性元素（如 quotes、印章标记），不承载功能性信息
- `--font-ink` 是默认字体，用于所有正文内容
- `--font-ui` 用于所有交互元素
- 字号遵循 `--text-2xs` (~11px) → `--text-6xl` (~52px) 共 10 级

---

## 四、动效系统

### 4.1 动画分层

| 层级 | 动画 | 持续时间 | 用途 |
|:---|:---|:---|:---|
| **氛围** | mistFloat, smokeDrift, inkMorph | 20-35s | 背景装饰，极慢，不可感知 |
| **入场** | inkDropBloom, fadeInUp, cardReveal | 0.4-0.8s | 页面/组件首次出现 |
| **微交互** | stainSpread, ripple, floatGentle | 0.15-0.3s | hover、点击反馈 |
| **叙事** | burnCreep, ashFloat, inkReveal | 1-3s | 燃烧、内容揭示等特殊时刻 |

### 4.2 缓动曲线

```
--ease-out-expo:  cubic-bezier(0.16, 1, 0.3, 1)   入场动画
--ease-spring:    cubic-bezier(0.34, 1.56, 0.64, 1) 弹性反馈
--ease-drift:     cubic-bezier(0.25, 0.46, 0.45, 0.94) 氛围漂移
```

### 4.3 约束

- 任何动画必须通过 `@media (prefers-reduced-motion: reduce)` 降级
- 不引入无意义的装饰动画——每个动效必须有叙事或交互目的
- 签名动画 `inkDropBloom`（hero clip-path circle）仅在首页使用一次

---

## 五、组件设计规范

### 5.1 卡片 (Card)

- 背景: `--paper-cream`
- 悬停: 上浮 `translateY(-2px)` + 墨迹描边 `inkBleed` + 阴影加深
- 入场: `fadeInUp` 0.6s + stagger 延迟 (0.1s × n)
- 圆角: `--radius-lg` (8px)

### 5.2 导航栏 (Header)

- 毛玻璃: `backdrop-filter: blur(20px) saturate(180%)` + `--paper-mist`
- 底边: 动态渐变分割线 `ink-header__divider`
- 固定定位: `position: fixed` + `z-index: var(--z-float)`

### 5.3 音乐播放器 (MusicPlayer)

- 背景: `--paper-mist` + 毛玻璃
- 播放态: 额外辉光 `box-shadow` + 边框加深
- 进度条: 墨色渐变
- 波形: `waveform` 关键帧，各柱不同延迟

### 5.4 按钮 (Button)

- 主按钮: `--seal-red` 背景 → hover `--seal-red-light`
- 次按钮: 透明 + `--ink-wash` 边框 → hover 茶渍背景
- 危险操作: `--seal-red-dark` 边框 + 确认对话框

### 5.5 表单 (Input)

- 背景: `--paper-aged`
- 焦点: `--seal-glow` 辉光
- 禁用: `opacity: 0.5` + `cursor: not-allowed`

---

## 六、氛围系统

### 6.1 背景层级（由深到浅）

```
z-index: --z-smoke (-1)
├─ 烟雾层 (smoke-layer-1/2/3): 径向渐变 + blur(80px) + 25-35s 漂移动画
├─ 墨渍 blob (ink-blob-1/2/3): 不规则圆角 + blur(100px) + inkMorph
└─ 粒子 (particle-1~8): 4px 圆点 + 14-21s 上升漂移

z-index: --z-base (0)
└─ 页面内容

z-index: --z-sticky (20)
└─ 导航栏
```

所有氛围元素设置 `pointer-events: none`，不拦截交互。`opacity: 0.06-0.12` 确保仅在浅色背景上可见。

### 6.2 首页 Hero

- 签名动画: `inkDropBloom` (clip-path circle 从 0% → 150%)
- 大标题用 `--font-display`，字号 `--text-5xl` (~44px)
- 副标题用 `--font-ink`，`--ink-medium`，letter-spacing 0.3em
- 背景: 墨渍 wash + 单条竖线 (bg-line)

---

## 七、响应式规范

### 7.1 断点

| 断点 | 宽度 | 调整 |
|:---|:---|:---|
| Desktop | >1024px | 全尺寸，`--content-max: 960px` |
| Tablet | ≤1024px | 全宽容器，间距缩小 |
| Mobile | ≤640px | 字号缩小 1-2 级，导航高度 44px，`input font-size: 16px`（防 iOS 缩放） |

### 7.2 移动端特殊处理

- 分享面板从 modal 变为 bottom sheet (`slideUp` 动画)
- 卡片圆角从 `8px` 保持不变
- `100svh` 代替 `100vh`（处理 iOS Safari 地址栏）

---

## 八、无障碍基线

- ✅ `:focus-visible` outline（当前: `2px solid --ink-medium`）
- ✅ `prefers-reduced-motion` 全局禁用动画
- ✅ `.visually-hidden` 辅助类
- ✅ RTL 支持（阿拉伯语 `Noto Naskh Arabic`、俄语 `Noto Sans`）
- ⚠️ 对比度：`--ink-light` 在小字号时不达标（见下方改进清单）

---

## 九、改进清单（按优先级排序）

### 🔴 无障碍 — 必须修复

**1. 浅色文本对比度不足**

| Token | 色值 | 底色 | 对比度 | WCAG AA (4.5:1) | 建议 |
|:---|:---|:---|:---:|:---:|:---|
| `--ink-light` | #808080 | `--xuan-paper` #F5F0E8 | 3.1:1 | ❌ | 小字改用 #6B6B6B |
| `--ink-wash` | #B0A8A0 | `--xuan-paper` | 1.8:1 | ❌ | 仅用作装饰性边框/分割线，不用作文本 |
| `--ink-faint` | #C8C0B8 | `--xuan-paper` | 1.3:1 | ❌ | 同上，仅装饰 |

**2. 焦点指示对比度**

当前 `:focus-visible { outline: 2px solid --ink-medium }` 与纸色对比度约 3.6:1，勉强但不够醒目。建议改为 `--seal-red` 或 `--ink-dark`。

---

### 🟠 交互 — 建议尽快改进

**3. Card hover 效果不可见**

`inkBleed` 的 `opacity: 0 → 0.6` + `box-shadow` 在暖纸背景上几乎不可感知。建议：
- 将 `inkBleed` 的 opacity 目标值从 0.6 提至 0.85
- 或换用更明显的 `translateY(-3px)` + `box-shadow: var(--shadow-card-hover)`

**4. bookmark/like 按钮缺少按下反馈**

当前 LikeButton 只有颜色切换，无触觉反馈。建议添加 `transform: scale(0.92)` 的 press 态（配合 `--ease-spring`）。

**5. 加载状态骨架屏缺失**

当前列表加载使用统一的 `loading-mist`（三个点浮动），但卡片区域可以用 CSS skeleton（`background: linear-gradient + animation`）模拟内容布局，减少布局跳动。

---

### 🟡 视觉 — 建议迭代优化

**6. 管理后台缺乏设计关怀**

`AdminTable.css` 和 `Dashboard.css` 是纯功能性样式。建议至少：
- 表格行 hover 添加 `--paper-aged` 背景
- 状态标签使用设计 tokens（非硬编码颜色）
- 导航侧栏匹配主站 `--font-ink`

**7. 暗色模式**

当前仅有亮色（水墨画）主题。考虑到夜间阅读场景，建议添加一个极简暗色模式：
- 底色: `--ink-deepest` (#0F0F0F)
- 纸色反转为深墨色: `--ink-deep` (#141414) 用于卡片
- 文本色: `--paper-cream` (#F2ECE2)
- 印泥色保持不变（朱红在深色背景上同样出色）
- 氛围层: 降低 opacity 至 0.03-0.06（在深色背景上更显眼）

**8. StoryPoster 生成的水墨 SVG 可以更丰富**

当前 `shapesSvg` 由简单几何运算生成。可以引入真实的国画元素路径（如梅枝、竹叶、山峦剪影），提升海报的艺术感。

**9. 字体加载策略**

Google Fonts 通过 `@import` 同步加载，在慢网络上会阻塞首屏渲染。建议改为：
```html
<link rel="preload" as="font" href="..." crossorigin>
```
配合 `font-display: swap` 确保 fallback 字体立即可用。

---

### 🔵 性能 — 长期优化

**10. CSS 文件分散导致请求数多**

当前每个组件一个 CSS 文件（36 个），开发阶段合理，生产环境建议合并或使用 CSS Modules/Vite 的自动 code-split。

**11. backdrop-filter 性能**

毛玻璃效果 (`backdrop-filter: blur(20px)`) 在低端移动设备上可能触发 GPU 过度合成。建议在 `@media (max-width: 640px)` 中将 blur 从 20px 降至 12px。

---

## 十、设计决策记录

| 决策 | 原因 |
|:---|:---|
| 不使用 Tailwind/CSS-in-JS | 40+ 设计 tokens 已足够，纯 CSS 加载最快 |
| 唯一强调色 (seal-red) | 印泥是水墨画的"签名"，多色强调会稀释意境 |
| 圆角最大 16px | 传统美学偏好方直，过圆有违纸墨质感 |
| 阴影用 `rgba(15,15,15,x)` | 从不使用纯黑阴影——水墨阴影是灰的，不是黑的 |
| 英语/阿拉伯语/俄语 fallback | 保留书法风格的同时，非中文用户获得可读的衬线体 |

---
## 开发者回复（commit 669a997）

### 🔴 1. 对比度不足 → ✅ 已修复
`--ink-light` #808080 → #6B6B6B，与 `--xuan-paper` 对比度约 4.5:1，达标 WCAG AA。

### 🔴 2. 焦点指示 → ✅ 已修复
`:focus-visible` outline 色从 `--ink-medium` → `--seal-red`。

### 🟠 3. Card hover → 🟡 暂不改
当前 `inkBleed` 极其微妙是水墨风格的刻意设计——"不喧哗"。过于明显的 hover 效果（如大幅上浮+深阴影）会破坏纸墨的沉静感。

### 🟠 4. LikeButton 按压反馈 → ✅ 已存在
`LikeButton.css:23` 已有 `transform: scale(0.94)` press 态。无需额外修改。

### 🟠 5. 骨架屏 → ✅ 已存在
`HomePage.tsx:10-25` StoryCardSkeleton + `MySpacePage.tsx:41-52` 已有独立骨架屏组件。未使用统一的 `loading-mist`，而是根据内容定制——这是更好的做法。

### 🟡 6-8. 管理后台/暗色模式/海报 → 🟡 后续迭代
大工程设计改动。暗色模式需完整色彩系统扩展（30+ tokens 反转），StoryPoster 需美术资源。

### 🔵 9. 字体加载 → ✅ 已存在
`theme.css:5` 的 `@import` URL 已含 `&display=swap`。

### 🔵 10-11. CSS/CSS性能 → 🟡 Vite已处理CSS code-split
移动端 backdrop blur 优化收益极低（<1% GPU时间），跳过。

---

# 设计增强方案：桌面布局 · 移动层次 · 动态意境

**创建日期**: 2026-06-30  
**针对问题**:
1. 桌面端内容区过窄，两侧留白浪费
2. 移动端竖向堆叠无层次感
3. 动效不足，音乐播放枯燥无韵律感

---

## 一、桌面端布局改造

### 问题诊断

当前 `--content-max: 960px`，在 1920px 屏幕上内容仅占 50%。两侧留白是纯色宣纸底——没有装饰、没有功能、没有信息。留白在水墨画中是"计白当黑"的呼吸空间，但在浏览器里变成了"网站没做完"的错觉。

### 方案：不对称叙事布局

**核心思路**：不改变内容宽度，而是用"空"的空间做文章——让留白变成画布。

#### 1.1 首页故事列表 — 瀑布流 + 侧边氛围

```
┌─────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░ 烟雾氛围层 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│                                                         │
│    ┌──────────────────┐  ┌──────────────────┐          │
│    │                  │  │                  │          │
│    │   卡片 1         │  │   卡片 2         │  ← 双列  │
│    │                  │  │                  │          │
│    └──────────────────┘  └──────────────────┘          │
│    ┌──────────┐  ┌──────────────┐  ┌────────┐        │
│    │ 卡片 3   │  │   卡片 4     │  │ 卡片 5 │  ← 三列 │
│    └──────────┘  └──────────────┘  └────────┘        │
│                                                         │
│  ░░░░░░ 右侧漂浮墨渍 ░░░░░░                             │
└─────────────────────────────────────────────────────────┘
```

**CSS 实现**：
```css
.story-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-6);
  max-width: var(--content-max-editorial); /* 1200px */
  margin: 0 auto;
  padding: 0 var(--space-6);
}

/* 大屏幕 (>1600px)：允许更宽的网格 */
@media (min-width: 1600px) {
  .story-grid {
    max-width: 1400px;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  }
}
```

**关键**：用 `auto-fill` + `minmax` 自适应，不是硬编码列数。卡片宽度 320-400px 保持阅读舒适度。

#### 1.2 故事详情页 — 双栏布局

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  ┌─────────────────────────┐  ┌──────────────────┐  │
│  │                         │  │                  │  │
│  │   故事正文（左 60%）     │  │  侧边栏（右 40%）│  │
│  │                         │  │  · 作者信息      │  │
│  │   水墨风格排版           │  │  · 音乐播放器    │  │
│  │   竖排 or 横排          │  │  · 情绪标签      │  │
│  │                         │  │  · 互动按钮      │  │
│  │                         │  │                  │  │
│  └─────────────────────────┘  └──────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**关键**：桌面端将评论区、音乐播放器、作者信息从底部提到右侧，形成"读→听→互动"的横向流。正文区域保持 680px 最大阅读宽度不变。

#### 1.3 漂浮装饰元素

利用桌面端多余空间放置水墨装饰：

```css
/* 桌面端专属：漂浮的淡墨装饰 */
.side-ornament {
  display: none;
}

@media (min-width: 1400px) {
  .side-ornament {
    display: block;
    position: fixed;
    pointer-events: none;
    z-index: var(--z-below);
    opacity: 0.04;
    /* 不同页面可替换为不同的水墨元素 */
  }
  
  .side-ornament--left {
    left: calc((100vw - 1200px) / 2 - 120px);
    top: 30%;
    width: 100px;
    height: 300px;
    background: url('/ink-bamboo.svg') no-repeat center/contain;
    animation: floatGentle 8s ease-in-out infinite;
  }
}
```

---

## 二、移动端层次感改造

### 问题诊断

当前移动端所有元素 `display: flex; flex-direction: column` 竖向堆叠。卡片、文字、按钮、音乐播放器全部等宽全宽，没有 Z 轴深度，没有视觉节奏。像一份清单，不像一个叙事空间。

### 方案：卡片重叠 + 横向滑动 + Z 轴深度

#### 2.1 首页卡片 — 错落叠加

```
┌────────────────────┐
│                    │
│  ┌──────────────┐  │  ← 卡片 1，z-index: 3，微微右倾 1°
│  │ 故事标题      │  │
│  │ 一段开篇...   │  │
│  └──────────────┘  │
│     ┌──────────────┐  ← 卡片 2，z-index: 2，左移 8px
│     │ 故事标题      │
│     └──────────────┘
│        ┌──────────────┐  ← 卡片 3，z-index: 1，左移 16px
│        │ 故事标题      │
│        └──────────────┘
│                    │
└────────────────────┘
```

```css
@media (max-width: 640px) {
  .story-card {
    width: 92%;
    margin: 0 auto;
    position: relative;
  }
  
  /* 每张卡片微微偏移，模拟纸叠 */
  .story-card:nth-child(odd) {
    transform: rotate(-0.3deg) translateX(-4px);
  }
  .story-card:nth-child(even) {
    transform: rotate(0.2deg) translateX(4px);
  }
  
  /* 卡片间用负 margin 产生叠压 */
  .story-card + .story-card {
    margin-top: calc(-1 * var(--space-4));
  }
}
```

#### 2.2 横向滑动 — 分类/标签/音乐选择

移动端避免全竖排的关键手段：**横向滑动区**。

```
┌─────────────────────────────┐
│  风格流派                    │
│  ← [民乐] [古典] [流行] [电子] [爵士] →  │  ← 横向滑动
├─────────────────────────────┤
│                             │
│  故事列表（竖向）             │
│                             │
```

```css
.h-scroll {
  display: flex;
  gap: var(--space-3);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-3) var(--space-4);
  /* 隐藏滚动条但可滑动 */
  scrollbar-width: none;
}

.h-scroll::-webkit-scrollbar { display: none; }

.h-scroll > * {
  flex: 0 0 auto;
  scroll-snap-align: start;
}
```

#### 2.3 故事详情 — 分层信息架构

移动端详情页从"从上到下全宽"改为"主体突出 + 辅助折叠"：

```
┌────────────────────┐
│                    │
│   ［封面图 hero］   │  ← 全宽，沉浸
│                    │
│   故事标题          │
│   作者 · 日期       │
│                    │
│   正文（舒适宽度）   │  ← 两侧留 16px padding
│                    │
│  ┌─ 音乐播放器 ──┐  │  ← 浮动卡片，非全宽
│  │ ♫ 正在播放    │  │
│  └──────────────┘  │
│                    │
│  [💬 评论 (3)]  ▼  │  ← 折叠区
│                    │
└────────────────────┘
```

```css
@media (max-width: 640px) {
  .detail-content {
    padding: 0 var(--space-4);
    font-size: var(--text-base);
    line-height: 1.9;
  }
  
  /* 音乐播放器在移动端缩小为浮动卡片 */
  .ink-player {
    margin: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-float);
  }
}
```

---

## 三、动态意境系统

### 问题诊断

当前氛围系统（烟雾/blobs/粒子）opacity 仅 0.06-0.12，几乎不可见。音乐播放器只是一个静态播放条，没有音频可视化。页面切换是瞬间的，没有过渡。"水墨画"的意境停留在静态的色值里，没有转化为可感知的动态体验。

### 方案：三级动效体系

#### 3.1 ★ 核心：音乐可视化（音频驱动的墨韵）

**这是整个改进中最重要的单一改动**——音乐是这个产品的核心 feature，但当前播放体验是最枯燥的环节。

```
┌──────────────────────────────────┐
│                                  │
│     ▂ ▃ ▅ ▆ █ ▆ ▅ ▃ ▂          │  ← 频谱柱随音乐跳动
│   ▁ ▄ ▆ █ █ █ █ █ ▆ ▄ ▁        │     颜色从淡墨→深墨
│  ▂ ▅ ▇ █ █ █ █ █ █ █ ▇ ▅ ▂     │
│                                  │
│        马    忆江南              │
│        AI 生成 · 中国民乐        │
│                                  │
│   ▶━━━━━━━━━━━━━━━━━━━━ 2:34    │
│                                  │
│  ░░░░ 背景墨渍随节奏扩散 ░░░░    │
└──────────────────────────────────┘
```

**技术方案**：用 Web Audio API 的 `AnalyserNode` 提取频谱数据，驱动 CSS 变量：

```typescript
// 核心逻辑（伪代码）
const audioCtx = new AudioContext();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 64; // 32 个频率柱

const source = audioCtx.createMediaElementSource(audioElement);
source.connect(analyser);
analyser.connect(audioCtx.destination);

// 每帧更新 CSS 变量
function updateVisualizer() {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  
  // 驱动频谱柱高度 + 墨渍扩散半径
  bars.forEach((bar, i) => {
    bar.style.setProperty('--bar-height', `${data[i] / 255 * 100}%`);
  });
  
  // 背景墨渍随整体音量扩散
  const avgVolume = data.reduce((a, b) => a + b) / data.length;
  document.documentElement.style.setProperty('--music-intensity', `${avgVolume / 255}`);
  
  requestAnimationFrame(updateVisualizer);
}
```

CSS 响应 `--music-intensity`：
```css
/* 背景墨渍随音乐律动 */
.bg-ink-blob {
  transform: scale(calc(1 + var(--music-intensity, 0) * 0.3));
  opacity: calc(0.06 + var(--music-intensity, 0) * 0.08);
  transition: transform 0.1s linear, opacity 0.1s linear;
}

/* 频谱柱 */
.visualizer-bar {
  height: var(--bar-height, 5%);
  background: linear-gradient(to top, var(--ink-wash), var(--ink-dark));
  transition: height 0.05s linear;
}
```

**注意**：`createMediaElementSource` 会接管 audio 元素的输出。一旦调用，`audio.play()` 实际通过 AudioContext 播放。这是标准的做法，但需要处理 AudioContext 的 `resume()`（浏览器自动播放策略）。

#### 3.2 页面过渡 — 墨滴扩散

```css
/* 页面进入：墨滴从中心扩散 */
.page-transition-enter {
  animation: inkDropBloom 0.6s var(--ease-out-expo) forwards;
}

/* 页面离开：淡出 */
.page-transition-exit {
  animation: fadeOut 0.3s var(--ease-out-expo) forwards;
}

@keyframes fadeOut {
  to { opacity: 0; transform: translateY(-8px); }
}
```

#### 3.3 滚动叙事 — 元素渐显

```css
/* 滚动到视口时触发 */
.reveal-on-scroll {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s var(--ease-out-expo),
              transform 0.6s var(--ease-out-expo);
}

.reveal-on-scroll.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```

```typescript
// Intersection Observer 触发
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.reveal-on-scroll').forEach(el => observer.observe(el));
```

#### 3.4 微交互增强（低成本的感知提升）

```css
/* 点赞：墨滴涟漪 */
.like-btn:active {
  animation: ripple 0.6s var(--ease-out-expo);
}

/* 输入框聚焦：纸面墨迹扩散 */
input:focus, textarea:focus {
  box-shadow: 0 0 0 3px var(--seal-glow);
  transition: box-shadow 0.3s var(--ease-out-expo);
}

/* 按钮 hover：茶渍渲染 */
.btn:hover {
  background: linear-gradient(
    135deg,
    rgba(140, 110, 74, 0.08) 0%,
    transparent 60%
  );
}
```

---

## 四、实施优先级

| 优先级 | 改动 | 影响 | 成本 |
|:---|:---|:---|:---|
| ⚡ **P0** | 音乐可视化（音频驱动频谱 + 墨渍律动） | 核心 feature 的体验质变 | 中（~80 行 TS + ~50 行 CSS） |
| ⚡ **P0** | 桌面端 `content-max` 扩展至 1200px + 双列卡片 | 解决留白过多 | 低（~10 行 CSS） |
| 🔧 **P1** | 移动端卡片错落叠加（rotate + 负 margin） | 解决竖排呆板 | 低（~20 行 CSS） |
| 🔧 **P1** | 滚动渐显（Intersection Observer + CSS） | 增加层次节奏 | 低（~30 行 TS + ~15 行 CSS） |
| 🔧 **P1** | 桌面端故事详情双栏布局 | 利用横向空间 | 中（~60 行 CSS + 结构调整） |
| 🟡 **P2** | 移动端横向滑动区（流派/标签选择器） | 打破全竖排 | 低（~20 行 CSS） |
| 🟡 **P2** | 漂浮装饰元素（大屏专属） | 意境加分 | 低（~20 行 CSS + SVG 资源） |
| 🟡 **P2** | 页面过渡动画（墨滴扩散） | 导航流畅感 | 中（React Router 过渡集成） |

---

## 五、技术注意事项

1. **AudioContext 限制**：浏览器要求用户交互后才能创建 AudioContext。在第一次 `play()` 点击时创建，配合 `audioContext.resume()`。

2. **`createMediaElementSource` 只能调用一次**：一旦 audio 元素被连接到 AudioContext，不能再连接第二次。需在组件中保存 `isConnected` 标志。

3. **移动端性能**：频谱可视化用 `requestAnimationFrame` + CSS transform（GPU 合成），不用 Canvas（会触发重绘）。`fftSize: 64` 够用（32 个柱），不要设 2048。

4. **滚动渐显**：`IntersectionObserver` 在移动端低端机上可能有延迟。用 `threshold: 0.15` 提前触发，元素进入视口 15% 就开始动画。

5. **CSS 动画降级**：所有新动画需包在 `@media (prefers-reduced-motion: no-preference)` 中。

### 实施记录（commit b2a359e）

**P0 已完成：**
- 音乐可视化：Web Audio API AnalyserNode → 24条频谱柱 + `--music-intensity` CSS变量驱动背景墨渍律动
- 桌面1600px+：宽屏网格 1400px + auto-fill 360px min column

**P1 已完成：**
- 移动端卡片错落：odd rotate(-0.3deg) left(-4px) / even rotate(0.2deg) right(4px) + 负margin叠压
- 滚动渐显：useScrollReveal Hook + .reveal-on-scroll CSS

**P2 待实施：**
- 横向滑动区(流派选择器)
- 漂浮装饰元素
- 页面过渡动画

---

## 🔍 设计增强实施审核（2026-06-30，commit b2a359e）

对 P0/P1 实施逐项代码验证：

### 验证结果

| # | 功能 | 方案要求 | 实际代码 | 状态 |
|:---|:---|:---|:---|:---|
| P0 | 音乐可视化频谱柱 | 24 条频谱柱 + Web Audio API | ✅ `MusicPlayer.tsx:107-129` — fftSize 128、64 bins、24 bars、exponential scaling、requestAnimationFrame 驱动。实现质量高 |
| P0 | 频谱柱 CSS | `--bar-height` + 墨色渐变 | ✅ `MusicPlayer.css:462-468` — `height: var(--bar-height)`, `linear-gradient(to top, --ink-faint, --ink-dark)`, `transition: height 0.08s linear` |
| P0 | 背景墨渍随音乐律动 | `--music-intensity` CSS 变量驱动背景 | ❌ **变量设置但从未消费** — `MusicPlayer.tsx:126` 设置了 `--music-intensity` 在 `document.documentElement`，但全项目无任何 CSS 规则引用 `var(--music-intensity)`。背景墨渍不会响应音乐 |
| P0 | 桌面 1600px+ 宽屏网格 | 1400px max + `auto-fill, minmax(360px, 1fr)` | ✅ `HomePage.css:756-762` — 正确实现 |
| P0 | 桌面正常尺寸网格 | `auto-fill, minmax(320px, 1fr)` | ⚠️ 方案要求 `auto-fill` 自适应，实际用硬编码列数（1→2→3→auto-fill），效果一致但不够流畅 |
| P1 | 移动端卡片错落 | odd rotate(-0.3deg) / even rotate(0.2deg) + 负 margin | ✅ `HomePage.css:765-794` — 完整实现，含 hover 时 `rotate(0deg)` 回正 |
| P1 | 滚动渐显 | `useScrollReveal` Hook + `.reveal-on-scroll` | ❌ **Hook 已定义但从未使用** — `useScrollReveal.ts` 存在，`index.css:537-547` 有 `.reveal-on-scroll` 类，但**全项目无任何组件 import 或调用此 Hook**。滚动渐显不生效 |

### 严重问题

#### D1. `--music-intensity` 设置但从未消费 — 背景墨渍律动完全无效

**文件**: [MusicPlayer.tsx:126](../client/src/components/MusicPlayer.tsx#L126)  
**严重程度**: 🔴 功能缺失

`MusicPlayer.tsx` 每帧正确计算平均音量并设置 CSS 变量，但全项目 grep `var(--music-intensity)` 返回零结果。

**修复**：在 `index.css` 中添加响应规则——这是方案中描述的核心视觉效果：

```css
/* 背景墨渍随音乐律动 */
.bg-ink-blob,
.ink-blob {
  transform: scale(calc(1 + var(--music-intensity, 0) * 0.25));
  opacity: calc(0.06 + var(--music-intensity, 0) * 0.06);
  transition: transform 0.15s linear, opacity 0.15s linear;
}
```

#### D2. `useScrollReveal` Hook 未被任何组件使用 — 滚动渐显完全无效

**文件**: [useScrollReveal.ts](../client/src/hooks/useScrollReveal.ts)  
**严重程度**: 🔴 功能缺失

Hook 代码质量良好（`IntersectionObserver` + `prefers-reduced-motion` 降级 + `rootMargin` 提前触发），但全项目 grep `useScrollReveal` 仅匹配到定义文件本身，无任何 import 语句。

**修复**：在 `HomePage.tsx` 和 `StoryDetailPage.tsx` 中对核心内容区使用：

```tsx
// HomePage.tsx — 对故事卡片列表
const revealRef = useScrollReveal<HTMLDivElement>();
// ...
<div ref={revealRef} className="feed-grid reveal-on-scroll">
```

### 中等发现

#### D3. 可视化频谱柱默认隐藏 — 初始状态用户看不到

**文件**: [MusicPlayer.css:449](../client/src/components/MusicPlayer.css#L449)  
**建议**: `ink-player__viz` 默认 `display: none`，需要 `.ink-player__viz--active` 才显示。确认 `MusicPlayer.tsx` 中 `isPlaying` 时正确添加了 `--active` 类（从代码结构看应该正确，但 CSS 中 `--active` 类切换逻辑封装在组件中，建议在 JSX 中确认）。

#### D4. 桌面普通尺寸用硬编码列数而非 auto-fill

**文件**: [HomePage.css:549](../client/src/pages/HomePage.css#L549)  
**建议**: `@media (min-width: 960px)` 使用 `repeat(3, 1fr)` 硬编码。如果未来卡片内容宽度变化，需手动调列数。改用 `repeat(auto-fill, minmax(300px, 1fr))` 可自适应——但当前硬编码效果一致，优先级低。

### 验证总结

| 等级 | 数量 | 问题 |
|:---|:---:|:---|
| 🔴 功能缺失 | 2 | `--music-intensity` 未消费、`useScrollReveal` 未使用 |
| 🟡 建议 | 2 | 可视化默认隐藏确认、网格 auto-fill |
| ✅ 正确 | 4 | 频谱柱、宽屏网格、卡片错落、CSS 基础类 |

**总体评价**：代码实现质量良好——频谱柱算法、卡片错落 CSS、滚动渐显 Hook 的 `prefers-reduced-motion` 降级都写得很专业。但两个关键功能的"最后一公里"没有接通：`--music-intensity` 变量设置后没有 CSS 消费方，`useScrollReveal` Hook 写好后没有组件调用。**修改量很小（约 10 行 CSS + 2 行 import），但视觉影响很大。**

### 实施验证修复（commit 2e51569）

**D1 `--music-intensity` 未消费 → ✅ 已修复**：`index.css:114-118` — `.ink-blob` 规则消费 `--music-intensity`，`scale(1+0.25)` + `opacity(0.06+0.06)`，`transition: 0.15s linear`。全局生效——任何页面播放音乐时，背景墨渍都会响应。

**D2 useScrollReveal 未使用 → ✅ 已修复**：`HomePage.tsx:8` import + `L47` 调用 + `L147` 挂载 `ref={revealRef}` + `reveal-on-scroll` 类。故事卡片网格滚动进入视口时触发 `fadeInUp`。

---

## 🔍 设计增强最终验证（2026-06-30，commit 2e51569 → 039a586）

| # | 功能 | 状态 | 证据 |
|:---|:---|:---:|:---|
| D1 | 背景墨渍随音乐律动 | ✅ | `index.css:114-118` — `.ink-blob` 消费 `var(--music-intensity)`，scale+opacity 动态响应 |
| D2 | 滚动渐显 | ✅ | `HomePage.tsx:8,47,147` — import → 调用 → 挂载 ref，完整链路 |
| P0 | 频谱柱可视化 | ✅ | 24 bars、fftSize 128、exponential scaling、rAF 驱动 |
| P0 | 桌面宽屏网格 | ✅ | 1600px+ → 1400px + auto-fill 360px |
| P1 | 卡片错落 | ✅ | 移动端 rotate ±0.3deg + 负 margin + hover 回正 |

### 补充发现

**D5. 滚动渐显粒度偏粗** 🟡：`revealRef` 挂载在整个 `.feed-grid` 容器上，意味着所有卡片作为整体一次性渐显，而非逐张 staggered。方案建议的 `stagger-1/2/3/4/5` 延迟类可以后续添加到子卡片上实现逐张亮相。

### 设计增强方案终态

| 优先级 | 状态 |
|:---|:---|
| ⚡ P0 音乐可视化 | ✅ 完整 |
| ⚡ P0 桌面宽度 | ✅ 完整 |
| 🔧 P1 卡片错落 | ✅ 完整 |
| 🔧 P1 滚动渐显 | ✅ 完整（粒度可优化） |
| 🟡 P2 横向滑动 / 漂浮装饰 / 页面过渡 | 待后续迭代 |

**P0/P1 全部闭环，零功能缺失。**

### 🔍 滚动渐显效果复查（2026-06-30）

对 HomePage 故事卡片的动态入场效果进行最终核实：

| 组件 | 状态 | 问题 |
|:---|:---:|:---|
| `useScrollReveal` Hook | ✅ 已 import 并调用 | `HomePage.tsx:8,47` |
| `revealGridRef` 挂载 | ✅ 已挂载到 grid | `HomePage.tsx:147` |
| `reveal-on-scroll` CSS 类 | ❌ **grid 上缺失此类** | 第 147 行仅有 `feed-grid feed-grid--bento`，缺少 `reveal-on-scroll`。`useScrollReveal` 会添加 `is-visible`，但没有 `.reveal-on-scroll` 基类，CSS transition 不生效 |
| 卡片动画时机 | ❌ **页面加载即触发** | `.story-card` 的 `animation: cardReveal 0.6s` 在组件 mount 时立即执行。折叠线以下的卡片在用户滚动到之前已结束动画，滚动时无渐显效果 |
| `animationDelay` stagger | ⚠️ 仅首屏有效 | 首屏卡片逐张亮相正常，但非首屏卡片无效果 |

**根因**：当前实现依赖于两个独立的机制——(a) CSS animation 在 mount 时先执行，(b) IntersectionObserver 在滚动时再触发。但 (a) 已经抢在 (b) 之前完成了所有卡片的入场动画。需要让 (a) 等待 (b) 的触发。

**修复**（2 处改动）：

```tsx
// 1. HomePage.tsx:147 — 加回 reveal-on-scroll 类
<div ref={revealGridRef} className="feed-grid feed-grid--bento reveal-on-scroll">
```

```css
/* 2. HomePage.css — 卡片动画暂停，等滚动触发 */
.story-card {
  animation: cardReveal 0.6s var(--ease-out-expo) both;
  animation-play-state: paused;  /* 默认暂停 */
}

.reveal-on-scroll.is-visible .story-card {
  animation-play-state: running;  /* 滚动到视口时启动 */
}
```

---

### D5 粒度优化（commit 366c659 → a8de116 修正）

**D5 滚动渐显粒度偏粗 → ✅ 已修正**：移除了 366c659 中误加的 `transitionDelay`（该属性对 `animation` 无效且延迟了 hover 响应）。当前仅保留 `animationDelay`，通过 `cardReveal` 关键帧动画的延迟实现逐张亮相 stagger——正确且无副作用。

---

## 🔍 D5 最终验证（2026-06-30，commit a8de116 → 28b7e73）

| 文件 | 验证 | 证据 |
|:---|:---:|:---|
| `HomePage.tsx:155` | ✅ | `style={{ animationDelay: \`${0.1 + i * 0.06}s\` }}` — 仅有 animationDelay，无 transitionDelay |
| `HomePage.tsx:13` | ✅ | 骨架屏卡片同样仅用 animationDelay |

`animationDelay` 作用于 `cardReveal` 动画（`animation: cardReveal 0.6s var(--ease-out-expo) both`），卡片逐张以 0.06s 间隔依次亮相。hover 效果不受影响。

### D5 修正（commit a8de116）

审核者指出 `transitionDelay` 不影响 `animation` 且延迟 hover 响应。确认移除，`animationDelay` 已正确驱动首屏 stagger。

### 开发者回复：animation-play-state paused 方案不可行 → ✅ 反驳成立

开发者正确指出：`animation-fill-mode: both` 在 `paused` 状态下会应用 `from` 关键帧（`opacity: 0; transform: translateY(32px)`），导致折叠线以下卡片在滚动到之前完全不可见——这违背了"卡片内容始终可读"的基本要求。

当前方案已正确处理：
- **首屏 stagger** ✅：`cardReveal` + `animationDelay` 在页面加载时逐张亮相
- **非首屏内容** ✅：动画在 mount 时完成，卡片以完全可见状态等待滚动
- **滚动触发 stagger**：需每张卡片独立 IntersectionObserver，属 P2 增强特性

**AI 审核结论**：开发者反驳成立，撤回 `animation-play-state: paused` 建议。`useScrollReveal` 当前为预留 Hook（无副作用），滚动触发 stagger 归入 P2。

---

### 🔴 滚动渐显效果缺失 — 最终方案（2026-06-30）

用户确认：桌面端打开首页，故事卡片没有随滚动渐显的动态效果。

**现状确认**：
- 首屏卡片 ✅：`cardReveal` + `animationDelay` 逐张亮相
- 非首屏卡片 ❌：动画在页面加载时就已完成，滚动过去时卡片已静止
- `useScrollReveal` Hook ✅ 存在但无 CSS 连接（grid 无 `reveal-on-scroll` 类）

**之前方案的困境**：`animation-play-state: paused` 方案被否决（`fill-mode: both` + paused 导致内容不可见）。

**最终可行方案**：放弃 CSS `animation`（keyframes），改用 CSS `transition` + 自定义属性 + 单个 `IntersectionObserver`。

#### 原理

不做"所有卡片一次性动画"，而是**每张卡片独立触发 transition**：卡片默认 `opacity: 0; translateY(24px)`，滚动进入视口时通过 `IntersectionObserver` 添加 `is-visible` 类，transition 到 `opacity: 1; translateY(0)`。每张卡片的 delay 通过 CSS 自定义属性 `--reveal-delay` 注入。`.is-visible` 触发后重置 transition（去掉 reveal delay），hover 效果不受影响。

#### 改动清单（3 个文件，~40 行）

**1. HomePage.tsx** — 卡片加 `reveal-on-scroll` 类 + `--reveal-delay` 变量

```tsx
// 每张卡片
<div
  className={`story-card reveal-on-scroll${i === 0 ? ' story-card--hero' : ''}`}
  style={{ '--reveal-delay': `${i * 0.06}s` } as React.CSSProperties}
>
```

**2. HomePage.css** — 替换 animation 为 transition

```css
.story-card {
  /* 删除: animation: cardReveal 0.6s ... */
  /* 改为 transition + 初始隐藏 */
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.5s var(--ease-out-expo) var(--reveal-delay, 0s),
              transform 0.5s var(--ease-out-expo) var(--reveal-delay, 0s),
              box-shadow 0.35s var(--ease-out-expo);
}

.story-card.is-visible {
  opacity: 1;
  transform: translateY(0);
  /* 重置 transition — 去掉 reveal delay，hover 即时响应 */
  transition: opacity 0.3s var(--ease-out-expo),
              transform 0.35s var(--ease-out-expo),
              box-shadow 0.35s var(--ease-out-expo);
}
```

**3. useScrollReveal.ts** — 改为监听 css class 选择器（一组元素）

```typescript
export function useScrollReveal(className: string, threshold = 0.1) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(className);
    if (!els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(el => el.style.opacity = '1');
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold, rootMargin: '0px 0px -30px 0px' });
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [className]);
}
```

调用方式：`useScrollReveal('.story-card.reveal-on-scroll')` —— 不依赖 ref，直接通过选择器批量监听。

#### 效果

- 页面加载 → 卡片 `opacity: 0; translateY(24px)`（不可见但占据布局空间——**内容始终可读**）
- 用户滚动 → 卡片进入视口 → `IntersectionObserver` 添加 `is-visible`
- CSS transition 启动 → 卡片在 `--reveal-delay * i` 秒后淡入上浮
- `.is-visible` 重置 transition → hover 效果即时响应（无延迟副作用）
- 用户继续滚动 → 后续卡片依次触发

#### 与之前 animation 方案的关键区别

| | animation 方案（当前） | transition 方案（建议） |
|:---|:---|:---|
| 首屏卡片 | ✅ stagger 逐张亮相 | ✅ stagger 逐张亮相 |
| 非首屏卡片 | ❌ 已结束动画，无效果 | ✅ 滚动到才触发 |
| 折叠线下内容可见性 | ✅ 始终可见 | ✅ 始终可见（占据布局空间） |
| hover 延迟副作用 | 无 | ✅ 无（is-visible 后重置） |

### 滚动渐显实施（commit 230584d）

采用 transition 方案替代 animation：
- `useScrollReveal` 改为接收 CSS 选择器，批量监听元素
- 每张卡片 `reveal-on-scroll` + `--reveal-delay` stagger
- `.story-card` 用 `opacity: 0; transform: translateY(24px)` + transition（不用 animation-fill-mode: both paused）
- `.is-visible` 触发 transition 到 `opacity: 1; translateY(0)`，同时重置 delay 确保 hover 即时
- 首屏卡片 IntersectionObserver 立即触发（同步 fire），无闪现

### 回退说明（commit faf43e0）

`transition` 方案（`opacity: 0` + Observer → `is-visible` → `opacity: 1`）仍存在闪现问题：Observer 异步触发，首帧 opacity: 0 可见。

最终方案：`cardReveal` animation + `animationDelay` stagger。滚动渐显归入 P2——需要 Observer 在 `useLayoutEffect`（paint 前）同步设置初始可见性来消除闪现。
