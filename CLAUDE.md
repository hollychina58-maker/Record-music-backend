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
- **状态**: `client/src/stores/authStore.ts` — Zustand JWT 认证持久化
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

- 33 个提交，工作区干净
- 支付宝沙箱已上线，微信支付/PayPal 待激活
- 42 个 E2E 测试全通过
- 所有会话记录同步至 Obsidian: `d:/dragon-Knowlege/MyClaudeMemo/Record-App/`

## 语言规则

**所有会话中文优先。** 解释、讨论、注释、提交信息均使用中文。代码标识符与日志消息保持英文。

---

# AI 编码行为准则

*来源: Andrej Karpathy 对 LLM 编码陷阱的观察 — github.com/multica-ai/andrej-karpathy-skills*

## 1. 先思考，再编码

**不要假设。不要隐藏困惑。展示权衡。**

实现之前：
- 明确陈述你的假设。如果不确定，先问。
- 如果存在多种理解方式，展示它们——不要默默选择一种。
- 如果存在更简单的方法，指出来。该反驳时反驳。
- 如果有什么不清晰，停下来。指明困惑之处。提问。

## 2. 简洁优先

**用最少代码解决问题。不写推测性代码。**

- 不写超出需求的功能。
- 不为一次性代码建抽象层。
- 不添加未被要求的"灵活性"或"可配置性"。
- 不为不可能的场景写错误处理。
- 如果写了 200 行而 50 行就够，重写它。

自问："一个资深工程师会说这过度复杂吗？"如果是，简化它。

## 3. 手术式修改

**只碰必须改的。只清理你自己造成的遗留。**

编辑已有代码时：
- 不要"改进"相邻代码、注释、格式。
- 不要重构没有坏的东西。
- 匹配已有风格，即使你会用不同的方式写。
- 如果你注意到了无关的死代码，提出来——不要直接删除。

当你的修改造成孤儿代码时：
- 移除**你的修改**导致不再使用的 import/变量/函数。
- 除非被要求，不要删除之前就存在的死代码。

测试：每个被修改的行都应该能追溯到用户的需求。

## 4. 目标驱动执行

**定义成功标准。循环直到验证通过。**

将任务转化为可验证的目标：
- "加验证" → "为无效输入写测试，让它通过"
- "修 bug" → "写一个能复现它的测试，让它通过"
- "重构 X" → "确保前后测试都通过"

对多步骤任务，陈述简要计划：
```
1. [步骤] → 验证: [检查项]
2. [步骤] → 验证: [检查项]
3. [步骤] → 验证: [检查项]
```

强成功标准让你能独立循环。弱标准（"让它能用"）需要不断澄清。

---

**这些准则在生效的标志：** diff 中不必要的改动减少、因过度复杂而重写的次数减少、澄清性问题在实现之前提出而非错误之后。
