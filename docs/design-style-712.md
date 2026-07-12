# Record-App UI/UX 设计优化建议

> **审核日期**: 2026-07-12
> **审核范围**: 全前端（18 个组件、13 个页面、4 个 CSS 文件、36 个 CSS 文件）
> **审核方法**: 组件 CSS token 覆盖率扫描 + UX 模式（空状态/加载/错误/表单验证）审计 + 现有设计文档对比

---

## 📊 总体评估

| 维度 | 评级 | 说明 |
|:---|:---|:---|
| 设计系统成熟度 | 🟡 良好 | theme.css 定义 100+ tokens，但 8 个组件/页面完全脱离系统 |
| UX 模式一致性 | 🟠 不足 | 空状态/错误/加载缺少统一组件，6+ 页面静默吞错误 |
| 无障碍 | 🟡 良好 | prefers-reduced-motion 全覆盖，focus-visible 已修复，但缺 aria 标注 |
| 响应式 | 🟢 优秀 | 3 断点体系 + 移动端 iOS 防缩放 + 100svh |
| 动效系统 | 🟢 优秀 | 四层动效体系（氛围/入场/微交互/叙事），18 个 keyframes |

---

## 🔴 P0 — 设计 Token 合规（影响视觉一致性）

以下 8 个组件/页面**完全或部分脱离了 ink-wash 设计系统**，使用硬编码颜色或引用了 theme.css 中不存在的 CSS 变量：

### 1. VoiceInput.css — 10 个不存在的 CSS 变量 🔴

- **文件**: `client/src/components/VoiceInput.css`
- **问题**: 引用了 10 个 theme.css 中不存在的 token：
  - `--spacing-sm`（应为 `--space-2` 或 `--space-3`）
  - `--color-ink-light-gray`（不存在，应映射为 `--ink-wash` 或 `--ink-faint`）
  - `--color-white`（不存在，应为 `--paper-white`）
  - `--color-ink-medium`（不存在，应为 `--ink-medium`）
  - `--color-paper-dark`（不存在，应为 `--paper-aged`）
  - `--color-ink-dark`（不存在，应为 `--ink-dark`）
  - `--color-ink-black`（不存在，应为 `--ink-black`）
  - `--color-ink-light`（不存在，应为 `--ink-light`）
  - `--color-ink-gray`（不存在，应为 `--ink-medium`）
  - `--duration-normal`（不存在，应为 `--transition-normal`）
  - `--ease-out`（不存在，应为 `--ease-out-expo`）

**映射表**:

| 当前（无效） | 正确 token |
|:---|:---|
| `--spacing-sm` | `--space-2` |
| `--color-ink-light-gray` | `--ink-wash` |
| `--color-white` | `--paper-white` |
| `--color-ink-medium` | `--ink-medium` |
| `--color-paper-dark` | `--paper-aged` |
| `--color-ink-dark` | `--ink-dark` |
| `--color-ink-black` | `--ink-black` |
| `--color-ink-light` | `--ink-light` |
| `--color-ink-gray` | `--ink-medium` |
| `--duration-normal` | `--transition-normal` |
| `--ease-out` | `--ease-out-expo` |

---

### 2. Input.css — 5 个不存在的 CSS 变量 🔴

- **文件**: `client/src/components/Input.css`
- **问题**: 引用了以下不存在的 token：
  - `--ink-tertiary`（不存在，应为 `--ink-faint` 或 `--ink-light`）
  - `--ink-primary`（不存在，应为 `--ink-black`）
  - `--ink-secondary`（不存在，应为 `--ink-dark`）
  - `--gray-medium`（不存在，应为 `--ink-wash`）
  - `--gray-light`（不存在，应为 `--ink-faint`）
  - `--gray-dark`（不存在，应为 `--ink-medium`）

**映射表**:

| 当前（无效） | 正确 token |
|:---|:---|
| `--ink-tertiary` | `--ink-faint` |
| `--ink-primary` | `--ink-black` |
| `--ink-secondary` | `--ink-dark` |
| `--gray-medium` | `--ink-wash` |
| `--gray-light` | `--ink-faint` |
| `--gray-dark` | `--ink-medium` |

**补充说明**: `Input.tsx` 组件已经构建了完整的错误 UI（红色下划线 + 错误消息），但在代码库中**完全没有被任何表单使用**——所有表单均使用原生 `<input>`。建议推广该组件。

---

### 3. LikeButton.css — 全部硬编码 🔴

- **文件**: `client/src/components/LikeButton.css`
- **问题**: 全部使用硬编码颜色，无任何 design token：
  - 默认色 `#bbb` → 应映射为 `--ink-faint`
  - hover 色 `#e07373` → 应映射为 `--seal-red-light`
  - liked 色 `#d44` → 应映射为 `--seal-red`
  - liked-hover 色 `#c33` → 应映射为 `--seal-red-dark`
  - disabled 色 `#ccc` → 应映射为 `--ink-faint`

**映射表**:

| 当前（硬编码） | 正确 token |
|:---|:---|
| `#bbb` | `--ink-faint` |
| `#e07373` | `--seal-red-light` |
| `#d44` | `--seal-red` |
| `#c33` | `--seal-red-dark` |
| `#ccc` | `--ink-faint` |

---

### 4. LanguageSwitcher.css — 全部硬编码 🔴

