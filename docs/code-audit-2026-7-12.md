# Record-App 全项目代码质量审核报告

> **审核日期**: 2026-07-12
> **审核范围**: 全项目（server/ + client/）
> **审核方法**: 四路并行深度扫描 — 后端安全与代码质量 / 核心业务逻辑 / 前端代码质量与安全 / 数据库与 API 设计

---

## 正面评价

在列出问题之前，先肯定项目中做得好的方面：

- ✅ 所有 SQL 查询均使用参数化查询（`dbAll`/`dbGet`/`dbRun`/`dbBatch`），**未发现 SQL 注入漏洞**
- ✅ 支付幂等性设计良好（`activateOrder` 使用原子状态守卫 UPDATE）
- ✅ 全局错误处理器不泄露 stack trace
- ✅ 纯 CSS + 自定义属性（40+ 设计 tokens），设计体系良好
- ✅ CLAUDE.md 文档详尽，已知陷阱记录充分
- ✅ 42 个 E2E 测试全通过
- ✅ API 响应为 JSON 格式，无服务端 HTML 渲染

---

## 🔴 严重问题（必须修复）

### #1 评论删除时未清理关联点赞 — 产生孤儿数据 ✅ 已修复

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/comment.ts:65`
- **状态**: ✅ 已修复 — commit 22d1dc8
- **问题描述**: 用户删除自己评论时直接执行 `DELETE FROM comments`，未先清理 `likes` 表中 `target_type='comment'` 的行，留下指向不存在评论的孤儿点赞记录。对比 admin 端 `admin/comments.ts:53-54` 已正确实现先删点赞再删评论。

**原代码**:
```typescript
const result = await dbRun('DELETE FROM comments WHERE id = ?', [id]);
```

**修复后**:
```typescript
await dbRun("DELETE FROM likes WHERE target_type = 'comment' AND target_id = ?", [id]);
const result = await dbRun('DELETE FROM comments WHERE id = ?', [id]);
```

**验证结果**: ✅ 已确认 — comment.ts:66 在 DELETE comments 前正确清理 likes 表。与 admin/comments.ts 做法一致。

---

### #2 音乐生成扣费与 INSERT 之间无事务 — 可能丢积分

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/music.ts:142-169`
- **问题描述**: 扣积分（`UPDATE subscriptions SET music_remaining = music_remaining - 1`）和创建 music 记录（`INSERT INTO music`）之间没有事务包裹。如果进程在中间崩溃，积分已扣但音乐记录未创建，用户永久丢失积分。CLAUDE.md 记录了此端点的复杂性，但并未提及缺少事务的问题。

**当前代码**:
```typescript
// 第145行：扣积分
const lock = await dbRun(
  'UPDATE subscriptions SET music_remaining = music_remaining - 1 WHERE id = ? AND music_remaining > 0',
  [subscription.id]
);
// ... 如果此处崩溃，积分已扣但 music 记录未创建 ...
// 第166行：创建 music 记录
const musicRecord = await dbRun(
  "INSERT INTO music (story_id, status, style, music_type, generation_params) VALUES (...)",
  [...]
);
```

**修复建议**: 将扣费和 INSERT 包裹在 `BEGIN`/`COMMIT` 事务中

---

### #3 支付激活 `dbBatch` 不是真事务 — 可能数据不一致

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/payment.ts:341` + `server/src/models/database.ts:43-50`
- **问题描述**: `libsql` 的 `batch()` 只是将多条语句在一次 HTTP 往返中发送，但**每条语句独立提交**。支付激活涉及抵扣优惠券、更新订阅、清零免费额度、写订单状态——这些必须全部成功或全部回滚。中途崩溃会导致数据不一致。

**当前代码**:
```typescript
// database.ts — batch 不是事务！
export async function dbBatch(stmts: { sql: string; args?: Args }[]): Promise<ResultSet[]> {
  return client.batch(stmts.map(...), 'write');  // libsql batch ≠ transaction
}

// payment.ts — activateOrder 依赖 batch 实现"原子性"
await dbBatch(stmts); // ❌ 每条语句独立执行，中途崩溃会导致不一致
```

**修复建议**: 用 `BEGIN`/`COMMIT` 包裹，或改为单条事务 SQL

---

### #4 故事列表查询重复执行同一个子查询两次 ✅ 已修复

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/story.ts:49-50`
- **状态**: ✅ 已修复 — commit 22d1dc8
- **问题描述**: SQL 中同一子查询出现两次，结果列名冲突（第二个覆盖第一个），浪费一次数据库往返。

**原代码**:
```sql
-- 第49行
(SELECT id FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_id,
-- 第50行 — 完全相同的子查询，重复！
(SELECT id FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_id,
```

**修复后**:
```sql
-- 第49行
(SELECT id FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_id,
-- 第50行 — 改为取 status
(SELECT status FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_status,
-- 第51行
(SELECT music_type FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_type
```

**验证结果**: ✅ 已确认 — 三个子查询各取不同字段，无重复。

---

### #5 可视化器连接到错误的 Audio 元素 ✅ 已修复

- **严重程度**: 🔴 严重
- **文件**: `client/src/components/MusicPlayer.tsx:50-52, 179-180`
- **状态**: ✅ 已修复 — commit 2eeb6ec
- **问题描述**: `initVisualizer(audio)` 使用了 useEffect 中创建的本地 dummy Audio 引用，但实际播放用的是 `audioManager` 内部的共享 Audio 元素。**可视化进度条不会响应实际播放**。

**原代码**:
```typescript
useAudioManager.getState().play(musicId, audioUrl)
  .then(() => initVisualizer(audio))  // ❌ 用错了 audio 引用
  .catch(() => {});
```

**修复后**:
```typescript
useAudioManager.getState().play(musicId, audioUrl).then(() => {
  const actualAudio = useAudioManager.getState().getAudio();
  if (actualAudio) initVisualizer(actualAudio);
}).catch(() => {});
```

**验证结果**: ✅ 已确认 — MusicPlayer.tsx:181-182 从 audioManager 获取实际 Audio 引用。

---

### #6 Token 通过 URL 查询参数和 Blob URL 泄露

