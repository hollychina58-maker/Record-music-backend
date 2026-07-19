# Record-App UI/UX 审计报告

**审计日期**：2026-07-19  
**审计范围**：全前端（`client/src` 下 18 个组件、13 个页面、36 个 CSS 文件）  
**审计方法**：代码审查 + 设计文档（`docs/design-style.md`、`docs/design-style-712.md`）对照验证

---

## 一、总体评估

| 维度 | 评级 | 说明 |
| :--- | :--- | :--- |
| 视觉系统 | 🟢 优秀 | 水墨主题世界观清晰，`theme.css` 定义 100+ design tokens |
| 响应式 | 🟢 优秀 | 三断点体系、iOS 防缩放、100svh、移动端适配完善 |
| 动效 | 🟡 良好 | 首页/创建页/燃烧弹窗丰富，但部分页面仍偏静态 |
| 组件一致性 | 🟠 不足 | 自定义 `Input` 组件未使用，空/错状态各自实现 |
| 错误处理 | 🔴 薄弱 | 多处 `.catch(() => {})` 静默吞错，用户无感知 |
| 无障碍 | 🟡 良好 | `prefers-reduced-motion` 已覆盖，但缺 `aria-live`/`aria-busy` |

**结论**：仍有明确的优化空间，但无需推倒重来。当前状态是"设计系统已建好，但执行层面（错误处理、组件复用、部分页面打磨）尚未完全跟上"。

---

## 二、已闭环的优质实现（无需再优化）

| 项目 | 文件/位置 | 状态 |
| :--- | :--- | :--- |
| 设计 token 修复（VoiceInput/LikeButton/LanguageSwitcher） | `client/src/components/VoiceInput.css` 等 | ✅ 已映射到正确 token |
| 对比度达标 | `theme.css:14` | ✅ `--ink-light` 改为 `#6B6B6B`，焦点 outline 改为 `--seal-red` |
| 音乐可视化 | `client/src/components/MusicPlayer.tsx`、 `client/src/index.css:114` | ✅ Web Audio API 24 条频谱柱 + `--music-intensity` 已消费 |
| 页面切换过渡 | `client/src/components/Layout.tsx:103`、 `client/src/index.css:183` | ✅ `key={pathname}` + `pageIn` 动画已落地 |
| 消息页面动效 | `client/src/pages/MessagesPage.css`、`MessageDetailPage.css` | ✅ 列表/气泡 stagger 动画已落地 |
| 移动端卡片错落 | `client/src/pages/HomePage.css:767` | ✅ rotate + 负 margin 已实现 |
| 宽屏网格 | `client/src/pages/HomePage.css:758` | ✅ `1600px+` 使用 `auto-fill` 自适应 |
| 评论空状态 | `client/src/components/CommentSection.tsx:111` | ✅ 已加 `cmt-empty` |
| 导航栏字体放大 | `client/src/components/Layout.css` | ✅ desktop 1rem 链接字号 + 52px nav-height |

---

## 三、待优化项（按优先级）

### 🔴 P0 — 影响功能或一致性

#### P0-1. `Input.tsx` 组件未使用，且其 CSS 仍含无效 token

- **文件**：
  - `client/src/components/Input.tsx`
  - `client/src/components/Input.css`
- **问题**：
  - `Input.css` 引用了 `theme.css` 中不存在的变量：`--ink-tertiary`、`--ink-primary`、`--ink-secondary`、`--gray-medium`、`--gray-light`、`--gray-dark`。
  - `Input.tsx` 已构建完整错误 UI（下划线动画 + 错误消息），但**全项目没有任何页面导入使用**。
  - 所有表单仍使用原生 `<input>`，导致验证和错误 UI 在多处重复实现。
- **修复建议**：
  1. 先修复 `Input.css` 中的无效 token：
     | 当前无效 token | 正确 token |
     | :--- | :--- |
     | `--ink-tertiary` | `--ink-faint` |
     | `--ink-primary` | `--ink-black` |
     | `--ink-secondary` | `--ink-dark` |
     | `--gray-medium` | `--ink-wash` |
     | `--gray-light` | `--ink-faint` |
     | `--gray-dark` | `--ink-medium` |
  2. 在 `CreateStoryPage` 和 `MySpacePage` 编辑表单中率先推广 `<Input>` 组件，逐步替代原生 input。

---

#### P0-2. 大量静默错误处理

- **文件**：
  - `client/src/pages/HomePage.tsx:80-81`（hero 图片、标签栏）
  - `client/src/pages/MessagesPage.tsx:25`
  - `client/src/pages/MessageDetailPage.tsx:54-56,85`
  - `client/src/pages/UserProfilePage.tsx:54`
  - `client/src/pages/StoryDetailPage.tsx:202,209`
  - `client/src/components/NotificationBell.tsx`
