# CLAUDE.md — Record-App

## 项目概要

AI 赋能的叙事平台：用户记录故事，MiniMax 自动生成配乐。React 18 + Express + Turso，水墨风格 UI。

## 开发命令

```bash
# 前端开发
cd client && npm run dev        # Vite 开发服务器 (端口由 Vite 自动分配)

# 后端开发
cd server && npm run dev        # tsx watch 热重载 (需 PORT=4000)

# 构建
cd client && npm run build      # tsc && vite build → client/dist/
cd server && npm run build      # tsc → server/dist/

# E2E 测试 (需同时启动前后端)
npx playwright test             # 运行全部 42 个测试
npx playwright test --headed    # 有头模式调试
```

## 完整构建 (Render 部署)

```bash
npm run build   # 安装 server 依赖 → 编译 → 复制 dist + node_modules 到根
npm start       # node dist/index.js
```

## 架构概览

```
client/   React 18 + Vite 5 + TypeScript (路由 / 组件 / hooks / stores / i18n)
server/   Express 4 + TypeScript + Turso (libsql) 数据库
e2e/      Playwright 42 个测试用例
```

## 关键路径

- **路由**: `client/src/App.tsx` — 所有页面路由 + 管理后台懒加载
- **状态**: `client/src/stores/authStore.ts` — Zustand 认证状态（JWT 存 httpOnly Cookie，不再持久化 localStorage）
- **API**: `client/src/services/api.ts` — Axios 单例 + 拦截器
- **国际化**: `client/src/i18n/LanguageContext.tsx` — 8 语言 Context
- **数据库**: `server/src/models/database.ts` — 10 张表 schema + 迁移
- **音乐生成**: `server/src/services/minimax.ts` — MiniMax API + 情绪分析
- **支付**: `server/src/services/payment/alipay.ts` — 支付宝 SDK v4
- **认证**: `server/src/middleware/auth.ts` — JWT + bcrypt

## 编码约定

- **SQL**: 原始参数化查询 `dbAll/dbGet/dbRun/dbBatch`，无 ORM
- **CSS**: 纯 CSS + 自定义属性（40+ 设计 tokens），无 Tailwind/CSS-in-JS
- **i18n**: 自定义 Context，JSON 翻译文件 8 语言，无第三方库
- **样式风格**: 水墨画（ink-wash），色调 `theme.css` 中定义
- **注释**: 中文注释为主，API 端点使用 JSDoc 风格

## 环境变量 (server/.env)

```
JWT_SECRET=         # 必需
MINIMAX_API_KEY=    # MiniMax 音乐生成
ALIPAY_APP_ID=      # 支付宝
ALIPAY_PRIVATE_KEY= # PKCS8 格式
ALIPAY_PUBLIC_KEY=  # 支付宝公钥
TURSO_DATABASE_URL= # 生产环境 Turso
TURSO_AUTH_TOKEN=   # Turso 认证
```

## 当前状态

- 支付宝沙箱已上线，微信支付/PayPal 待激活
- 42 个 E2E 测试全通过
- 所有会话记录同步至 Obsidian: `d:/dragon-Knowlege/MyClaudeMemo/raw/Record-App/`（sessions/ 子目录）

## ⚠️ 已知陷阱

修改以下模块时，先读本节避免引入回归 bug：