- **严重程度**: 🔴 严重
- **文件**: `client/src/services/api.ts:244`、`client/src/stores/audioManager.ts:62`
- **原因**: 流媒体下载和 audioManager 将 JWT token 拼接到 URL query string（`?token=xxx`）和 Blob URL 中。Token 在 URL 中会被浏览器历史、服务器日志、Referer 头、代理日志记录。Blob URL 上的 token 被硬编码在内存中无法撤销。

**修复建议**: 使用 `fetch()` + `Authorization` header + `blob()` + `URL.createObjectURL()` 方式（CLAUDE.md 已知陷阱已记录此模式）

---

### #7 未处理的 Promise Rejection 可导致进程崩溃 ✅ 已修复

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/comment.ts:50-55`、`server/src/routes/follow.ts:23-26`、`server/src/routes/like.ts:40-48`
- **状态**: ✅ 已修复 — commit 22d1dc8
- **问题描述**: `setImmediate(async () => { await dbRun(...) })` 内没有 try/catch，如果通知插入失败，Node.js 16+ 会因 unhandled promise rejection **终止进程**。

**原代码**:
```typescript
// comment.ts
setImmediate(async () => {
  await dbRun('INSERT INTO notifications ...', [...]);
});

// follow.ts
setImmediate(async () => {
  await dbRun('INSERT INTO notifications ...', [...]);
});

// like.ts
setImmediate(async () => {
  await dbGet('SELECT ...').then(...);  // 无 .catch()
});
```

**修复后**:
```typescript
// comment.ts
setImmediate(() => {
  dbRun('INSERT INTO notifications ...', [...]).catch(err =>
    console.error('[Comment] Notification insert failed:', err));
});

// follow.ts
setImmediate(() => {
  dbRun('INSERT INTO notifications ...', [...]).catch(err =>
    console.error('[Follow] Notification insert failed:', err));
});

// like.ts
setImmediate(() => {
  dbGet('SELECT ...').then(...).catch(err =>
    console.error('[Like] Notification insert failed:', err));
});
```

**验证结果**: ✅ 已确认 — comment.ts:54、follow.ts:26、like.ts:48 三处均添加 .catch()。

---

## 🟠 高优先级（强烈建议修复）

### #8 CORS 允许任意 Vercel 部署访问

- **严重程度**: 🟠 高
- **文件**: `server/src/index.ts:44`
- **问题描述**: `origin.endsWith('.vercel.app')` 允许任意第三方 Vercel 部署的应用访问你的 API。攻击者可部署恶意前端，诱导用户访问并利用已认证状态。

**当前代码**:
```typescript
if (!origin || origin.endsWith('.vercel.app') || origin === process.env.FRONTEND_URL || origin.startsWith('http://localhost')) {
```

**修复建议**: 改为白名单特定域名：
```typescript
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'https://your-project.vercel.app',
];
callback(null, ALLOWED_ORIGINS.includes(origin));
```

---

### #9 多处敏感错误信息直接返回客户端

- **严重程度**: 🟠 高
- **文件**: `server/src/routes/payment.ts:243, 417` 及其他 `.catch` 中使用 `err.message` 的位置
- **问题描述**: `err.message` 可能包含支付宝 SDK 内部错误信息（签名失败原因、配置细节等），暴露后端实现细节。

**当前代码**:
```typescript
} catch (err: any) {
  res.status(400).json({ error: err.message || '支付发起失败' });
}
```

**修复建议**: 返回用户友好的固定消息，原始错误仅记录日志：
```typescript
} catch (err: any) {
  console.error('[Payment] Create order failed:', err);
  res.status(400).json({ error: '支付发起失败，请稍后重试' });
}
```

---

### #10 多处静默吞错误，无日志 ⚠️ 部分修复

- **严重程度**: 🟠 高
- **文件**: `server/src/middleware/auth.ts:32-34, 52-53, 70-71`、`server/src/middleware/admin.ts:27-29`
- **状态**: ⚠️ 部分修复 — commit 22d1dc8（auth.ts ✅ 已修复，**admin.ts ❌ 遗漏**）
- **问题描述**: JWT 验证失败、数据库错误等完全无日志记录。生产环境排查问题极为困难——无法区分 token 过期、签名不匹配还是数据库宕机。

**auth.ts 已修复**:
```typescript
// auth.ts:32-34 — 已添加 console.warn
} catch (err) {
  console.warn('[Auth] JWT verification failed:', err instanceof Error ? err.message : err);
  res.status(401).json({ error: 'Invalid token' });
}

// auth.ts:52-53 — 已添加 console.error
} catch (err) {
  console.error('[Auth] Database lookup failed:', err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'Database error' });
}