- **文件**: `client/src/components/LanguageSwitcher.css`
- **问题**: 全部硬编码灰色，与 ink-wash 系统的暖灰基调不协调：
  - 边框 `#444` → 应为 `--ink-dark`
  - 文字 `#999` → 应为 `--ink-medium`
  - hover 边框 `#666` → 应为 `--ink-medium`
  - hover 文字 `#ccc` → 应为 `--ink-light`
  - focus 边框 `#888` → 应为 `--seal-red`（全局 focus-visible 标准）

---

### 5. StoryPoster.css — 全部硬编码 🟠

- **文件**: `client/src/components/StoryPoster.css`
- **问题**: 海报是视觉重点组件，但所有颜色均为硬编码：
  - 字体 `"Noto Serif SC"` → 硬编码而非 `var(--font-ink)`
  - 文字色 `rgba(255,255,255,0.85)` → 海报文字在深色背景上，可保留但建议添加注释说明
  - 心情印章边框 `rgba(255,255,255,0.3)` → 同上
- **建议**: 至少将字体族改为 `var(--font-ink)` 和 `var(--font-seal)`，颜色上可以保留白色覆盖（因为海报背景是动态生成的深色水墨）。

---

### 6. CheckoutPage.css — 独立深色主题 🟠

- **文件**: `client/src/pages/CheckoutPage.css`
- **问题**: 使用完全独立的深紫/蓝色配色方案（`#0f0c29`, `#1a1a2e`, `#16213e`, `#c8bfff`），与全站水墨画风格完全脱节。
- **背景**: 这可能是支付页面的刻意设计决策——深色主题暗示"进入交易的安全空间"。
- **建议**: 如果保留独立主题，至少使用 `var(--font-ink)`、`var(--font-ui)` 等字体 token，并在文档中注明这是刻意偏离。

---

### 7. MusicBanner.css — 大量硬编码 🟠

- **文件**: `client/src/components/MusicBanner.css`
- **问题**: 仅使用 `--nav-height` 和 `--z-toast` 两个 token，其余全部硬编码：
  - 背景 `rgba(22,18,14,0.92)` — 暗色毛玻璃
  - 按钮边框 `rgba(255,255,255,0.10)` — 白色半透明
- **建议**: 至少使用 `--ink-deepest` 替代 `#16120e`，用 `--gold-pale` 替代白色文字。

---

### 8. Admin 模块（4 个 CSS 文件）— 完全独立的设计 🟡

- **文件**: `AdminLayout.css`, `Dashboard.css`, `AdminTable.css`, `AdminProductsPage.css`
- **问题**: 全部硬编码颜色，使用浅色管理面板风格（`#f5f3ee` 底 + `#1a1a1a` 侧栏 + `#fff` 卡片），完全不使用 ink-wash tokens。
- **严重程度**: 🟡（后续迭代）— admin 是内部工具，用户体验优先级低于主站，但长期应统一。
- **最低限度改进**: 将字体族改为 `var(--font-ink)` / `var(--font-ui)`，底色改为 `var(--xuan-paper)`。

---

## 🟠 P1 — UX 模式一致性

### 9. 缺少统一的空状态组件 🔴

**现状**: 7 个页面使用 `.empty` CSS 类实现了相似的空状态，但：
- `ProfilePage` 使用了完全不同的自定义 SVG 插图风格
- `CommentSection` 评论为空时无任何反馈（仅渲染空白容器）
- `MessageDetailPage` 消息为空时无反馈
- `PhotoInspirationPage` 无空状态处理

**建议**: 创建统一的 `<EmptyState>` 组件：
```tsx
<EmptyState
  icon="ink"               // "ink" | "message" | "comment" | "music" | "notification"
  title={t('empty.title')}
  hint={t('empty.hint')}
  action={{ label: t('empty.action'), to: '/create' }}
/>
```

---

### 10. 缺少统一的错误状态组件 🔴

**现状**: 至少 6 个页面/组件使用 `.catch(() => {})` 静默吞错误：
- `MessagesPage.tsx:26` — 网络错误时用户看到永久旋转器
- `MessageDetailPage.tsx:56,71-76` — 同上
- `ProfilePage.tsx:38` — 仅 console.error，用户无感知
- `UserProfilePage.tsx:54` — 静默失败，用户看到挂起的"加载中..."
- `CommentSection.tsx` — 评论获取失败静默处理
- `NotificationBell.tsx` — 获取失败静默处理

**错误 UI 也各自不同**:
- `HomePage` 复用 `.empty` 布局（带重试按钮）
- `MySpacePage` 用自定义 `.error-state` CSS
- `LoginPage`/`RegisterPage` 用 `.error-message`
- `CheckoutPage` 用 `.payment-error`

**建议**: 
1. **短期**: 给所有静默 `.catch(() => {})` 至少添加 `console.error` + Toast 通知
2. **长期**: 创建统一的 `<ErrorState>` 组件，含重试按钮

---

### 11. 骨架屏 CSS 重复定义 🟠

- **文件**: `HomePage.css:699-750` 和 `MySpacePage.css:467-535`
- **问题**: `.story-card--skeleton`、`.skeleton-poster`、`.skeleton-line` 等类在两个文件中重复定义，样式几乎相同。
- **建议**: 提取到 `client/src/components/Skeleton.css` 作为共享样式。

---

### 12. Input.tsx 组件构建但未被使用 🟠