- **`music.ts` `/generate` 端点**：dedup 必须在扣积分**之前**（第 64 行），扣费在 `!existing` 分支内（第 101 行）。修改此端点必须先理解完整三步流程（dedup → 扣费 → INSERT），否则极易引入双重扣费。
- **`music.ts` `processMusicAsync` 退款**：年度会员 `music_remaining = NULL` 表示无限配额。退款 UPDATE 必须加 `AND music_remaining IS NOT NULL`，否则 `NULL+1=1` 导致无限配额变为 1 次。
- **`music.ts` dedup SQL**：条件 `AND (file_path IS NOT NULL OR status = 'pending')` 有三态语义——completed 需要有效 URL 才去重；pending 无论有无 file_path 都去重（防止快速双击）；completed+NULL 不匹配（允许重新生成）。
- **`burn.ts` 焚烧级联（2026-07 已重构为事务）**：整个级联（notifications → comment likes → comments → story likes → music_usage → music → UPDATE story → INSERT burned → 纪念评论）现在在**单个 dbBatch 事务**内执行（libsql batch = BEGIN/COMMIT/ROLLBACK 真事务）。R2 文件删除仍是 fire-and-forget。新增级联语句务必放进同一个 batch。
- **`story.ts` DELETE**：同样遵循上述级联顺序（含 notifications 清理），且需在 DB 删除前先清理 R2 文件（查 `music.file_path` + `stories.cover_image`）。
- **SQLite `foreign_keys`**：默认 OFF，`initDatabase()` 末尾已通过 `PRAGMA foreign_keys = ON` 启用。新增迁移时勿忘此前提。
- **`Audio` 元素**：`Audio()` 构造函数不支持自定义 headers。如需认证，用 `fetch()` + `blob()` + `URL.createObjectURL()`，cleanup 中务必调用 `URL.revokeObjectURL()`。
- **JWT 会话（2026-07 起）**：登录/注册在服务端设置 httpOnly Cookie（SameSite=Lax），前端 fetch/axios 必须带 credentials: 'include' / withCredentials: true。**禁止把 token 拼进 URL query**（会进日志/Referer）——下载/音频流一律 fetch + Authorization header + blob。后端 authMiddleware 只接受 Authorization header 或 httpOnly Cookie。
- **music.ts /generate 所有权**：必须校验 story.user_id === req.userId，否则任意用户可在他人故事上消耗积分生成音乐（IDOR）。
- **`stream: true` 破坏 MiniMax 响应**：在 music-2.6 模型中设置 `stream: true` 后，MiniMax 返回的响应格式变化，`audio` 字段不再是直接的 URL。**不要使用此参数**。
- **prompt 长度限制**：MiniMax prompt 上限 2000 字符。保持 prompt 简洁（BPM/Key/风格/情绪/乐器/时长），不要加冗长的制作细节。超长 prompt 可能导致 API 返回空 audio URL。
- **重试策略**：仅在 ECONNRESET / 5xx / 429 时重试（最多 2 次）。超时（ETIMEDOUT）不重试——MiniMax 处理 60s+ 曲目本身就慢，重复等待毫无意义。

## 📝 技术债务

| 触发条件 | 债务项 | 文件 |
|:---|:---|:---|
| 用户量 > 1000 | `setImmediate` 通知创建改为持久化消息队列 | `story.ts:103-123` |
| 故事总量 > 10000 | 以下列表端点加分页（默认 `LIMIT 20`，最大 50） | |
| | `GET /users/me/stories` | `user.ts:167` |
| | `GET /users/me/liked-stories` | `user.ts:178` |
| | `GET /users/me/usage` | `user.ts:95` |
| | `GET /users/:id/following` | `follow.ts:42` |
| 评论 > 500/篇 | `GET /api/likes/story/:id` 加分页 | `like.ts:40` |
| 上线前 | 添加 `helmet` 安全头中间件 | `index.ts` |
| 上线前 | 支付 verify 限流（10/min）已加；其余支付端点仍走通用 100/min | `payment.ts` |
| 用户量 > 5000 | 消息列表查询改用窗口函数替代 6 个子查询 | `message.ts:42-59` |
| 随迭代 | 统一 API 响应格式为 `{ success, data, meta? }`（已为多数端点补 success 字段，like/follow/block 保留原结构以兼容前端） | 多处 |
| 🔴 未修 | Express 4 async handler 未捕获 rejection → DB 异常可致进程崩溃（约 60 个端点，需 asyncHandler 包装器或升级 Express 5） | `routes/*.ts` |
| 🔴 未修 | `/music/generate` 扣费+INSERT 非事务 + dedup 竞态（快速双击可双扣费） | `music.ts` |
| 🔴 未修 | PayPal APPROVED 即视为已支付且从未 capture（启用前必须修） | `services/payment/paypal.ts` |
| 🔴 未修 | 支付宝重复发起支付覆盖 payment_id，先付款订单可能无法激活（应稳定 out_trade_no） | `services/payment/alipay.ts` |
| 随迭代 | admin 删用户已清理 notifications/messages/follows/blocks（✅ 2026-07）；仍缺 R2 文件清理 + burned_stories（删 stories 前必须先删 burned_stories，否则 FK 冲突） | `admin/users.ts` |