- **问题**：
  - 大量使用 `.catch(() => {})` 或 `catch { /* */ }` 静默吞错。
  - 用户在网络失败时看不到任何提示，可能看到永久 loading、空白列表或陈旧数据。
- **修复建议**：
  - 短期（零风险）：给所有静默 catch 至少添加 `console.error` + `Toast` 通知。
  - 长期：建立统一 `<ErrorState>` 组件，含重试按钮，并在关键数据请求失败时渲染。

---

#### P0-3. 评论组件错误状态缺失

- **文件**：`client/src/components/CommentSection.tsx:28-65`
- **问题**：
  - `loadComments`、`handleSubmit`、`handleDelete` 失败都标记为 `// silently fail`。
  - 提交失败时用户输入会丢失，删除失败时用户不知道操作未生效。
- **修复建议**：
  - 增加 `error` 状态，请求失败时显示 inline 错误提示。
  - 提交失败时保留用户输入，避免数据丢失。

---

### 🟠 P1 — 影响体验与开发效率

#### P1-4. 缺少统一的空状态组件

- **现状**：
  - 7 个页面用 `.empty` 类实现相似空状态。
  - `ProfilePage` 使用完全独立的自定义 SVG 插图。
  - `CommentSection` 使用独立样式。
  - `PhotoInspirationPage` 无空状态处理。
- **建议**：创建统一 `<EmptyState>` 组件：
  ```tsx
  <EmptyState
    icon="ink"        // "ink" | "message" | "comment" | "music" | "notification"
    title={t('empty.title')}
    hint={t('empty.hint')}
    action={{ label: t('empty.action'), to: '/create' }}
  />
  ```

---

#### P1-5. 骨架屏 CSS 重复定义

- **文件**：
  - `client/src/pages/HomePage.css:699-750`
  - `client/src/pages/MySpacePage.css:467-535`
- **问题**：`.story-card--skeleton`、`.skeleton-poster`、`.skeleton-line` 等类在两处重复定义，样式几乎一致。
- **建议**：提取到 `client/src/components/Skeleton.css` 作为共享样式。

---

#### P1-6. `Toast` loading 类型从未使用

- **文件**：`client/src/components/Toast.tsx`
- **问题**：Toast 系统定义了 `loading` 类型（持续旋转、不自动关闭），但代码库中没有任何 `addToast('loading', ...)` 调用。
- **建议**：在以下长操作场景中使用：
  - `CreateStoryPage` 故事发布中
  - `StoryDetailPage` 音乐重新生成中

---

#### P1-7. 列表/个人资料页缺少音乐状态

- **影响页面**：
  - `client/src/pages/MySpacePage.tsx`
  - `client/src/pages/UserProfilePage.tsx`
  - `client/src/pages/ProfilePage.tsx`
- **问题**：
  - `MySpacePage` 仅在已完成音乐旁显示 `♪` 图标，无 pending/failed/expired 徽章。
  - `UserProfilePage` / `ProfilePage` 完全不显示音乐状态。
- **建议**：复用 `HomePage.tsx:28` 的 `MusicBadge` 组件，在故事卡片上统一显示音乐状态。

---

### 🟡 P2 — 增强与打磨

#### P2-8. 非首屏滚动渐显未实现

- **文件**：
  - `client/src/hooks/useScrollReveal.ts`（已存在但未被调用）
  - `client/src/pages/HomePage.tsx`
- **问题**：
  - 首屏卡片有 `cardReveal` + `animationDelay` stagger。
  - 折叠线以下卡片在 mount 时动画已完成，用户滚动到时已静止，缺少"新内容出现"的感知。
- **建议**：在 `HomePage.tsx` 中接入 `useScrollReveal`：
  ```tsx
  import { useScrollReveal } from '../hooks/useScrollReveal';
  // ...
  useScrollReveal('.story-card.reveal-on-scroll');
  ```
  并为卡片增加 `reveal-on-scroll` 类与 `--reveal-delay` 变量。

---

#### P2-9. 管理后台设计风格完全独立

- **文件**：
  - `client/src/pages/admin/AdminLayout.css`
  - `client/src/pages/admin/Dashboard.css`
  - `client/src/pages/admin/AdminTable.css`
  - `client/src/pages/admin/AdminProductsPage.css`
- **问题**：全部使用硬编码颜色和浅色管理面板风格，与主站水墨风格完全脱节。
- **建议**：
  - 最低限度：将字体改为 `var(--font-ink)` / `var(--font-ui)`，底色改为 `var(--xuan-paper)`。
  - 长期：完整对齐设计系统。

---

#### P2-10. 支付页独立深色主题