- **文件**: `client/src/components/Input.tsx` + `Input.css`
- **问题**: 组件内置完整的错误 UI（`.ink-input__field--error`、红色下划线动画、错误消息），但所有表单仍使用原生 `<input>`。
- **影响**: 
  - `CreateStoryPage` 手动实现了字段级验证 UI
  - `LoginPage`/`RegisterPage` 手动实现了表单级错误
  - `MySpacePage` 个人资料编辑完全无验证
- **建议**: 在 `CreateStoryPage`、`MySpacePage` 编辑模式中率先采用 `Input` 组件，逐步推广。

---

### 13. Toast loading 类型定义但从未使用 🟡

- **文件**: `client/src/components/Toast.tsx`
- **问题**: Toast 系统定义了 `loading` 类型（持续旋转、不自动关闭），但代码库中没有任何 `addToast('loading', ...)` 调用。
- **建议**: 在以下场景使用 loading toast：
  - 故事发布中（`CreateStoryPage` 提交）
  - 音乐重新生成中（`StoryDetailPage`）

---

### 14. 音乐状态在列表/个人资料页缺失 🟡

- **影响页面**: `MySpacePage`、`UserProfilePage`、`ProfilePage`
- **现状**: 
  - `MySpacePage` 仅在已完成的音乐旁显示 `♪` 图标，无 pending/failed/expired 徽章
  - `UserProfilePage` / `ProfilePage` 完全不显示音乐状态
- **建议**: 复用 `HomePage` 的 `MusicBadge` 组件，在故事卡片上统一显示音乐状态。

---

### 15. 评论为空时无反馈 🟡

- **文件**: `client/src/components/CommentSection.tsx`
- **问题**: 评论列表为空时渲染空白 `<div className="cmt-list">`，用户看不到任何反馈。
- **建议**: 添加空状态提示（如"暂无评论，来写下第一条吧"）。

---

## 🟡 P2 — 增强与打磨

### 16. 非首屏滚动渐显缺失（P2 延续）

- **来源**: `design-style.md` P2 待办
- **现状**: 首屏卡片 stagger 正常（`cardReveal` + `animationDelay`），但折叠线以下卡片在 mount 时已完成动画，滚动时无渐显效果。
- **建议**: 需在 `useLayoutEffect` 同步设置初始可见性 + 逐张卡片独立 IntersectionObserver 来消除闪现。

---

### 17. 移动端横向滑动区（P2 延续）

- **来源**: `design-style.md` P2 待办
- **现状**: 分类/标签选择器未实现移动端横向滑动。
- **影响**: 移动端全部竖向堆叠，缺乏视觉节奏变化。

---

### 18. 悬浮装饰元素（P2 延续）

- **来源**: `design-style.md` P2 待办
- **现状**: 大屏（>1600px）两侧无水墨装饰，纯色宣纸底显得"未完成"。
- **建议**: 实现大屏专属 SVG 水墨装饰（竹叶、山峦剪影），仅在 `@media (min-width: 1600px)` 下渲染。

---

### 19. 页面过渡动画（P2 延续）

- **来源**: `design-style.md` P2 待办
- **现状**: 路由切换瞬间无过渡，页面生硬跳变。
- **建议**: 实现墨滴扩散式路由过渡（clip-path circle 动画），配合 `framer-motion` 的 `AnimatePresence` 或纯 CSS。

---

## 🔵 无障碍改进

### 20. 加载状态缺少 aria-live 通知 🟡

- **问题**: 骨架屏和 loading 文字没有 `aria-live="polite"` 或 `aria-busy="true"` 标注，屏幕阅读器用户无法感知加载状态。
- **建议**: 在骨架屏容器上添加 `aria-busy="true"`，加载完成后更新为 `aria-busy="false"`。

---

### 21. LanguageSwitcher 使用原生 select 🟡

- **问题**: `appearance: auto` 保留浏览器默认下拉样式，在 ink-wash 主题中显得突兀。
- **建议**: 自定义下拉样式以匹配设计系统，或改用自定义 dropdown 组件。

---

### 22. 部分交互元素缺少 focus 样式 🟡

- **问题**: `LikeButton`、`VoiceInput`、`LanguageSwitcher` 等组件没有 `:focus-visible` 样式（全局已设 `outline: 2px solid var(--seal-red)` 在 `:focus-visible` 上，但某些组件可能有自己的 outline 覆盖）。
- **建议**: 逐一检查确保 focus 样式不被覆盖。

---

## 📋 优先修复路线图

### 第一轮（1-2 天，零风险）
| # | 动作 | 文件 |
|:---|:---|:---|
| **#1** | VoiceInput.css 11 个无效 token → 映射为正确 token | `VoiceInput.css` |
| **#2** | Input.css 6 个无效 token → 映射为正确 token | `Input.css` |
| **#3** | LikeButton.css 5 个硬编码 → 映射为 token | `LikeButton.css` |
| **#4** | LanguageSwitcher.css 5 个硬编码 → 映射为 token | `LanguageSwitcher.css` |
| **#10** | 6 处静默 `.catch(() => {})` 添加 `console.error` | 6 个页面/组件 |
| **#15** | CommentSection 添加空评论提示 | `CommentSection.tsx` |

### 第二轮（3-5 天，低风险）
| # | 动作 | 文件 |
|:---|:---|:---|
| **#9** | 创建统一 `<EmptyState>` 组件 | 新建 component |
| **#10b** | 创建统一 `<ErrorState>` 组件 | 新建 component |
| **#11** | 提取骨架屏共享 CSS | `Skeleton.css` |
| **#12** | 在 CreateStoryPage/MySpacePage 中采用 Input 组件 | 2 个页面 |
| **#13** | 为关键操作添加 loading toast | 2 个页面 |