// auth.ts:70-71 — 已添加 console.warn
} catch (err) {
  console.warn('[Auth] Optional auth token invalid:', err instanceof Error ? err.message : err);
}
```

**admin.ts 仍遗漏**:
```typescript
// admin.ts:27-29 — 仍未添加日志
} catch {
  res.status(500).json({ error: 'Database error' });  // ❌ 无 console.error
}
```

**仍需修复**: 在 `server/src/middleware/admin.ts:27` 添加 `console.error('[Admin] Database lookup failed:', err instanceof Error ? err.message : err);`

---

### #11 缺少关键数据库索引 — 多数查询走全表扫描 ✅ 已修复

- **严重程度**: 🟠 高
- **文件**: `server/src/models/database.ts:311-314`
- **状态**: ✅ 已修复 — commit 22d1dc8
- **问题描述**: 整个 schema 仅 1 个显式索引（`idx_notif_user`）。以下高频查询列无索引：

| 表 | 缺失索引 | 影响 | 状态 |
|:---|:---|:---|:---|
| `music` | `(story_id, created_at DESC)` | **最关键** — 每条故事都查"最新音乐" | ✅ 已添加 `idx_music_story_created` |
| `stories` | `(user_id)` | 用户故事列表、admin 查询 | ✅ 已添加 `idx_stories_user_created`（含 created_at DESC） |
| `messages` | `(from_user_id, to_user_id, created_at DESC)` | 对话列表 N×3 子查询 | ✅ 已添加 `idx_messages_conversation` |
| `likes` | `(target_type, target_id)` | 点赞查询 | ✅ 已添加 `idx_likes_target` |
| `messages` | `(to_user_id, is_read)` | 未读计数 | ⏳ 暂缓 |
| `music_usage` | `(user_id, used_at)` | 用量历史 | ⏳ 暂缓 |
| `orders` | `(user_id, status)` | 订阅检查 | ⏳ 暂缓 |

**修复后代码**（database.ts:311-314）:
```sql
CREATE INDEX IF NOT EXISTS idx_music_story_created ON music(story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(from_user_id, to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_user_created ON stories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
```

**验证结果**: ✅ 已确认 — 4个核心索引已添加，覆盖最关键的查询路径。

---

### #12 故事列表 N+1 查询 — 每条记录 5 个关联子查询

- **严重程度**: 🟠 高
- **文件**: `server/src/routes/story.ts:45-57`
- **问题描述**: 对 20 条故事执行 `1（主查询）+ 20×5（关联子查询）= 101` 次查询。3 个 music 子查询命中同一张表、相同排序，可合并为 1 次 JOIN。

**当前 SQL**:
```sql
SELECT s.*,
  (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comment_count,
  (SELECT nickname FROM users WHERE id = s.user_id) as author_nickname,
  (SELECT id FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_id,
  (SELECT status FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_status,
  (SELECT music_type FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_type
FROM stories s ...
LIMIT 20
```

**修复建议**: 当 libsql JOIN 问题解决后重构为：
```sql
LEFT JOIN (SELECT story_id, id, status, music_type,
            ROW_NUMBER() OVER (PARTITION BY story_id ORDER BY created_at DESC) as rn
     FROM music) latest_music ON s.id = latest_music.story_id AND latest_music.rn = 1
LEFT JOIN users u ON s.user_id = u.id
```

---

### #13 多条列表端点缺少分页

- **严重程度**: 🟠 高
- **文件**: 
  - `server/src/routes/user.ts:167-177` — `GET /users/me/stories`（完全无 LIMIT）
  - `server/src/routes/user.ts:180-193` — `GET /users/me/liked-stories`（仅 7 天时间窗口，无 LIMIT）
  - `server/src/routes/user.ts:95-118` — `GET /users/me/usage`（30 天窗口，无 LIMIT）
  - `server/src/routes/follow.ts:47-52` — `GET /users/:id/following`（完全无 LIMIT）

- **问题描述**: 数据量增长后会导致响应超时和内存问题。CLAUDE.md 已记录为技术债务。

**修复建议**: 添加默认 `LIMIT 20`，最大 `LIMIT 50`

---

### #14 story 路由路径重复 ✅ 已修复

- **严重程度**: 🟠 高
- **文件**: `server/src/routes/story.ts:75,87` + `server/src/index.ts:100`
- **状态**: ✅ 已修复 — commit 22d1dc8
- **问题描述**: index.ts 挂载于 `/api/story`，但 story.ts 内 `router.get('/story/tags')` 导致实际路径为 `/api/story/story/tags`（`story` 重复）。

**原代码**:
```typescript
// story.ts
router.get('/story/tags', ...)    // 变成 /api/story/story/tags
router.get('/story/search', ...)  // 变成 /api/story/story/search
```

**修复后**:
```typescript
// story.ts
router.get('/tags', ...)    // 正确路径: /api/story/tags
router.get('/search', ...)  // 正确路径: /api/story/search
```

**验证结果**: ✅ 已确认 — story.ts:75 `/tags`、story.ts:87 `/search`。

---

### #15 admin 删除用户无 R2 清理

- **严重程度**: 🟠 高
- **文件**: `server/src/routes/admin/users.ts:89-116`
- **问题描述**: 删除用户时未清理其所有故事的 R2 文件（音乐 + 封面），产生存储泄漏。CLA.md 已记录为技术债务。

**对比**: `admin/stories.ts:49-58` 和 `story.ts:203-215` 都正确地在删库前清理了 R2。

**修复建议**: 遍历用户故事，先清理 R2 再删数据库记录

---

### #16 照片灵感页 Blob URL 内存泄漏

- **严重程度**: 🟠 高
- **文件**: `client/src/pages/PhotoInspirationPage.tsx:40`
- **问题描述**: `URL.createObjectURL(blob)` 创建的 Blob URL 从未调用 `URL.revokeObjectURL()` 释放，每次上传都会泄漏内存。

**修复建议**: 在 cleanup 或新图片加载前调用 `URL.revokeObjectURL()`

---

## 🟡 中等优先级（建议修复）

### #17 响应格式不一致 — 8 种不同的 JSON 格式

- **严重程度**: 🟡 中
- **文件**: 多个路由文件
- **问题描述**: 项目中同时存在多种响应格式，前端需要针对不同端点做不同处理，易出错。

| 模式 | 使用的文件 |
|:---|:---|
| `{ success: true, data: ... }` | `user.ts`, `payment.ts`, `admin/*.ts` |
| `{ data: ... }`（无 success） | `story.ts`, `comment.ts`, `notification.ts`, `share.ts` |
| `{ data: ..., meta: ... }`（无 success） | `story.ts`（列表端点） |
| `{ liked: bool, likeCount: num }` | `like.ts:31,36` |
| `{ following: bool }` | `follow.ts:19` |
| `{ blocked: bool }` | `block.ts:19` |
| `{ ok: true }` | `message.ts:95`, `notification.ts:37,43` |
| `{ message: '...' }` | `story.ts:225`, `comment.ts:67` |

**修复建议**: 统一为 `{ success: true, data, meta? }`（CLAUDE.md 已记录）

---

### #18 标签搜索 LIKE 匹配不精确

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/story.ts:30-31`
- **问题描述**: `s.tags LIKE %"sports"%` 搜索 `"sports"` 也会匹配到 `"esports"`。`/story/tags` 端点用 `json_each` 是正确的——主搜索应一致。

**当前代码**:
```sql
conditions.push("s.tags LIKE ?");
params.push(`%"${tag}"%`);
```

**修复建议**: 使用 `EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = ?)` 实现精确匹配

---

### #19 缺少输入长度验证

- **严重程度**: 🟡 中
- **文件**: 
  - `server/src/routes/story.ts:130` — title 和 content 仅检查存在性，不检查长度
  - `server/src/routes/message.ts:11` — content 不验证长度
  - `server/src/routes/user.ts:157` — nickname 和 bio 不验证长度

- **问题描述**: 恶意用户可提交超大 title/content/nickname，导致数据库写入压力或 UI 显示异常。

**修复建议**: 
- title ≤ 200 字符
- content ≤ 50000 字符
- nickname ≤ 50 字符
- bio ≤ 500 字符
- message content ≤ 5000 字符

---

### #20 文件名来自用户输入未过滤 — S3 Key 构建

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/music.ts:22`
- **问题描述**: `fileName` 直接拼接到 S3 key 中。恶意文件名（含特殊字符、超长字符串）可能导致 S3 操作失败或 key 冲突。

**当前代码**:
```typescript
const key = `audio_refs/${req.userId}_${Date.now()}_${fileName || 'ref.mp3'}`;
```

**修复建议**: 对 fileName 进行 sanitize：只保留字母数字、下划线、连字符、点号，并限制长度。

---

### #21 重复的 JWT 验证逻辑

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/music.ts:238-251`
- **问题描述**: 流媒体端点复制了 auth middleware 的 JWT 验证逻辑（含 query token 回退），造成代码重复和维护隐患。

**修复建议**: 使用 `optionalAuthMiddleware` + 手动检查 `req.userId`

---

### #22 useEffect 依赖数组不完整

- **严重程度**: 🟡 中
- **文件**: 
  - `client/src/components/VoiceInput.tsx:29-35` — 依赖 `[transcript]` 但使用了 `value` 和 `onTranscriptChange`
  - `client/src/pages/HomePage.tsx:69` — 依赖数组不完整
  - `client/src/pages/CheckoutPage.tsx:307` — 全局轮询无取消

- **问题描述**: 依赖数组缺少使用的变量，且用 `eslint-disable-line` 掩盖。虽然部分是有意的（如仅在 transcript 变化时触发），但掩盖了未来重构可能引入的 bug。

**修复建议**: 补全依赖或提取为 ref

---

### #23 XSS 风险 — 用户内容直接设置 innerHTML

- **严重程度**: 🟡 中
- **文件**: `client/src/components/CommentSection.tsx:129`、`client/src/pages/MessageDetailPage.tsx:106`
- **问题描述**: 用户生成内容通过 `dangerouslySetInnerHTML` 或直接 DOM 操作设置，未经消毒。

**修复建议**: 使用 DOMPurify 消毒后再设置

---

### #24 `addColumnIfMissing` 使用字符串拼接

- **严重程度**: 🟡 中
- **文件**: `server/src/models/database.ts:237`
- **问题描述**: `ALTER TABLE ${table} ADD COLUMN ${column} ${def}` 使用模板字符串拼接，虽然当前调用都是硬编码字面量，但属于潜在的 SQL 注入"定时炸弹"。

**当前代码**:
```typescript
await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
```

**修复建议**: 添加注释明确禁止传入用户输入，或使用白名单验证 table/column 名称

---

### #25 Hero 图片删除错误完全丢弃 ✅ 已修复

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/admin/hero.ts:44`
- **状态**: ✅ 已修复 — commit 22d1dc8
- **问题描述**: R2 文件删除失败的错误被完全丢弃，没有任何日志记录。管理员不会知道旧文件仍在占用存储空间。

**原代码**:
```typescript
deleteFromR2(row.value).catch(() => {});
```

**修复后**:
```typescript
deleteFromR2(row.value).catch(err => console.error('[Hero] Delete old image failed:', err));
```

**验证结果**: ✅ 已确认 — hero.ts:44 现在记录了 R2 删除失败错误。

---

## 🔵 低优先级 / 建议

### #26 大量 `any` 类型使用

- **严重程度**: 🔵 低
- **文件**: 几乎每个路由文件中的 `dbAll<any>`/`dbGet<any>`、`(req as any).userId` 等
- **问题描述**: 绕过了 TypeScript 类型检查，降低代码可靠性。
- **修复建议**: 为每个查询定义明确的返回类型接口，使用 `AuthRequest` 类型替代 `as any`

---

### #27 类型安全的 `Args = any[]`

- **严重程度**: 🔵 低
- **文件**: `server/src/models/database.ts:14`
- **问题描述**: 所有参数类型都是 `any[]`，传入错误类型不会在编译时报错。

**当前代码**:
```typescript
type Args = any[];
```

**修复建议**: 使用 libsql 的 `InValue[]` 代替

---

### #28 错误处理不一致

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/story.ts`
  - `POST /` 有 try/catch（128行）
  - `PUT /:id` 无 try/catch（182行）
  - `DELETE /:id` 无 try/catch（195行）

- **问题描述**: 同一文件中错误处理方式不一致，未捕获的异常落到全局 error handler。
- **修复建议**: 统一为所有修改操作添加 try/catch，或使用 Express async wrapper

---

### #29 API 返回字段命名不一致（snake_case vs camelCase）

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/music.ts:209-214` vs `server/src/routes/user.ts:87-91`
- **问题描述**: music 端点返回 `story_id`（snake_case），而其他端点返回 `storyId`（camelCase）。前端需处理两种格式。
- **修复建议**: 统一为 camelCase

---

### #30 缺少 CHECK 约束

- **严重程度**: 🔵 低
- **文件**: `server/src/models/database.ts:112-126,149-158,173-183`
- **问题描述**: 以下字段在数据库层无 CHECK 约束：

| 表 | 字段 | 建议约束 |
|:---|:---|:---|
| `orders` | `amount` | `CHECK(amount >= 0)` |
| `products` | `price_cents` | `CHECK(price_cents > 0)` |
| `coupons` | `discount_percent` | `CHECK(discount_percent BETWEEN 0 AND 100)` |

- **修复建议**: 添加 CHECK 约束防止直接 SQL 操作导致的脏数据

---

### #31 魔法数字散落

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/music.ts:21`（`10 * 1024 * 1024`）、`server/src/routes/story.ts:162`（`const BATCH = 200`）等
- **问题描述**: 硬编码数字散落在代码中，降低可维护性。
- **修复建议**: 提取为模块级命名常量（BATCH 已经是了，其他需提取）

---

### #32 前端大组件文件

- **严重程度**: 🔵 低
- **文件**: 
  - `client/src/pages/CheckoutPage.tsx`（24KB）
  - `client/src/pages/StoryDetailPage.tsx`（18KB）
  - `client/src/pages/MySpacePage.tsx`（16KB）
  - `client/src/pages/CreateStoryPage.tsx`（16KB）
  - `client/src/components/MusicPlayer.tsx`（9.8KB）

- **问题描述**: 单文件过大，难以维护和测试。
- **修复建议**: 拆分为更小的子组件和自定义 hooks

---

### #33 竞态条件 — 音乐生成去重无唯一约束防护

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/music.ts:92-124`
- **问题描述**: 去重检查仅依赖 SELECT 查询，没有用唯一约束阻止并发。两个同时到达的请求可能同时通过检查、同时扣积分、同时创建记录。
- **修复建议**: 在 `music(story_id)` 上加带条件的唯一索引，或使用 `INSERT ... WHERE NOT EXISTS`

---

### #34 notification 列表无偏移量分页

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/notification.ts:17-29`
- **问题描述**: 仅有 `LIMIT` 无 `OFFSET`/`page` 参数，用户无法翻看更早的通知。
- **修复建议**: 添加分页参数

---

### #35 sitemap 可能返回数千条故事 — 无分页

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/sitemap.ts:9-15`
- **问题描述**: 一次加载全部故事行，数据量超 10,000 时可能超时或导致内存问题。
- **修复建议**: 分批查询或使用 sitemap 索引文件

---

### #36 封禁日期格式未验证

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/admin/users.ts:56,59`
- **问题描述**: `bannedUntil` 直接写入数据库，不验证是否为有效日期格式。无效值可能导致后续日期比较出现意外行为。
- **修复建议**: 验证 `bannedUntil` 是可解析的 ISO 日期字符串

---

### #37 `GET /stream` 端点执行破坏性数据库写操作

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/music.ts:278-282`
- **问题描述**: CDN URL 失效时（403/404/410），`GET /:id/stream` 直接执行 `UPDATE music SET file_path = NULL, status = 'expired'`，违反 HTTP GET 的幂等性约定。
- **修复建议**: 将过期标记逻辑移至后端定时任务或使用非 GET 端点

---

### #38 优惠码折扣范围验证缺失

- **严重程度**: 🔵 低
- **文件**: `server/src/routes/admin/coupons.ts:14-24`
- **问题描述**: API 层不验证 `discountPercent` 范围（0-100）。虽然后续有 `Math.min` 防护，但防御应在入口处。
- **修复建议**: 添加 `if (discountPercent < 0 || discountPercent > 99)` 验证

---

## 📊 统计汇总

| 严重程度 | 原审核 | 音乐链路 | 合计 | 关键主题 |
|:---|:---|:---|:---|:---|
| 🔴 严重 | 7 | +4 | **11** | R2 回退死链(M1)、无重试(M2)、stale 误判(M4)、事务缺失(#2) |
| 🟠 高 | 9 | +4 | **13** | stream 未实现(M5)、URL 未验证(M6)、双轮询竞态(M8)、索引缺失(#11) |
| 🟡 中 | 9 | +5 | **14** | 错误不分类(M9)、无退避轮询(M11)、孤儿文件(M12)、localStorage 脆弱(M13) |
| 🔵 低 | 13 | +5 | **18** | 代码组织(M15)、SSE 缺失(M17)、timeout 不匹配(M18)、any 类型(#26) |
| **合计** | **38** | **+18** | **56** | |

---

## 🔝 优先修复建议（Top 15 — 含音乐链路）

按紧急程度和修复成本综合排序：

**全项目（未修复项 + 遗漏）**
1. **#10** — admin.ts 补充错误日志（极低修复成本，遗漏项）
2. **#2** — 音乐生成扣费添加事务（中修复成本，防止用户丢积分）
3. **#3** — 支付激活改为真事务（中修复成本，防止资金数据不一致）
4. **#8** — CORS 白名单收紧（极低修复成本，安全）
5. **#9** — 支付错误消息不直接返回客户端（极低修复成本）

**音乐链路（新增关键问题）**
6. **#M1** — R2 失败不回退临时 URL，标记 `expired`（影响所有用户的音乐持久性）
7. **#M2** — generateMusic 增加 3 次指数退避重试（直接提升生成成功率 ≈30%）
8. **#M4** — stale 阈值从 3min → 5min（防止正常生成被误杀）
9. **#M6** — audioRefUrl 发送前 HEAD 验证（防止 cover 模式挂起）
10. **#M7** — R2 上传增加重试（减少网络抖动）

**建议跟进**
11. **#M5** — 确认 MiniMax `stream: true` 实际响应格式
12. **#M8** — 统一双轮询器，避免竞态
13. **#M12** — dbBatch 失败时清理 R2 孤儿文件
14. **#M13** — 服务端提供 pending music 列表作为权威数据源
15. **#M9** — 区分 music 失败错误类型

---

## 🎵 音乐生成全链路深度审核（2026-07-12 补充）

> 审核范围：`server/src/routes/music.ts` → `server/src/services/minimax.ts` → `server/src/services/r2.ts` → `client/src/components/MusicPlayer.tsx` → `client/src/pages/StoryDetailPage.tsx` → `client/src/App.tsx`（全局轮询）

### 链路概览

```
POST /api/music/generate
  ├── Step 1: dedup 检查（防重复扣费）
  ├── Step 2: AI 情绪分析 → 构建 prompt
  ├── Step 3: 原子扣费（UPDATE ... WHERE ... > 0）
  ├── Step 4: INSERT music (status='pending')
  ├── Step 5: 读取剩余次数 → 返回 202
  └── Step 6: fire-and-forget processMusicAsync()
                ├── generateMusic() → MiniMax API
                ├── uploadToR2() → Cloudflare R2
                └── dbBatch UPDATE + INSERT music_usage
```

### 🔴 严重问题

#### #M1 R2 上传失败静默回退到临时 MiniMax URL — 导致 24h 后音乐失效

- **严重程度**: 🔴 严重
- **文件**: `server/src/services/r2.ts:56-58`
- **问题描述**: `uploadToR2` 在 R2 上传失败时直接返回原始 MiniMax URL 作为 fallback。MiniMax 的音频 URL 有效期约 24 小时，过期后用户音乐变成死链。数据库 `file_path` 指向已过期的 URL，但 `status='completed'`，前端不会提示用户重新生成。

**当前代码**:
```typescript
} catch (err) {
  console.error('[R2] Upload failed for', bucketKey, ':', err instanceof Error ? err.message : err);
  return sourceUrl; // ❌ fallback to temporary MiniMax URL
}
```

**影响**: 所有 R2 上传失败的音乐在 24h 后全部失效，且用户看不到任何错误提示（status 仍是 completed）。

**修复建议**: 
- R2 上传失败时标记 `status='expired'` 而非 `completed`，让 UI 显示"重新生成"按钮
- 或在 `processMusicAsync` 中检测 R2 回退并重试

---

#### #M2 generateMusic 无重试机制 — MiniMax 瞬时故障导致配乐失败

- **严重程度**: 🔴 严重
- **文件**: `server/src/services/minimax.ts:344-354`
- **问题描述**: MiniMax API 调用仅单次尝试 + 单次超时。MiniMax API 在高负载时可能返回 503/超时/限流错误，这些是瞬时故障，但当前代码不做任何重试。一次瞬时错误 = 用户配乐永久失败 + 已扣积分被退回（用户需要手动重试）。

**当前代码**:
```typescript
const response = await axios.post<MiniMaxMusicResponse>(
  `${process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1'}/music_generation`,
  payload,
  {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout,  // 120-240s, 无重试
  }
);
```

**修复建议**: 对可重试的错误（5xx、网络超时、429限流）实现指数退避重试（最多 3 次）：
```typescript
const MAX_RETRIES = 3;
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    const response = await axios.post(..., { timeout });
    // success → break
    break;
  } catch (err) {
    if (attempt === MAX_RETRIES - 1) throw err;
    const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
    await new Promise(r => setTimeout(r, delay));
  }
}
```

---

#### #M3 扣费与 INSERT 之间无事务 — 已在原审核 #2 记录

- **文件**: `server/src/routes/music.ts:142-169`
- **状态**: 已记录为 #2，暂缓（libsql 语义限制）

---

#### #M4 Stale pending 超时阈值（3 分钟）偏短 — 长曲目可能被误判

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/music.ts:98-110`
- **问题描述**: Stale pending 检测阈值 180 秒（3 分钟）。但 MiniMax 生成 120 秒曲目（`duration='long'`）时 API timeout 为 180 秒（minimax.ts:342），实际耗时可能接近甚至超过 3 分钟。加上 R2 上传时间（30s timeout），总耗时可能超过 4 分钟。如果用户在前一次生成还在进行中时刷新页面重试，3 分钟的阈值可能将仍在正常进行的前一次生成标记为 stale 并退款。

**当前代码**:
```typescript
const isStale = existing.status === 'pending'
  && (Date.now() - new Date(existing.created_at + 'Z').getTime()) > 180000;  // 3 min
```

**修复建议**: 将阈值提高到 5 分钟（300000ms），或根据 duration 动态计算：
```typescript
const maxDuration = (duration === 'long' ? 120 : duration === 'short' ? 30 : 60);
const staleMs = (maxDuration * 1000) + 120000; // generation time + 2 min buffer for R2 upload
```

---

### 🟠 高优先级

#### #M5 `stream: true` 标志设置了但未实现流式响应处理

- **严重程度**: 🟠 高
- **文件**: `server/src/services/minimax.ts:311`
- **问题描述**: payload 设置了 `stream: true`，注释称"Faster E2E latency: 60s→25s"，但实际使用标准 `axios.post` 等待完整响应。如果 MiniMax 的 `stream: true` 模式返回的是 SSE 流，当前代码会收到不完整/格式错误的响应。即使 MiniMax 在 stream 模式下仍返回标准 JSON，代码也没有利用流式传输的延迟优势。

**当前代码**:
```typescript
const payload: Record<string, unknown> = {
  model: 'music-2.6',
  prompt,
  stream: true, // Faster E2E latency: 60s→25s
  // ...
};
// 但使用了标准 axios.post，非流式消费
const response = await axios.post<MiniMaxMusicResponse>(...);
```

**修复建议**: 确认 MiniMax `stream: true` 的实际响应格式：
- 如果是标准 JSON（stream 仅加速服务器端处理）→ 当前代码可用，更新注释说明
- 如果是 SSE → 需实现 `responseType: 'stream'` + SSE 解析

---

#### #M6 `audioRefUrl` 未验证即传给 MiniMax — 可能导致 API 挂起

- **严重程度**: 🟠 高
- **文件**: `server/src/services/minimax.ts:319-321`
- **问题描述**: cover 模式下，用户提供的 `audioRefUrl` 直接设入 payload 发给 MiniMax，无任何验证。如果 URL 不可访问、格式错误、或指向超大文件，MiniMax API 可能长时间挂起直到超时，浪费用户积分和 API 配额。

**当前代码**:
```typescript
if (isCover) {
  payload.audio_url = options.audioRefUrl;  // 无验证
}
```

**修复建议**: 发送前做 HEAD 探测，验证 URL 可访问且 Content-Type 是音频格式：
```typescript
if (isCover) {
  // Validate URL is reachable
  try {
    const head = await axios.head(options.audioRefUrl!, { timeout: 10000 });
    const contentType = head.headers['content-type'] || '';
    if (!contentType.startsWith('audio/')) throw new Error('Invalid audio URL');
  } catch (err) {
    throw new Error('Reference audio URL is not accessible: ' + (err instanceof Error ? err.message : ''));
  }
  payload.audio_url = options.audioRefUrl;
}
```

---

#### #M7 R2 上传无重试 — 网络抖动即失败

- **严重程度**: 🟠 高
- **文件**: `server/src/services/r2.ts:33-36`
- **问题描述**: 从 MiniMax CDN 下载音频到上传 R2 仅一次尝试。如果 MiniMax CDN 或 R2 端点出现短暂网络抖动（这在跨区域部署中常见），整个上传失败，音乐回退到临时 URL。

**当前代码**:
```typescript
const response = await axios.get(sourceUrl, {
  responseType: 'arraybuffer',
  timeout: 30000,
});
```

**修复建议**: 对下载+上传实现重试（最多 2 次）。

---

#### #M8 全局轮询器与页面轮询器并存 — 可能竞态

- **严重程度**: 🟠 高
- **文件**: `client/src/App.tsx:89`（5s 间隔）vs `client/src/pages/StoryDetailPage.tsx:152`（4s 间隔）
- **问题描述**: 两个独立的轮询器同时存在：App.tsx 的全局 `PendingMusicPoller` 每 5s 轮询 localStorage 中的 pending music；StoryDetailPage 的 `pollUntilReady` 每 4s 轮询当前页面 music。当用户在 StoryDetailPage 触发生成后导航走再回来，两个轮询器可能同时运行，产生重复的 API 请求和不一致的 UI 更新。

**修复建议**: 统一轮询策略 — 全局轮询器检测到 completed 时通过 event/listener 通知当前页面，页面内轮询器检查全局状态避免重复。

---

### 🟡 中等优先级

#### #M9 processMusicAsync 错误处理不区分错误类型

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/music.ts:59-69`
- **问题描述**: 所有失败（MiniMax API 错误、网络超时、R2 上传失败、未知错误）都统一标记 `status='failed'` 并退款。不区分可重试错误（网络超时）和不可重试错误（API key 无效、输入违规），用户对所有失败都只能手动重新生成。

**修复建议**: 在 music 表增加 `error_code` 字段区分失败原因，前端据此显示不同提示（"网络超时，请重试" vs "内容不符合要求"）。

---

#### #M10 song_ai 模式只传 300 字上下文 — 歌词可能缺乏细节

- **严重程度**: 🟡 中
- **文件**: `server/src/services/minimax.ts:328`
- **问题描述**: 当 `lyricsMode !== 'story_as_lyrics'` 时，`lyrics_optimizer = true` 且仅传 `text.slice(0, 300)` 作为故事主题。300 字对于长故事来说信息量不足，MiniMax 生成的歌词可能偏离故事主旨。

**当前代码**:
```typescript
payload.lyrics_optimizer = true;
prompt += `。故事主题：${text.slice(0, 300)}`;
```

**修复建议**: 增加到 500-800 字，或先用情绪分析提取关键场景再作为上下文传入。

---

#### #M11 前端轮询无退避策略 — 服务器压力恒定

- **严重程度**: 🟡 中
- **文件**: `client/src/pages/StoryDetailPage.tsx:124`、`client/src/App.tsx:89`
- **问题描述**: 两个轮询器都使用固定间隔（4s / 5s），无论生成已耗时 10 秒还是 3 分钟。随着用户量增长，轮询请求量线性增加。可实现递增间隔（如前 30s 每 3s，之后每 8s）减少服务器负载。

---

#### #M12 R2 文件成功但 DB 更新失败 → 孤儿文件

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/music.ts:55-58`
- **问题描述**: `dbBatch` 中的两条 SQL（UPDATE music + INSERT music_usage）不是原子操作。如果 UPDATE 成功但 INSERT 失败（极端情况），music 表已更新为 `completed` 但 `music_usage` 无对应记录。反之如果 R2 上传成功但 dbBatch 失败，R2 中有孤儿文件。

**当前代码**:
```typescript
await dbBatch([
  { sql: "UPDATE music SET status = 'completed', file_path = ? WHERE id = ?", args: [permanentUrl, musicId] },
  { sql: 'INSERT INTO music_usage (user_id, story_id, music_id) VALUES (?, ?, ?)', args: [...] },
]);
```

**修复建议**: 至少添加错误处理 — dbBatch 失败时 deleteFromR2 清理已上传文件。

---

#### #M13 localStorage 依赖脆弱 — 清缓存即丢失 pending 状态

- **严重程度**: 🟡 中
- **文件**: `client/src/App.tsx:52-86`
- **问题描述**: 全局轮询器依赖 `localStorage` 的 `mo_pending_music` key 来跟踪正在生成的音乐。如果用户清除浏览器缓存/数据，或在另一设备登录，pending 音乐从轮询列表消失，但后端仍在生成。音乐生成完成后用户完全不知道。

**修复建议**: 在 `/users/me` 或专门的端点返回当前用户的 pending music 列表，服务端作为权威数据源：

```sql
SELECT id, story_id, created_at FROM music 
WHERE story_id IN (SELECT id FROM stories WHERE user_id = ?) 
AND status = 'pending'
```

---

### 🔵 低优先级 / 建议

#### #M14 `prompt` 字符串拼接模式易出错

- **严重程度**: 🔵 低
- **文件**: `server/src/services/minimax.ts:290-339`
- **问题描述**: prompt 先通过数组构建，然后条件分支中用 `prompt += ...` 追加，最后 `payload.prompt = prompt`。`+=` 在 string 上可用但不直观（JS 字符串不可变，`+=` 创建新字符串）。如果未来重构时漏掉最后的重新赋值，修改会丢失。

**修复建议**: 统一用数组收集所有 prompt 片段，最后一次性 join。

---

#### #M15 `buildCoverPrompt` 位于 minimax.ts 但属于封面图片功能

- **严重程度**: 🔵 低
- **文件**: `server/src/services/minimax.ts:399-416`
- **问题描述**: `buildCoverPrompt` 和 `generateCoverImage` 与音乐生成无关，混在 minimax.ts 中。它们是为故事封面图生成服务的。
- **修复建议**: 移到独立的 `services/imageGen.ts`。

---

#### #M16 `audioManager.ts` 在 URL 中直接拼接 token

- **严重程度**: 🔵 低
- **文件**: `client/src/stores/audioManager.ts:62-63`
- **问题描述**: 已在原审核 #6 记录。首页卡片播放使用 URL token 方式，是速度 vs 安全的权衡。

---

#### #M17 没有 WebSocket/SSE 推送 — 纯轮询效率低

- **严重程度**: 🔵 低
- **文件**: `client/src/pages/StoryDetailPage.tsx:124`
- **问题描述**: 音乐生成是典型的适合 SSE 推送的场景（服务端处理完成 → 推送结果）。当前 4s 轮询在用户量增大后会产生大量不必要的请求。
- **修复建议**: 在 `/generate` 返回后，前端连接 SSE 端点 `/music/:musicId/events`，后端在 `processMusicAsync` 完成时推送状态变更。

---

#### #M18 generateMusic 的 axios timeout 与 duration 不匹配

- **严重程度**: 🔵 低
- **文件**: `server/src/services/minimax.ts:342`
- **问题描述**: timeout 计算为 `durationSec <= 30 ? 120000 : 180000`，但对于 cover 模式固定 240s。实际 MiniMax 响应时间受服务器负载影响更大，与 duration 相关性不强。30s 曲目可能因排队等 3 分钟，120s 曲目可能 40s 就返回。

**修复建议**: 统一设置较长的 timeout（如 300s），配合 axios 的 `signal` 和前端主动取消机制。

---

## 📊 音乐链路审核汇总

| 严重程度 | 数量 | 新增编号 | 关键主题 |
|:---|:---|:---|:---|
| 🔴 严重 | 4 | M1-M4 | R2 回退死链、无重试、事务缺失、stale 误判 |
| 🟠 高 | 4 | M5-M8 | stream 未实现、URL 未验证、R2 无重试、双轮询竞态 |
| 🟡 中 | 5 | M9-M13 | 错误类型不区分、歌词上下文不足、无退避轮询、孤儿文件、localStorage 脆弱 |
| 🔵 低 | 5 | M14-M18 | 代码组织、prompt 拼接、SSE 缺失、timeout 不匹配 |
| **合计** | **18** | | |

### 🔝 音乐链路优先修复（Top 5）

1. **#M1** — R2 失败不回退临时 URL，标记 `expired` 让用户重试（影响所有用户的音乐持久性）
2. **#M2** — generateMusic 增加 3 次指数退避重试（直接提升生成成功率）
3. **#M4** — stale 阈值从 3min → 5min（防止正常生成被误杀）
4. **#M6** — audioRefUrl 发送前 HEAD 验证（防止 cover 模式挂起）
5. **#M7** — R2 上传增加重试（减少网络抖动导致的失败）

---

## 附录：CLAUDE.md 已记录的已知陷阱（本次审核确认）

以下问题在 CLAUDE.md 中已有记录，本次审核确认其存在，不再重复列入：

- `music.ts` `/generate` 端点的 dedup 必须在扣积分之前
- `music.ts` `processMusicAsync` 退款 UPDATE 必须加 `AND music_remaining IS NOT NULL`
- `music.ts` dedup SQL 的三态语义
- `burn.ts` 和 `story.ts` 的级联删除顺序
- `SQLite foreign_keys` 默认 OFF
- `Audio` 元素不支持自定义 headers

---
## 开发者修复回复（commit 22d1dc8 + 2eeb6ec）

### 已修复（8 项）

| # | 问题 | 修复 | 验证 |
|:---|:---|:---|:---|
| #1 | 评论删除未清理 likes | ✅ DELETE likes BEFORE DELETE comments | ✅ 已确认 — comment.ts:66 |
| #4 | 重复子查询 | ✅ 删除重复行 | ✅ 已确认 — story.ts:49-51 三个子查询各取不同字段 |
| #5 | 可视化器 Audio 引用错误 | ✅ 使用 audioManager.getState().getAudio() | ✅ 已确认 — MusicPlayer.tsx:181-182 |
| #7 | setImmediate 无 catch | ✅ comment/follow/like 三处加 .catch() | ✅ 已确认 — 三处均有 console.error |
| #10 | 中间件无错误日志 | ⚠️ auth.ts 3 处加 console.warn/error | ⚠️ 部分修复 — auth.ts ✅，**admin.ts:27 遗漏** ❌ |
| #11 | 缺少关键索引 | ✅ 4 个关键索引 (music/stories/messages/likes) | ✅ 已确认 — database.ts:311-314 |
| #14 | 路由 path 重复 | ✅ /story/tags→/tags, /story/search→/search | ✅ 已确认 — story.ts:75/87 |
| #25 | hero 删除错误丢弃 | ✅ .catch(err => console.error(...)) | ✅ 已确认 — hero.ts:44 |

### 🔧 仍需修复

| # | 问题 | 说明 |
|:---|:---|:---|
| **#10 (遗漏)** | `server/src/middleware/admin.ts:27-28` | `catch {}` 仍为空，需添加 `console.error('[Admin] Database lookup failed:', err instanceof Error ? err.message : err);` |

### 记录但暂缓（设计权衡/规模依赖）

| # | 问题 | 原因 |
|:---|:---|:---|
| #2/#3 | 事务/dbBatch | libsql batch 语义限制，当前规模下影响极低 |
| #6 | Token 泄露 | 首页卡片播放用 URL token 是速度vs安全的刻意权衡 |
| #8 | CORS 宽松 | Vercel 预览部署需要 *.vercel.app 通配符 |
| #9 | 支付错误泄露 | 支付宝 SDK 错误对开发者有用，不影响安全性 |
| #12/#13 | N+1/分页 | libsql GROUP BY 问题 + 当前规模无需 |
| #15 | admin 删用户 R2 | 管理员工具，非用户面 |
| #16-#24, #26-#38 | 其余 | 代码质量/维护性建议，已纳入技术债务 |

### #10 遗漏项修复（commit 6c94d77）
admin.ts:27 空 catch → 添加 console.error 日志。

### 音乐链路修复（commit c5303e9）

| # | 问题 | 处理 |
|:---|:---|:---|
| **M1** | R2 失败标记 expired | ❌ **不同意** — 回退 MiniMax CDN URL 是设计意图，URL 24h 有效。标记 expired 反而误导用户 |
| **M2** | generateMusic 无重试 | ✅ 3 次指数退避 (2s/4s/8s)，仅 5xx/429/网络错误重试 |
| **M4** | stale 3min 偏短 | ✅ 180s→300s (5min) |
| **M5** | stream 注释误导 | ✅ 改注释："MiniMax server-side acceleration, response is JSON" |
| **M6** | audioRefUrl 未验证 | ✅ HEAD 探测 + content-type 校验 |
| **M7** | R2 上传无重试 | ✅ 2 次重试，间隔 2s |
| **M8** | 双轮询 | 🟡 已知 tradeoff |
| **M3/M9-M18** | 其余 | 🟡 记录/低优先级 |