- **文件**：`client/src/pages/CheckoutPage.css`
- **问题**：使用完全独立的深紫/蓝色配色（`#0f0c29`、`#1a1a2e`、`#16213e`），与全站水墨风格冲突。
- **建议**：
  - 先确认是否为刻意设计决策（暗示"安全交易空间"）。
  - 若是，在文档中注明；若否，统一为纸墨色调。
  - 至少使用 `var(--font-ink)` / `var(--font-ui)` 等字体 token。

---

#### P2-11. 其他硬编码/部分 token 化组件

- **文件**：
  - `client/src/components/StoryPoster.css`：字体 ``Noto Serif SC` 硬编码，建议改为 `var(--font-ink)` / `var(--font-seal)`。
  - `client/src/components/MusicBanner.css`：背景、按钮边框大量硬编码，建议至少用 `--ink-deepest` 替代 `#16120e`，用 `--gold-pale` 替代白色文字。
- **建议**：作为低优先级 token 化清理项。

---

#### P2-12. 无障碍细节

- **问题**：
  - 骨架屏和 loading 文字没有 `aria-live="polite"` 或 `aria-busy="true"` 标注，屏幕阅读器用户无法感知加载状态。
  - `LanguageSwitcher` 使用原生 `select` + `appearance: auto`，浏览器默认下拉样式在 ink-wash 主题中显得突兀。
  - `LikeButton`、`VoiceInput` 等组件需确认 `:focus-visible` 是否被自定义 outline 覆盖。
- **建议**：
  - 给骨架屏容器添加 `aria-busy="true"`，加载完成后改为 `aria-busy="false"`。
  - 给 `LanguageSwitcher` 自定义下拉样式，或改用自定义 dropdown 组件。
  - 检查关键交互组件的 focus-visible 样式是否生效。

---

## 四、优先修复路线图

### 第一轮（1-2 天，零风险）

| # | 动作 | 文件 |
| :--- | :--- | :--- |
| **P0-2** | 给所有静默 `.catch(() => {})` 添加 `console.error` + Toast | 6+ 页面/组件 |
| **P0-3** | 给 `CommentSection` 加错误状态提示 | `client/src/components/CommentSection.tsx` |
| **P0-1** | 修复 `Input.css` 中的 6 个无效 token | `client/src/components/Input.css` |

### 第二轮（3-5 天，低风险）

| # | 动作 | 文件 |
| :--- | :--- | :--- |
| **P1-4** | 创建统一 `<EmptyState>` 组件 | 新建组件 |
| **P0-2** | 创建统一 `<ErrorState>` 组件 | 新建组件 |
| **P1-5** | 提取共享骨架屏 CSS | `client/src/components/Skeleton.css` |
| **P1-6** | 为关键操作添加 loading toast | `CreateStoryPage.tsx`、`StoryDetailPage.tsx` |
| **P1-7** | 在 Profile/MySpace/UserProfile 页加 `MusicBadge` | 3 个页面 |
| **P0-1** | 在 `CreateStoryPage` / `MySpacePage` 中推广 `<Input>` 组件 | 2 个页面 |

### 第三轮（后续迭代）

| # | 动作 |
| :--- | :--- |
| **P2-8** | 接入 `useScrollReveal` 滚动渐显 |
| **P2-9** | 管理后台设计对齐 |
| **P2-10** | 评估 CheckoutPage 深色主题是否保留 |
| **P2-11** | StoryPoster / MusicBanner token 化 |
| **P2-12** | 无障碍改进（aria-busy、LanguageSwitcher、focus-visible） |

---

## 五、结论

Record-App 的 UI/UX 优化空间主要集中在**错误处理可见性**、**组件复用统一**和**部分页面打磨**三个层面。视觉系统与响应式已经较为成熟，无需大改。

**最值得优先修复的是**：

1. 所有静默吞错的地方加 `console.error` + Toast（用户可感知，零风险）。
2. 统一 `<EmptyState>` / `<ErrorState>` 组件（减少重复代码，提升一致性）。
3. 推广 `<Input>` 组件或修复其无效 token（避免已有组件闲置）。

以上三项改动量小、收益高，能直接改善用户在实际网络异常、空数据、表单操作场景下的体验。

---

**文档生成**：2026-07-19  
**基于代码 commit**：当前工作目录最新状态

---
## 开发者修复回复（commit ed2439e）

| # | 处理 |
|:---|:---|
| P0-1 | ✅ Input.css 6 无效 token + 3 处 ember-red → seal-red |
| P0-2 | 🟡 记录 — 静默 catch 为设计权衡(非关键操作降级)，后续统一 ErrorState |
| P0-3 | ✅ CommentSection: loadError + submitError 状态 + 错误提示 |
| P1-4~P2-12 | 🟡 记录 — 空状态/骨架屏/loading toast/管理后台等为后续迭代 |