### 第三轮（后续迭代）
| # | 动作 |
|:---|:---|
| **#6** | CheckoutPage 深色主题评估 |
| **#8** | Admin 模块最低限度设计对齐 |
| **#5** | StoryPoster 字体 token 化 |
| **#7** | MusicBanner 颜色 token 化 |
| **#14** | 列表/个人资料页音乐状态统一 |
| **#16-19** | P2 增强（滚动渐显、横向滑动、漂浮装饰、页面过渡） |
| **#20-22** | 无障碍改进 |

---

## 📝 设计决策记录

| 决策 | 原因 |
|:---|:---|
| 优先修复无效 token（而非硬编码） | VoiceInput/Input 引用的变量不存在导致样式静默回退为浏览器默认值——功能上比硬编码更严重 |
| CheckoutPage 深色主题暂缓统一 | 支付页面的深色风格可能是刻意设计（暗示"进入安全交易空间"），需与产品确认后再改 |
| Admin 对齐归入第三轮 | 内部工具，用户面优先级低，且涉及 4 个 CSS 文件全部重写 |
| 先加 console.error 再建 ErrorState 组件 | 静默错误是最紧急的 UX 问题（用户无感知），添加日志是零风险的止血措施 |

---

## 附录：与 design-style.md 的关系

此文档 (`design-style-712.md`) 是对 `design-style.md` (v2, 2026-06-30) 的**补充而非替代**。关系如下：

- `design-style.md` 定义了设计的"宪法"——世界观、色彩系统、组件规范、动效系统
- `design-style-712.md` 扫描了宪法的"执行情况"——哪些组件遵守了规范、哪些偏离了、UX 模式是否一致

两个文档应同步维护。`design-style.md` 中的改进清单已有开发者回复（部分修复/暂不改），此文档新增的发现均未在 `design-style.md` 中记录。

---
## 开发者回复（commit 0a9c394）

### P0 已修复
| # | 文件 | 修复 |
|:---|:---|:---|
| #1 | VoiceInput.css | 11 无效 token → 正确 token |
| #3 | LikeButton.css | 5 硬编码 → 对应 token |
| #4 | LanguageSwitcher.css | 5 硬编码 → 对应 token |
| #2 | Input.css | 组件未使用，暂不修 |
| #15 | CommentSection | 空评论提示 |

### P1/P2 记录
剩余 17 项（#5-#22）中大部分为设计决策（CheckoutPage 深色主题刻意设计、Admin 独立风格、StoryPoster 保留白字等），已纳入技术债务。空状态/错误状态组件化作为后续统一迭代。

---

# 动效系统专项审核（2026-07-12）

> **触发原因**: 用户反馈整体 UI "动感不足"
> **审核方法**: 逐页扫描 animation/keyframes/transition 使用密度 + 交互场景动效缺口检查 + 页面切换机制检查

---

## 📊 动效热力图

按每页 CSS 中 `animation`/`@keyframes`/`transition` 声明数量分级：

| 热度 | 页面/组件 | 动效声明数 | 状态 |
|:---|:---|:---:|:---|
| 🔥🔥🔥 | **HomePage** | 32 | 丰富 — bgBreath + inkDropBloom + cardReveal + shimmer + vizPulse + cardIn |
| 🔥🔥🔥 | **CreateStoryPage** | 18 | 丰富 — fadeIn + voicePulse + voiceRing + tab 切换动画 |
| 🔥🔥🔥 | **BurnConfirmModal** | 15 | 优秀 — burnFadeIn + corePulse + emberOrbit + textFadeInOut |
| 🔥🔥 | **StoryDetailPage** | 17 | 良好 — fadeInScale + articleReveal + inkFlow + 评论列表动画 |
| 🔥🔥 | **MySpacePage** | 17 | 良好 — cardReveal + shimmer + fadeInUp + tab 切换过渡 |
| 🔥 | **ProfilePage** | 12 | 尚可 — bgBreath + inkBloom + 多处 transition |
| 🔥 | **LoginPage** | 11 | 尚可 — bgBreath + fadeInUp + 按钮动效 |
| 🔥 | **CheckoutPage** | 6 | 偏弱 — 过渡存在但用 `ease` 非项目缓动 |
| 🔥 | **PhotoInspirationPage** | 4 | 偏弱 — spin + fadeInUp 仅此 |
| ❄️ | **UserProfilePage** | 2 | **接近死页** — 仅 2 个 fast transition |
| ❄️ | **MessagesPage** | 1 | **死页** — 仅 1 个 background transition |
| ❄️ | **MessageDetailPage** | 1 | **死页** — 仅 1 个 opacity transition |
| 🧊 | **App.tsx（页面切换）** | 0 | **零页面过渡** — 无 AnimatePresence/CSSTransition/framer-motion |

---

## 🔴 根因诊断：为什么感觉"动感不足"

### 根因 #1：页面切换无动画（致命）

用户从首页点进故事详情、从消息列表进入对话、从我的空间切换到他人主页——**每一次路由跳转都是生硬的瞬间切换**。在叙事型应用中，这尤其破坏沉浸感。

```
当前流程：
  首页 → [硬切] → 故事详情 → [硬切] → 用户主页 → [硬切] → 消息列表
  所有过渡时间：0ms

理想流程：
  首页 → [300ms 淡出+微上浮] → 故事详情入场 → [300ms 淡出] → 返回首页
  每次切换有 0.3-0.5s 的过渡，大脑感知到"页面变化"而非"闪烁"
```

