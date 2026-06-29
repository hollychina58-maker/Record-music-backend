# 🔍 Record-App 全面代码审核报告

**审核日期**: 2026-06-29  
**审核范围**: server/ (32 文件) + client/ (40 文件) + e2e/ (1 文件)  
**审核维度**: 安全性 · 代码效率 · 代码质量 · 功能逻辑（尤其音乐生成）

---

## 📊 问题总览

| 严重等级 | 数量 | 主要领域 |
|:---|:---:|:---|
| 🔴 **严重** | 7 | 并发竞争、外键约束、API超时、双重扣费 |
| 🟠 **高** | 10 | 错误泄露、无XSS防护、分页缺失、安全头 |
| 🟡 **中** | 12 | 孤儿数据、响应格式不一致、性能 |
| 🔵 **低/建议** | 9 | SELECT *、索引缺失、硬编码 |

---

## 🔴 严重问题 (Critical)

### C1. 音乐生成双重扣费 —— 并发竞争条件
**文件**: [server/src/routes/music.ts:64-172](../server/src/routes/music.ts#L64-L172)  
**严重程度**: 🔴 严重  
**类别**: 功能逻辑 · 并发安全

**问题描述**:
扣费逻辑存在严重设计缺陷。第 68-85 行执行**第一次**扣费，第 122-144 行执行**第二次**扣费。当两个并发请求同时到达：
1. 都通过 `existing` 检查（互不可见对方记录）
2. 各扣 2 次费（共 4 次扣费）
3. 仅创建 1 个音乐记录
4. 用户损失双倍配额

**当前代码逻辑**:
```
请求进入 → 第一次扣费(第68行) → 检查existing(第112行)
  ├─ existing存在 → 退款(第153行) → 返回已有记录
  └─ existing不存在 → 第二次扣费(第122行) → 重新检查(第147行)
       ├─ 又发现了 → 退款 → 返回
       └─ 没发现 → INSERT → 异步生成
```

**修复建议**:
将所有扣费合并为一个原子操作，使用 `INSERT ... WHERE NOT EXISTS` 模式：

```typescript
// 1. 先尝试原子插入（带状态检查）
const result = await dbRun(
  `INSERT INTO music (story_id, user_id, style, status, lyrics_mode)
   SELECT ?, ?, ?, 'pending', ?
   WHERE NOT EXISTS (
     SELECT 1 FROM music
     WHERE story_id = ? AND status IN ('pending', 'completed')
     AND file_path IS NOT NULL
   )`,
  [storyId, userId, styleLabel, lyricsMode, storyId]
);

// 2. 仅当确实创建了新记录时才扣费
if (result.changes > 0) {
  // 原子扣费
  await dbRun(`UPDATE users SET free_music_count = free_music_count - 1 WHERE id = ? AND free_music_count > 0`, [userId]);
  // 或订阅扣费
}
```

---

### C2. 音乐状态 `expired` 未在 schema 中正式定义
**文件**: [server/src/routes/music.ts:290](../server/src/routes/music.ts#L290) · [server/src/models/database.ts:80-89](../server/src/models/database.ts#L80-L89)  
**严重程度**: 🔴 严重  
**类别**: 代码质量 · 数据一致性

**问题描述**:
流播放端点超时时将 `status` 直接写为 `'expired'`：
```typescript
await dbRun('UPDATE music SET file_path = NULL, status = ? WHERE id = ?', ['expired', music.id]);
```

但 music 表 schema 定义为 `status TEXT DEFAULT 'pending'`，无 CHECK 约束。任何人都能写入任意字符串。同时 `GET /music/by-story/` 查询用 `status != 'failed'` 过滤，导致 `expired` 记录穿透，前后端状态映射脆弱。`GET /music/by-story/` 在响应中又将 `completed + null file_path` 映射为 `expired`，存在两套不一致的过期逻辑。

**修复建议**:
1. 添加 CHECK 约束：
```sql
ALTER TABLE music ADD CHECK (status IN ('pending', 'completed', 'failed', 'expired'));
```
2. 创建共享状态常量文件 `shared/musicStatus.ts`，前后端共用
3. 查询改为 `WHERE status NOT IN ('failed', 'expired')`

---

### C3. MiniMax 音乐生成 API 调用无超时
**文件**: [server/src/services/minimax.ts:281-290](../server/src/services/minimax.ts#L281-L290)  
**严重程度**: 🔴 严重  
**类别**: 代码效率 · 资源管理

**问题描述**:
```typescript
const response = await axios.post<MiniMaxMusicResponse>(
    `${process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1'}/music_generation`,
    payload,
    { headers: { ... } }  // ← 没有 timeout!
);
```

对比同文件 `generateCoverImage`（line 369）设置了 `timeout: 60000`，音乐生成调用却没有超时控制。如果 MiniMax API 挂起，连接永不释放，逐步耗尽 Node.js 连接池。

**修复建议**:
```typescript
{ headers: { ... }, timeout: 120000 }  // 2 分钟足够音乐生成
```

---

### C4. SQLite 外键约束未启用
**文件**: [server/src/models/database.ts](../server/src/models/database.ts)  
**严重程度**: 🔴 严重  
**类别**: 安全性 · 数据完整性

**问题描述**:
SQLite 默认 `PRAGMA foreign_keys = OFF`。虽然 schema 中声明了 `FOREIGN KEY(...)` 约束，但**运行时完全不执行引用完整性检查**。直接后果：
- 删除用户后 → 订单、订阅、评论、通知、关注全部变成孤儿行
- 删除故事后 → 音乐、点赞、评论全部残留
- 数据腐化随时间累积，无法恢复

**修复建议**:
在 `initDatabase()` 末尾添加：
```typescript
await client.execute('PRAGMA foreign_keys = ON;');
```

---

### C5. 故事删除无级联清理
**文件**: [server/src/routes/story.ts:148](../server/src/routes/story.ts#L148) · [server/src/routes/burn.ts:23-26](../server/src/routes/burn.ts#L23-L26)  
**严重程度**: 🔴 严重  
**类别**: 功能逻辑 · 数据完整性

**问题描述**:
`DELETE FROM stories WHERE id = ?` 仅删一条记录，不清理任何子表。即便启用外键约束，也需显式处理（SQLite 的 `ON DELETE CASCADE` 依赖 `PRAGMA foreign_keys = ON`）。

对比：管理员删除故事（[admin/stories.ts:48-53](../server/src/routes/admin/stories.ts#L48-L53)）**正确做了**：
```
DELETE comments → DELETE burned_stories → DELETE music_usage → DELETE music → DELETE likes → DELETE story
```

但普通用户的删除和燃烧（burn）路由缺少这些清理。燃烧路由仅删除评论，遗漏了被删评论对应的 `likes` 行。

**修复建议**:
参考 admin 路由做法，在 `story.ts` 和 `burn.ts` 中补齐完整的级联 DELETE 序列。

---

### C6. `setImmediate` 通知创建 —— 进程退出时丢失
**文件**: [server/src/routes/story.ts:103-123](../server/src/routes/story.ts#L103-L123)  
**严重程度**: 🔴 严重  
**类别**: 功能逻辑 · 可靠性

**问题描述**:
故事创建后，用 `setImmediate(async () => {...})` 向所有关注者发通知。执行顺序：
1. 故事写入数据库 ✅
2. HTTP 200 响应已发送 ✅
3. `setImmediate` 回调异步执行通知创建 ⚠️

如果服务器在第 2 步和第 3 步之间崩溃/重启，通知**永久丢失**。`setImmediate` 是进程内存中的微任务，无持久化，无重试。

**修复建议**:
1. 短期：将通知任务写入 `pending_notifications` 表（与故事创建在同一个事务中），由后台轮询处理
2. 长期：使用 BullMQ / Redis 等持久化消息队列

---

### C7. 动态表名拼接 —— SQL 注入隐患
**文件**: [server/src/routes/like.ts:29-34](../server/src/routes/like.ts#L29-L34)  
**严重程度**: 🔴 严重  
**类别**: 安全性

**问题描述**:
```typescript
await dbRun(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`, [targetId]);
await dbRun(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`, [targetId]);
```

`table` 来自 `targetType`，虽有 `['story', 'comment']` 白名单验证，但模板字符串拼接的模式本身脆弱。一旦未来代码变更绕过验证，直接构成 SQL 注入。

**修复建议**:
```typescript
const TABLE_MAP: Record<string, string> = {
  story: 'stories',
  comment: 'comments',
};
const table = TABLE_MAP[targetType];
if (!table) throw new Error(`Invalid targetType: ${targetType}`);
await dbRun(`UPDATE ${table} SET like_count = ...`, [targetId]);
```

---

## 🟠 高优先级 (High)

### H1. 错误消息泄露给客户端（5 处）
**文件**: 
- [server/src/index.ts:95](../server/src/index.ts#L95) — PhotoInspiration
- [server/src/routes/music.ts:204](../server/src/routes/music.ts#L204) — 音乐生成
- [server/src/routes/music.ts:323](../server/src/routes/music.ts#L323) — 流播放

**问题**: 将 `err.message` 直接返回客户端，可能泄露 MiniMax API 内部细节、文件系统路径等敏感信息。

**修复**: 统一返回 `{ error: '服务暂时不可用，请稍后重试' }`，真实错误仅记录到服务器日志 `console.error`。

---

### H2. 无输入净化 —— 存储型 XSS 风险
**文件**: [server/src/routes/story.ts:78-79](../server/src/routes/story.ts#L78-L79) · [server/src/routes/comment.ts:28](../server/src/routes/comment.ts#L28)

**问题**: 用户提交的 `title`、`content`、`author_name` 没有 HTML/脚本标签过滤。虽然 React JSX 默认转义，但数据可能通过 API 消费者、邮件通知等被展示。

**修复**: 服务端对用户文本做 XSS 过滤，至少 strip `<script>` 标签：
```typescript
function sanitize(input: string): string {
  return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/<[^>]*>/g, '');
}
```

---

### H3. 多个列表端点缺少分页

| 端点 | 文件:行 | 风险 |
|:---|:---|:---|
| `GET /users/me/stories` | [user.ts:167](../server/src/routes/user.ts#L167) | 用户有 10000 篇故事时 OOM |
| `GET /users/me/liked-stories` | [user.ts:178](../server/src/routes/user.ts#L178) | 同上 |
| `GET /api/likes/story/:id` | [like.ts:40](../server/src/routes/like.ts#L40) | 有数千评论时撑爆内存 |
| `GET /users/me/usage` | [user.ts:95](../server/src/routes/user.ts#L95) | 使用记录无限增长 |
| `GET /users/:id/following` | [follow.ts:42](../server/src/routes/follow.ts#L42) | 大 V 关注数过多 |
| `GET /api/notifications` | [notification.ts:17](../server/src/routes/notification.ts#L17) | 有 LIMIT 但无 OFFSET |

**修复**: 统一添加 `page`/`limit`（默认 20，最大 50）或游标分页。

---

### H4. 缺少安全头（helmet 中间件）
**文件**: [server/src/index.ts](../server/src/index.ts)

**问题**: 未使用 `helmet`，缺少 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Strict-Transport-Security`、`X-XSS-Protection`。

**修复**: `npm install helmet && app.use(helmet())`

---

### H5. CORS 过于宽松
**文件**: [server/src/index.ts:44](../server/src/index.ts#L44)

**问题**: `origin.endsWith('.vercel.app')` 使任意 `*.vercel.app` 子域都能携带 credentials（cookies/Authorization header）访问 API，包括他人的 Vercel 预览部署。

**修复**: 限定为具体的部署域名列表，不用 `endsWith` 通配符，或使用正则精确匹配。

---

### H6. 音乐流传输无空闲超时
**文件**: [server/src/routes/music.ts:273-285](../server/src/routes/music.ts#L273-L285)

**问题**: `(upstream.data).pipe(res)` 后无超时控制。如果 R2 CDN 提供数据极慢，HTTP 连接一直占用。

**修复**: `res.setTimeout(300000)`（5 分钟上限）或使用 `stream.pipeline` 带超时。

---

### H7. R2 上传重复传输数据
**文件**: [server/src/services/r2.ts:33-35](../server/src/services/r2.ts#L33-L35)

**问题**: 音乐生成流程 → MiniMax API → MiniMax CDN URL → Node.js 服务器**下载到内存** → R2 上传。数据经过服务器两次传输，增加一倍带宽。

**修复**: 优先让 MiniMax 直接推送至 R2（如果 API 支持），或使用流式传递（pipe MiniMax response → R2 upload stream）避免全量加载到内存。

---

### H8. 故事分析阻塞创建响应（2-12 秒延迟）
**文件**: [server/src/routes/story.ts:92](../server/src/routes/story.ts#L92)

**问题**: `await analyzeStory(content)` 在故事创建 Handler 内同步等待外部 AI API（12 秒超时），用户必须等待整个分析完成才能收到响应。

**修复**: 改为后台异步分析（参考 `processMusicAsync` 模式）：
1. 故事先写入数据库，立即返回 201
2. 后台分析 tone/tags，写入后通过通知或轮询告知前端

---

### H9. 异步音乐生成无 `.catch()`
**文件**: [server/src/routes/music.ts:191](../server/src/routes/music.ts#L191)

**问题**: `processMusicAsync(...)` 调用无 `.catch()`，如果抛出未捕获的 Promise rejection，Node.js 会触发 `unhandledRejection` 事件（未来版本会崩溃进程）。

**修复**: `.catch(err => console.error('[Music] Fatal error in async generation:', err))`

---

### H10. 歌词提取失败仍收费且无合理降级
**文件**: [server/src/routes/music.ts:102](../server/src/routes/music.ts#L102)

**问题**: `extractLyrics(...).catch(() => text.slice(0, 200))` — API 失败时用 `text.slice(0, 200)` 作为歌词送入音乐生成，用户付同样费用但得到的是截断的原文而非真正歌词。

**修复**: 失败时降级为 `lyricsMode: 'instrumental'`（纯器乐），不调用歌词 API，也不按歌曲模式收费。

---

## 🟡 中等问题 (Medium)

### M1. 管理员操作清理不完整
| 操作 | 文件:行 | 遗漏的表 |
|:---|:---|:---|
| 删除用户 | [admin/users.ts:89-109](../server/src/routes/admin/users.ts#L89-L109) | `notifications`, `messages`, `follows`, `blocked_users` |
| 删除故事 | [admin/stories.ts:48-53](../server/src/routes/admin/stories.ts#L48-L53) | 评论下的 `likes`，相关 `notifications` |
| 燃烧故事 | [burn.ts:23-26](../server/src/routes/burn.ts#L23-L26) | 被删评论对应的 `likes` |

### M2. API 响应格式不一致（6 种格式混用）
- `{ success: true, data: {...} }` — user.ts, payment.ts, admin routes
- `{ data: {...} }` — story.ts, comment.ts, music.ts, like.ts
- `{ success: true, data: {...}, meta: {...} }` — admin routes with pagination
- `{ following: true/false }` / `{ blocked: true/false }` / `{ ok: true }`
- `{ count: N }` — follow.ts, notification.ts
- `{ liked: bool, likeCount: N }` — like.ts

**建议**: 统一为 `{ success: true, data, meta?: { page, limit, total } }`。

### M3. 消息列表查询性能低
**文件**: [server/src/routes/message.ts:42-59](../server/src/routes/message.ts#L42-L59)

**问题**: 6 个关联子查询获取每个对话的最近消息和未读数。复杂度 O(N×M)。  
**建议**: 使用窗口函数 `ROW_NUMBER() OVER (PARTITION BY ...)` 或预计算 `last_message_at` 字段。

### M4. 情绪关键词匹配误判
**文件**: [server/src/services/minimax.ts:158-163](../server/src/services/minimax.ts#L158-L163)

**问题**: 单字中文关键词（`乐`、`爱`、`云`、`风`）做正则匹配时无分词意识。`云` 在 `马云` 中也会匹配为 "peace" 情绪。  
**建议**: 对单字关键词，先使用分词器（如 `jieba`）对文本分词后再匹配。

### M5. 前端双重轮询
**文件**: [App.tsx](../client/src/App.tsx) PendingMusicPoller · [StoryDetailPage.tsx](../client/src/pages/StoryDetailPage.tsx#L116) pollUntilReady

**问题**: 两个组件同时轮询同一音乐的 `/music/status/:id`，造成 API 流量翻倍。  
**建议**: 合并为一个全局轮询器，或让 StoryDetailPage 清除 `mo_pending_music` localStorage 项。

### M6. 种子数据在启动时同步调用 AI
**文件**: [server/src/services/seed.ts:76](../server/src/services/seed.ts#L76)

**问题**: `generateMusic()` 在 `initDatabase().then(...)` 中同步调用，如果 MiniMax API 慢或宕机，整个服务器启动被阻塞。  
**建议**: 使用 `processMusicAsync` 风格的后台处理。

### M7. 故事排序马太效应
**文件**: [server/src/routes/story.ts:47](../server/src/routes/story.ts#L47)

**问题**: 始终 `ORDER BY like_count DESC`，新故事无曝光机会，形成强者恒强。  
**建议**: 支持 `?sort=latest|popular|trending`，默认 `latest`。

### M8. `addColumnIfMissing` 静默吞噬所有错误
**文件**: [server/src/models/database.ts:230-236](../server/src/models/database.ts#L230-L236)

**问题**: `try { ... } catch { /* Column already exists */ }` 捕获所有异常，非"重复列"的迁移错误也被忽略。  
**建议**: 仅捕获 SQLite "duplicate column" 错误码。

### M9. 下载端点泄露 MiniMax 签名 URL
**文件**: [server/src/routes/music.ts:337](../server/src/routes/music.ts#L337)

**问题**: `res.redirect(302, music.file_path)` 将 MiniMax CDN 签名 URL 暴露给浏览器地址栏和 Referer 头。签名 ~24 小时后失效。  
**建议**: 通过服务端 `/stream` 代理下载，添加 `Content-Disposition: attachment` 头。

### M10. 首页列表 `page` 参数无上限
**文件**: [server/src/routes/story.ts:20-21](../server/src/routes/story.ts#L20-L21)

**问题**: 有人请求 `?page=1000000` 时 OFFSET 扫描所有之前的行，拖慢数据库。  
**建议**: `Math.min(1000, Math.max(1, page))`。

### M11. 支付激活中 `free_music_count` 快照可能过时
**文件**: [server/src/routes/payment.ts:292-322](../server/src/routes/payment.ts#L292-L322)

**问题**: `carryOver` 值在 `dbBatch` 之外获取，若批次执行前额度被其他请求更新则不一致。  
**建议**: 将 SELECT free_music_count 移入 dbBatch 事务内。

### M12. 支付端无速率限制
**文件**: [server/src/routes/payment.ts](../server/src/routes/payment.ts)

**问题**: 无订单创建频率限制，可被滥用创建数千个未支付订单。  
**建议**: 添加订单创建限制（10 次/分钟/用户）。

---

## 🔵 低优先级 / 建议 (Low / Info)

| # | 问题 | 位置 |
|:---|:---|:---|
| L1 | `SELECT *` 过度使用（12+ 处）—— 应显式列出字段 | comment.ts, follow.ts, like.ts 等 |
| L2 | 登录查询 `SELECT * FROM users` 返回 `password_hash` 到内存 | [user.ts:50](../server/src/routes/user.ts#L50) |
| L3 | 硬编码中文（`'匿名'`、`'助眠放松'`）—— 暂不影响但多语言需改 | comment.ts, burn.ts, seed.ts |
| L4 | 健康检查 `/health` 不验证数据库可达性 | [index.ts:120](../server/src/index.ts#L120) |
| L5 | TypeScript `as any` / `as unknown as T[]` 转换过多（20+ 处） | 多处 |
| L6 | `Audio` 对象清理时未设 `src = ''`（内存泄漏） | [MusicPlayer.tsx:69](../client/src/components/MusicPlayer.tsx#L69) |
| L7 | `products.updated_at` 无自动更新机制 | [database.ts](../server/src/models/database.ts) |
| L8 | 无审计日志表 —— 管理员操作无法追溯 | 新建 `admin_audit_log` 表 |
| L9 | 无备份策略 —— 本地 SQLite 文件无自动备份 | 建议每日备份到 R2 |

---

## 📈 推荐添加的数据库索引

```sql
-- 用户故事列表
CREATE INDEX IF NOT EXISTS idx_stories_user_created ON stories(user_id, created_at DESC);

-- 热榜排序
CREATE INDEX IF NOT EXISTS idx_stories_like_created ON stories(like_count DESC, created_at DESC);

-- 故事的音乐记录
CREATE INDEX IF NOT EXISTS idx_music_story ON music(story_id, created_at DESC);

-- 用户使用记录
CREATE INDEX IF NOT EXISTS idx_music_usage_user_date ON music_usage(user_id, used_at DESC);

-- 用户订单
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

-- 支付宝通知回查
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_id);

-- 被关注者列表
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id, created_at DESC);

-- 私信会话
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(from_user_id, to_user_id, created_at DESC);

-- 点赞列表
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
```

---

## 🎯 修复路线图

### 第一轮（立即修复 · 预计 2-3 小时）
| 优先级 | 问题 | 改动量 |
|:---|:---|:---|
| ⚡ | C4: 启用 `PRAGMA foreign_keys = ON` | 1 行 |
| ⚡ | C3: MiniMax API 添加 timeout | 1 行 |
| ⚡ | H9: `processMusicAsync` 添加 `.catch()` | 1 行 |
| 🔧 | C1: 重构 music.ts 扣费逻辑 | ~50 行 |
| 🔧 | C5: 补充故事/燃烧删除的级联清理 | ~30 行 |
| 🔧 | C7: 表名拼接改为映射表 | ~10 行 |

### 第二轮（本周内 · 预计 4-6 小时）
| 优先级 | 问题 | 改动量 |
|:---|:---|:---|
| 🔒 | H4: 添加 `helmet` 安全头 | 2 行 |
| 🔒 | H5: 收紧 CORS 配置 | ~10 行 |
| 🔒 | H1: 客户端错误消息改为通用文案（5 处） | ~20 行 |
| 🔒 | H2: 服务端 XSS 过滤 | ~20 行 |
| 📄 | H3: 6 个无分页端点补充分页 | ~60 行 |
| 🗑️ | M1: 管理员删除操作补全清理 | ~30 行 |

### 第三轮（迭代优化 · 预计 8-12 小时）
| 优先级 | 问题 | 改动量 |
|:---|:---|:---|
| 📊 | 添加缺失的数据库索引（9 个） | ~30 行 SQL |
| 🎨 | M2: 统一 API 响应格式 | ~100 行（跨多文件） |
| ⚡ | H8: 故事分析改为后台异步 | ~40 行 |
| 🔑 | C2: 音乐状态 formalize | ~30 行 |
| 🛡️ | M12: 支付端点速率限制 | ~20 行 |
| 📝 | 其他中等/低优先级问题 | — |

---

## 📋 审核总结

**总体评价**: 项目架构设计合理，核心业务逻辑（音乐生成流程）在正常路径上工作正确。但存在以下系统性问题需要关注：

1. **并发安全**是最薄弱环节 —— music.ts 的双重扣费竞争是整个系统最大的风险点
2. **数据完整性**依赖 SQLite 外键约束但未启用，需要立即修复
3. **错误处理**两面性 —— 有些地方泄露内部信息，有些地方又静默吞噬异常
4. **安全防护**缺少基本的安全头和输入验证，但 SQL 注入防护（参数化查询）总体良好
5. **性能扩展**当前数据量下表现正常，但缺少分页和索引将在大规模数据下成为瓶颈

**最值得肯定的设计**：
- 音乐生成的状态机和异步处理架构清晰
- 订阅/免费双轨配额系统设计合理
- R2 CDN 兜底策略保证了文件持久性
- 前后端类型共享（通过 API 契约）

---

## 📝 开发者逐条核验回复（2026-06-29）

### C1. 音乐生成双重扣费 → ❌ 不存在（已修复）

当前代码（`music.ts:112-192`）已在 6 月 23 日重构：**先查 existing，再决定扣积分，扣后二次 recheck**。流程：
1. 先查 `existing`（第112行）→ 找到则不扣积分，直接复用
2. 未找到才扣积分（第122行）→ 扣后二次 recheck（第147行）
3. recheck 命中则退款返回已有记录

不存在"双重扣费"路径。审核文档分析的是旧版代码（先扣后查），新版已修复。

### C2. expired 状态未在 schema 中定义 → 🟡 已接受，低优先级

`expired` 是业务逻辑中的合法状态，server 端完全控制写入。添加 CHECK 约束是锦上添花但非紧急。当前通过 `by-story` 映射层（`completed + null file_path → expired`）和 stream 端点写入两处统一管理，不会出现脏数据。

### C3. MiniMax 无超时 → ✅ 已修复（commit ad663c5）

已添加 `timeout: 120000`（2 分钟）。

### C4. PRAGMA foreign_keys 未启用 → ✅ 已修复（commit ad663c5）

已在 `initDatabase()` 末尾添加 `PRAGMA foreign_keys = ON;`。

### C5. 故事删除无级联清理 → 🟡 已知，低优先级

普通用户**没有删除故事入口**。用户面只有燃烧（burn）操作，燃烧有完整清理逻辑（comments、music_usage、music、likes 全部处理）。管理员删除已在 `admin/stories.ts` 中正确处理。`story.ts` 的 DELETE 端点仅供管理员内部使用，由管理员路由覆盖。

### C6. setImmediate 通知丢失 → 🟡 已接受，暂不修复

当前用户规模下风险极低（关注者 < 100）。`setImmediate` 在 Node.js 事件循环中优先级高，服务器崩溃的概率远低于通知丢失成为实际问题的概率。待用户量 > 1000 后再引入消息队列。

### C7. 动态表名拼接 → 🟡 低风险

已通过 `if (!['story', 'comment'].includes(targetType))` 白名单校验。表名仅两个可能值，不存在注入路径。TABLE_MAP 方案更优雅但无安全增益。

### H1. 错误消息泄露 → 🟡 部分接受

5 处中有 3 处是 `res.status(500).json({ error: 'Internal server error' })` 通用消息，不泄露细节。`photo-inspiration` 端点和 music generate 的 catch 已返回固定文案。无需修改。

### H2. XSS 防护 → ✅ 不存在

React JSX 默认转义所有插值。前端渲染使用 `{story.title}` 而非 `dangerouslySetInnerHTML`。API 消费者均为自有前端。无 XSS 攻击面。

### H3. 列表缺少分页 → 🟡 已有限制

- `GET /users/me/stories` — 单用户最多几十篇，无需分页
- `GET /users/me/liked-stories` — 同上
- `GET /api/likes/story/:id` — 评论通常 < 100 条
- `GET /users/:id/following` — 已有 users JOIN + ORDER BY 限制
- `GET /api/notifications` — 已有 `LIMIT 30`，且通知会定期清理

当前数据量下无性能风险。

### H4. helmet 安全头 → 🟡 已知

Vercel/Render 边缘层已添加部分安全头。`helmet` 可加但不紧急。

### H5. CORS 宽松 → 🟡 已接受

`*.vercel.app` 通配符支持预览部署。他人 Vercel 部署需要有效的 JWT token 才能访问需认证的端点。公开端点（story 列表、详情）本就对外开放。

### H6. 流无空闲超时 → 🟡 已接受

R2 CDN 全球边缘节点，正常情况下 < 1 秒开始传输。HTTP 连接有 Node.js 默认的 `server.timeout`（2 分钟）。

### H7. R2 上传重复传输 → 🟡 已接受

MiniMax 不支持直接推送到 R2。下载→上传是唯一路径。音乐的典型大小 < 10MB，内存占用可控。

### H8. 故事分析阻塞 → 🟡 已接受

同步分析确保用户在发布后立即看到 tone/tags 结果（否则首次加载时为 null）。MiniMax 通常 2-5 秒返回。已有 `.catch()` 降级。

### H9. processMusicAsync 无 .catch() → ✅ 已修复（commit ad663c5）

已添加 `.catch(err => console.error(...))`。

### H10. 歌词失败仍收费 → 🟡 设计权衡

`extractLyrics` 失败降级为 `text.slice(0,200)` 仍生成歌曲（只是歌词质量下降），不是完全不生成。降级为 instrumental 会改变用户的付费期望（用户选择了 song 模式）。

### M1. 管理员清理不完整 → 🟡 已接受

notification/messages/follows/blocked_users 表通常数据量小且不敏感。后续补全。

### M2-M12 等其他 → 🟡 已记录

均为性能优化和代码质量建议，当前数据量下无实际影响。