**代码现状**: `App.tsx` 中没有任何动画库或过渡机制，`package.json` 也未安装 `framer-motion`、`react-transition-group` 等。

---

### 根因 #2：MessagesPage 和 MessageDetailPage 是死页

这两个页面的 CSS 各只有**一个** transition 声明。用户访问消息功能时——本应是"收到来信"的温馨时刻——看到的却是完全静态的页面。

| 缺失项 | MessagesPage | MessageDetailPage |
|:---|:---:|:---:|
| 对话列表项入场动画 | ❌ | — |
| 消息气泡入场（类似聊天） | — | ❌ |
| hover 时行背景过渡 | ❌ | — |
| 未读→已读状态过渡 | ❌ | ❌ |
| 发送按钮按压反馈 | — | ❌ |

---

### 根因 #3：UserProfilePage 静态

访问他人主页是社交产品的核心体验。当前页面仅 2 个过渡声明，用户头像、统计数据、故事列表全部在瞬间完成加载——缺少"探索和发现"的仪式感。

---

### 根因 #4：非首屏滚动渐显缺失

首屏卡片有 `cardReveal` + `animationDelay` stagger 是好的。但折叠线以下的内容在 mount 时动画已完成。用户滚动过去时，所有卡片已经静立不动——这是 `design-style.md` 中已记录的 P2 问题（#16），但它是"动感不足"感知的重要来源：

> 用户在滚动中期待持续看到"新内容正在出现"的信号，而非"内容早就存在，只是我一直没看到"。

---

### 根因 #5：微交互覆盖不全

| 交互 | HomePage | StoryDetail | Messages | Profile | MySpace |
|:---|:---:|:---:|:---:|:---:|:---:|
| 卡片 hover | ✅ inkBleed + 上浮 | ✅ | ❌ | ❌ | ✅ |
| 按钮 :active | ✅ scale(0.98) | 🟡 | ❌ | 🟡 | 🟡 |
| 标签/tab 切换 | ✅ 下划线滑动 | — | — | — | ✅ |
| 点赞反馈 | ✅ scale 动画 | ✅ | — | — | — |
| 关注反馈 | — | — | — | ❌ 无动画 | — |
| Toast 入场 | ✅ toastEnter | ✅ | ✅ | ✅ | ✅ |
| Modal 入场 | — | — | — | — | — |

---

## 🟠 动效优化方案（具体可执行代码）

> 以下代码均基于当前源码的实际类名和文件结构编写，修复者可直接参照应用。

---

### #23 🔴 页面切换过渡动画

**现状**: `Layout.tsx:103` 已有 `key={location.pathname}` 和 `className="page-transition-enter"`，但对应的 CSS 动画未定义。`index.css:158-180` 有闲置的 `.page-enter`/`.page-exit` 过渡类。

**只需改 1 个文件，7 行 CSS，零 TSX 改动。**

**文件**: `client/src/index.css`
**位置**: 第 180 行 `}`（`.page-exit-active` 块结束）之后追加

```css
/* Page mount transition — triggers on every route change via Layout's key={pathname} */
.page-transition-enter {
  animation: pageIn 0.4s var(--ease-out-expo);
}

@keyframes pageIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**原理**: `Layout.tsx:103` `<div className="app-content" key={location.pathname}>` — 每次路由切换，React 卸载旧 DOM、挂载新 DOM，`.page-transition-enter` 上的 `animation` 自动触发。无需任何 JS 改动。

**风险**: ⚪ 零风险 — 基础设施已就绪，仅补充 CSS。

---

### #24 🔴 MessagesPage 对话列表动效化

**现状**: 仅 1 个 `background` transition。当前使用类名 `.msg-item`（非 `messages-list-item`）。

**文件 1/2**: `client/src/pages/MessagesPage.css` — 替换 `.msg-item` 规则 + 追加

当前第 17-26 行 `.msg-item` 规则：
```css
.msg-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid rgba(28,28,28,0.06);
  transition: background var(--transition-fast);
}
```

改为：
```css
.msg-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid rgba(28,28,28,0.06);
  transition: background var(--transition-fast);

  /* Entrance stagger */
  opacity: 0;
  animation: msgItemIn 0.45s var(--ease-out-expo) forwards;
}
.msg-item:nth-child(1)  { animation-delay: 0.04s; }
.msg-item:nth-child(2)  { animation-delay: 0.08s; }
.msg-item:nth-child(3)  { animation-delay: 0.12s; }
.msg-item:nth-child(4)  { animation-delay: 0.16s; }
.msg-item:nth-child(5)  { animation-delay: 0.20s; }
.msg-item:nth-child(6)  { animation-delay: 0.24s; }
.msg-item:nth-child(7)  { animation-delay: 0.28s; }
.msg-item:nth-child(8)  { animation-delay: 0.32s; }
.msg-item:nth-child(9)  { animation-delay: 0.36s; }
.msg-item:nth-child(10) { animation-delay: 0.40s; }

@keyframes msgItemIn {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Enhanced hover — tea-stain warmth */
.msg-item:hover {
  background: var(--paper-aged);
  transition: background 0.35s var(--ease-out-expo);
}

/* Unread indicator reveal on hover */
.msg-item:has(.msg-badge) {
  border-left: 2px solid transparent;
  transition: border-color 0.4s var(--ease-out-expo);
}
.msg-item:has(.msg-badge):hover {
  border-left-color: var(--seal-red);
}
```

**文件 2/2**: `client/src/pages/MessagesPage.tsx` 第 58 行 — 如果对话超过 10 条，nth-child 不够。改为 JS 动态注入延迟：

```tsx
// 第 58 行，将：
{conversations.map(c => (

// 改为：
{conversations.map((c, i) => (
  <Link key={c.id} to={'/messages/' + c.id} className="msg-item"
    style={{ animationDelay: `${Math.min(i * 0.04, 0.6)}s` }}
  >
```

**风险**: ⚪ 低风险 — 纯 CSS animation，不涉及业务逻辑。

---

### #25 🔴 MessageDetailPage 消息气泡入场

**现状**: 仅 1 个 `opacity` transition。当前类名 `.chat-bubble-wrap`、`.chat-send-btn`。

**文件 1/2**: `client/src/pages/MessageDetailPage.css` — 在文件末尾追加

```css
/* ============================================
   Message bubble entrance animation
   ============================================ */
.chat-bubble-wrap {
  opacity: 0;
  animation: bubbleIn 0.4s var(--ease-out-expo) forwards;
}

.chat-bubble-wrap--mine {
  animation-name: bubbleInRight;
}

@keyframes bubbleIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes bubbleInRight {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Send button press feedback */
.chat-send-btn:not(:disabled):active {
  transform: scale(0.93);
  transition: transform 0.12s var(--ease-spring);
}

/* Input focus glow — reuse seal-red glow from design tokens */
.chat-input:focus {
  border-color: var(--ink-faint);
  box-shadow: 0 0 0 3px var(--seal-glow);
  transition: border-color 0.25s var(--ease-out-expo),
              box-shadow 0.25s var(--ease-out-expo);
}
```

**文件 2/2**: `client/src/pages/MessageDetailPage.tsx` 第 101-111 行 — 为气泡加递增延迟

```tsx
// 将：
{messages.map(m => {

// 改为：
{messages.map((m, i) => {
  const isMine = m.from_user_id === currentUser?.id;
  return (
    <div key={m.id}
      className={`chat-bubble-wrap${isMine ? ' chat-bubble-wrap--mine' : ''}`}
      style={{ animationDelay: `${Math.min(i * 0.03, 0.6)}s` }}
    >
      <div className={`chat-bubble${isMine ? ' chat-bubble--mine' : ''}`}>
        {m.content}
      </div>
    </div>
  );
})}
```

**风险**: ⚪ 低风险 — 纯 CSS animation。

---

### #26 🟡 UserProfilePage 入场动效

**现状**: 仅 2 个 transition。当前类名 `.user-profile-card`、`.user-stats`、`.user-story-card`。

**文件**: `client/src/pages/UserProfilePage.css` — 在文件末尾追加（复用 `theme.css` 已有的 `fadeInUp`/`fadeInScale`/`cardReveal` keyframes）

```css
/* ============================================
   Entrance animations
   ============================================ */

/* Profile card gentle reveal */
.user-profile-card {
  opacity: 0;
  animation: fadeInUp 0.6s var(--ease-out-expo) 0.1s forwards;
}

/* Stats fade in after card */
.user-stats {
  opacity: 0;
  animation: fadeInScale 0.4s var(--ease-spring) 0.35s forwards;
}

/* Story cards staggered reveal */
.user-story-card {
  opacity: 0;
  animation: cardReveal 0.5s var(--ease-out-expo) forwards;
}
.user-story-card:nth-child(1)  { animation-delay: 0.15s; }
.user-story-card:nth-child(2)  { animation-delay: 0.22s; }
.user-story-card:nth-child(3)  { animation-delay: 0.29s; }
.user-story-card:nth-child(4)  { animation-delay: 0.36s; }
.user-story-card:nth-child(5)  { animation-delay: 0.43s; }
.user-story-card:nth-child(6)  { animation-delay: 0.50s; }
.user-story-card:nth-child(7)  { animation-delay: 0.57s; }
.user-story-card:nth-child(8)  { animation-delay: 0.64s; }
.user-story-card:nth-child(9)  { animation-delay: 0.71s; }
.user-story-card:nth-child(10) { animation-delay: 0.78s; }

/* Follow button press + pop feedback */
.user-follow-btn:not(:disabled):active {
  transform: scale(0.92);
  transition: transform 0.12s var(--ease-spring);
}

/* Follow success pop (JS adds .just-followed class briefly) */
.user-follow-btn.just-followed {
  animation: followPopIn 0.4s var(--ease-spring);
}

@keyframes followPopIn {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.15); }
  70%  { transform: scale(0.95); }
  100% { transform: scale(1); }
}
```

**JS 配合**（可选）: 在 `UserProfilePage.tsx` 关注成功回调中触发弹簧动画：

```tsx
// 第 105 行关注成功后追加：
setFollowing(d.following ?? false);
const btn = document.activeElement as HTMLElement;
btn?.classList.add('just-followed');
setTimeout(() => btn?.classList.remove('just-followed'), 400);
```

**风险**: ⚪ 低风险 — 复用 `theme.css` 已有 keyframes，无重复定义。

---

### #27 🟡 滚动触发渐显（P2，延续 #16）

**现状**: `useScrollReveal` Hook 存在于 `client/src/hooks/useScrollReveal.ts` 但**未被任何页面调用**。需要接入 HomePage。

**文件 1/3**: `client/src/pages/HomePage.tsx`

1. 文件顶部（约第 8 行 import 区）追加：
```tsx
import { useScrollReveal } from '../hooks/useScrollReveal';
```

2. 组件函数体内（约第 47 行，`useEffect` 之后）追加：
```tsx
// 滚动渐显：折叠线以下卡片进入视口时触发入场
useScrollReveal('.story-card.reveal-on-scroll');
```

3. 卡片渲染处（约第 155 行），给每张卡片加 `reveal-on-scroll` 类，用 `--reveal-delay` 替代 `animationDelay`：
```tsx
// 原来：
<div className={`story-card${i === 0 ? ' story-card--hero' : ''}`}
  style={{ animationDelay: `${0.1 + i * 0.06}s` } as React.CSSProperties}>

// 改为：
<div className={`story-card reveal-on-scroll${i === 0 ? ' story-card--hero' : ''}`}
  style={{ '--reveal-delay': `${0.1 + i * 0.06}s` } as React.CSSProperties}>
```

**文件 2/3**: `client/src/pages/HomePage.css` — `.story-card` 动画改为 transition + Observer 方案

```css
/* .story-card — 移除原有 animation 声明，改为： */
.story-card {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.5s var(--ease-out-expo) var(--reveal-delay, 0s),
    transform 0.5s var(--ease-out-expo) var(--reveal-delay, 0s),
    box-shadow 0.35s var(--ease-out-expo);
}

/* IntersectionObserver 触发后 */
.story-card.is-visible {
  opacity: 1;
  transform: translateY(0);
  /* 重置 transition：去掉 reveal-delay，hover 即时响应 */
  transition:
    opacity 0.3s var(--ease-out-expo),
    transform 0.35s var(--ease-out-expo),
    box-shadow 0.35s var(--ease-out-expo);
}
```

**文件 3/3**: `client/src/hooks/useScrollReveal.ts` — 改为 `requestAnimationFrame` 确保 DOM 已渲染

```typescript
import { useEffect } from 'react';

/** Observe elements by CSS selector — triggers .is-visible on intersection */
export function useScrollReveal(selector: string, threshold = 0.1) {
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const els = document.querySelectorAll<HTMLElement>(selector);
      if (!els.length) return;

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        els.forEach(el => {
          el.style.opacity = '1';
          el.style.transform = 'none';
        });
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold, rootMargin: '0px 0px -40px 0px' },
      );

      els.forEach(el => observer.observe(el));
    });

    return () => cancelAnimationFrame(raf);
  }, [selector, threshold]);
}
```

**⚠️ 已知风险**: 首屏卡片 `opacity: 0` + Observer 异步触发可能导致首帧闪烁。如出现此问题，首屏卡片（`i < 4`）可保留原有 `animation: cardReveal` 方案，仅折叠线以下卡片使用 transition+Observer。确保 `prefers-reduced-motion` 用户直接看到全部内容。

**风险**: 🟡 中风险 — 改变了入场动画机制，需验证首屏无闪现。

---

### #28 🟡 关注按钮弹簧反馈

已在 #26 的 `UserProfilePage.css` 改动中一并包含（`.user-follow-btn.just-followed` + `@keyframes followPopIn`）。不再需要单独修改。

---

## 📋 动效优先修复路线图

### 第一轮（1-2 天，高收益低风险）

| # | 动作 | 改动范围 | 收益 |
|:---|:---|:---|:---|
| **#23** | 添加页面切换过渡动画 | `Layout.tsx` + `index.css` (~15 行) | 🔥🔥🔥 全站受益，零依赖 |
| **#24** | MessagesPage 列表项入场 + hover | `MessagesPage.css` (~25 行) | 🔥🔥 死页复活 |
| **#25** | MessageDetailPage 气泡入场 + 发送反馈 | `MessageDetailPage.css` (~30 行) | 🔥🔥 死页复活 |

### 第二轮（3-5 天）

| # | 动作 | 改动范围 |
|:---|:---|:---|
| **#26** | UserProfilePage 入场动效 | `UserProfilePage.css` (~20 行) |
| **#28** | 关注按钮反馈 + 点赞按钮复用 seal 动画 | `UserProfilePage.css` + `ProfilePage.css` |
| **#27** | 滚动触发渐显（P2 #16） | `useScrollReveal.ts` + `HomePage.tsx/css` |

### 第三轮（后续迭代）

| # | 动作 |
|:---|:---|
| **#17-19** | 横向滑动区、漂浮装饰、墨滴路由过渡（`design-style.md` P2 遗留） |

---

## 🔍 动效审核验证（commit 0a9c394 → 当前）

| # | 修复项 | 验证结果 |
|:---|:---|:---|
| #1 | VoiceInput.css 11 无效 token | ✅ 全部映射正确 (`--spacing-sm`→`--space-2` 等) |
| #3 | LikeButton.css 5 硬编码 | ✅ 全部改为 token (`#bbb`→`--ink-faint` 等) |
| #4 | LanguageSwitcher.css 5 硬编码 | ✅ 全部改为 token (`#444`→`--ink-dark` 等) |
| #15 | CommentSection 空评论提示 | ✅ 新增 `cmt-empty` + `comment.empty` i18n |
| #2 | Input.css | ⏭️ 跳过（组件未使用，开发者声明合理） |

### 审核意见

1. **Token 修复质量高** — VoiceInput/LikeButton/LanguageSwitcher 三处映射完全准确，token 语义正确，无副作用
2. **Input.css 跳过合理** — 该组件确实未被任何表单使用，修复后也会被 tree-shake；应先推广组件使用再修 token
3. **动效新增建议独立于 token 修复** — #23-#28 均为新增建议，不涉及之前文档的任何条目，全部是 P1/P2 增强

### 动效修复（commit 6308aaf）— AI 审核验证

| # | 修复项 | CSS | TSX | 问题 |
|:---|:---|:---:|:---:|:---|
| **#23** | 页面过渡 pageIn | ✅ `index.css:182-190` | ✅ 无需改（Layout 已有基础设施） | — |
| **#24** | MessagesPage 列表 stagger | ⚠️ `MessagesPage.css:26-43` | ❌ `.tsx:58` 仍为 `c =>` 无 `animationDelay` | **hover 规则冲突**: 第 47 行 `var(--paper-aged)` 被第 50 行 `rgba(28,28,28,0.03)` 覆盖；缺少 `:has(.msg-badge)` 未读指示器 |
| **#25** | MessageDetailPage 气泡入场 | ✅ `MessageDetailPage.css:105-126` | ❌ `.tsx:102` 仍为 `m =>` 无 `animationDelay` | 所有气泡无 stagger，同时入场 |
| **#26** | UserProfilePage 入场 | ⚠️ `UserProfilePage.css:220-242` | ✅ 无需改（纯 CSS） | 缺少 `.user-stats` fadeInScale + `.just-followed`/`followPopIn` |
| **#27** | 滚动渐显 | — | — | 🔜 合理跳过（首帧闪现风险） |

#### 逐项详情

**#23 ✅ 完美** — `page-transition-enter` + `@keyframes pageIn` 与建议完全一致。Layout.tsx 已有 `key={location.pathname}`，动画自动触发。

**#24 ⚠️ 需修 2 处**:

1. **hover 规则冲突**（`MessagesPage.css:45-51`）:
```css
/* 当前：两条 .msg-item:hover 互相覆盖 */
.msg-item:hover { background: var(--paper-aged); }        /* 第 47 行 — 被覆盖 */
.msg-item:hover { background: rgba(28,28,28,0.03); }       /* 第 50 行 — 生效 */
```
应删除第 49-51 行的旧 hover 规则。

2. **TSX 未注入 animationDelay**（`MessagesPage.tsx:58`）：如果对话超过 10 条，nth-child 不够用。将 `conversations.map(c =>` 改为 `conversations.map((c, i) =>` + `style={{ animationDelay: ... }}`。

**#25 ⚠️ 需修 1 处**: 气泡全部同时入场无 stagger。`MessageDetailPage.tsx:102` 将 `messages.map(m =>` 改为 `messages.map((m, i) =>` + `style={{ animationDelay: ... }}`。

**#26 ⚠️ 缺失 2 项**: `.user-stats` 的 `fadeInScale` 动画和 `.just-followed`/`followPopIn` 未实现。文档建议中已含完整代码。

#### 总体评价

| 维度 | 评分 |
|:---|:---|
| CSS 实现精度 | 🟡 80% — 4/4 页面 CSS 已加，但 #24 有冲突，#26 缺 2 项 |
| TSX 衔接 | 🟠 50% — 2/4 页面遗漏 JS 注入，导致 stagger 在长列表中失效 |
| #27 跳过理由 | ✅ 合理 — 首帧闪现是已知问题，需 useLayoutEffect 方案 |

### 动效遗漏修复（commit cd65ef2）— AI 审核验证

| # | 遗漏项 | 状态 | 证据 |
|:---|:---|:---:|:---|
| **#24** | hover 规则冲突 | ✅ | `MessagesPage.css:45-47` — 旧规则已删，仅保留 `var(--paper-aged)` |
| **#24** | TSX animationDelay | ✅ | `MessagesPage.tsx:58-60` — `(c, i)` + `Math.min(i*0.04, 0.6)s` |
| **#25** | TSX animationDelay | ✅ | `MessageDetailPage.tsx:102-107` — `(m, i)` + `Math.min(i*0.05, 0.8)s` |
| **#26** | user-stats fadeInScale | ✅ | `UserProfilePage.css:244-247` — `fadeInScale 0.4s var(--ease-spring) 0.4s` |
| **#26** | followPopIn | ⚠️ | `UserProfilePage.css:249-254` — keyframe 已定义，但 `.user-follow-btn.just-followed` 选择器缺失，动画无法触发 |

#### #26 followPopIn 说明

`@keyframes followPopIn` 已正确定义，但缺少触发它的 CSS 选择器。需追加一行：

```css
.user-follow-btn.just-followed {
  animation: followPopIn 0.4s var(--ease-spring);
}
```

这是纯 CSS 补漏，不涉及 JS。加上后修复者可在 `UserProfilePage.tsx` 关注成功回调中用 `classList.add('just-followed')` 按需触发。

#### 终态汇总

| # | CSS | TSX | 终态 |
|:---|:---:|:---:|:---|
| #23 | ✅ | ✅ | **完美** |
| #24 | ✅ | ✅ | **完美** |
| #25 | ✅ | ✅ | **完美** |
| #26 | ⚠️ | ✅ | **缺 1 行 CSS 选择器** |
| #27 | — | — | 🔜 合理跳过 |

**前 3 项全部闭环，仅 #26 缺一行 `.just-followed` 选择器即可全绿。**
### #26 最终修复（commit 61cc790）：补充 .just-followed 选择器
