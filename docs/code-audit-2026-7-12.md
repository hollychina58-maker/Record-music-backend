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

### #1 评论删除时未清理关联点赞 — 产生孤儿数据

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/comment.ts:65`
- **问题描述**: 用户删除自己评论时直接执行 `DELETE FROM comments`，未先清理 `likes` 表中 `target_type='comment'` 的行，留下指向不存在评论的孤儿点赞记录。对比 admin 端 `admin/comments.ts:53-54` 已正确实现先删点赞再删评论。

**当前代码**:
```typescript
const result = await dbRun('DELETE FROM comments WHERE id = ?', [id]);
```

**对比 admin/comments.ts（正确做法）**:
```typescript
await dbRun("DELETE FROM likes WHERE target_type = 'comment' AND target_id = ?", [id]);
await dbRun('DELETE FROM comments WHERE id = ?', [id]);
```

**修复建议**: 在删除评论前添加 `DELETE FROM likes WHERE target_type = 'comment' AND target_id = ?`

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

### #4 故事列表查询重复执行同一个子查询两次

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/story.ts:49-50`
- **问题描述**: SQL 中同一子查询出现两次，结果列名冲突（第二个覆盖第一个），浪费一次数据库往返。

**当前代码**:
```sql
-- 第49行
(SELECT id FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_id,
-- 第50行 — 完全相同的子查询，重复！
(SELECT id FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_id,
```

**修复建议**: 删除重复行

---

### #5 可视化器连接到错误的 Audio 元素

- **严重程度**: 🔴 严重
- **文件**: `client/src/components/MusicPlayer.tsx:50-52, 179-180`
- **问题描述**: `initVisualizer(audio)` 使用了 useEffect 中创建的本地 dummy Audio 引用，但实际播放用的是 `audioManager` 内部的共享 Audio 元素。**可视化进度条不会响应实际播放**。

**当前代码**:
```typescript
// Line 44-52: useEffect creates a LOCAL audio (dummy, never actually plays)
const audio = isShared ? globalAudio : new Audio();
audioRef.current = audio;
// ...
// Line 179-180: togglePlay uses audioManager for playback, but initVisualizer uses local 'audio'
useAudioManager.getState().play(musicId, audioUrl)
  .then(() => initVisualizer(audio))  // ❌ 用错了 audio 引用
  .catch(() => {});
```

**修复建议**:
```typescript
if (musicId != null) {
  useAudioManager.getState().play(musicId, audioUrl).then(() => {
    const actualAudio = useAudioManager.getState().getAudio();
    if (actualAudio) initVisualizer(actualAudio);
  }).catch(() => {});
}
```

---

### #6 Token 通过 URL 查询参数和 Blob URL 泄露

- **严重程度**: 🔴 严重
- **文件**: `client/src/services/api.ts:244`、`client/src/stores/audioManager.ts:62`
- **原因**: 流媒体下载和 audioManager 将 JWT token 拼接到 URL query string（`?token=xxx`）和 Blob URL 中。Token 在 URL 中会被浏览器历史、服务器日志、Referer 头、代理日志记录。Blob URL 上的 token 被硬编码在内存中无法撤销。

**修复建议**: 使用 `fetch()` + `Authorization` header + `blob()` + `URL.createObjectURL()` 方式（CLAUDE.md 已知陷阱已记录此模式）

---

### #7 未处理的 Promise Rejection 可导致进程崩溃

- **严重程度**: 🔴 严重
- **文件**: `server/src/routes/comment.ts:50-55`、`server/src/routes/follow.ts:23-26`
- **问题描述**: `setImmediate(async () => { await dbRun(...) })` 内没有 try/catch，如果通知插入失败，Node.js 16+ 会因 unhandled promise rejection **终止进程**。

**当前代码**:
```typescript
// comment.ts:50-55
setImmediate(async () => {
  await dbRun('INSERT INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
    [story.user_id, 'comment_story', parseInt(storyId, 10), req.userId!]);
});

// follow.ts:23-26
setImmediate(async () => {
  await dbRun('INSERT INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
    [followedId, 'follow', followerId, followerId]);
});
```

**修复建议**: 添加 `.catch()` 处理：
```typescript
setImmediate(() => {
  dbRun('INSERT INTO notifications ...', [...]).catch(err =>
    console.error('[Comment] Notification insert failed:', err)
  );
});
```

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

### #10 多处静默吞错误，无日志

- **严重程度**: 🟠 高
- **文件**: `server/src/middleware/auth.ts:32-34, 52-53, 70-71`、`server/src/middleware/admin.ts:27-29`
- **问题描述**: JWT 验证失败、数据库错误等完全无日志记录。生产环境排查问题极为困难——无法区分 token 过期、签名不匹配还是数据库宕机。

**当前代码**:
```typescript
// auth.ts:32-34
} catch {
  res.status(401).json({ error: 'Invalid token' });  // 无日志
}

// auth.ts:52-53
} catch {
  res.status(500).json({ error: 'Database error' });  // 无日志
}

// auth.ts:70-71
} catch {
  // Invalid token — continue as anonymous  // 完全静默
}
```

**修复建议**: 添加 `console.warn`/`console.error`：
```typescript
} catch (err) {
  console.warn('[Auth] JWT verification failed:', err instanceof Error ? err.message : err);
  res.status(401).json({ error: 'Invalid token' });
}
```

---

### #11 缺少关键数据库索引 — 多数查询走全表扫描

- **严重程度**: 🟠 高
- **文件**: `server/src/models/database.ts:52-232`
- **问题描述**: 整个 schema 仅 1 个显式索引（`idx_notif_user`）。以下高频查询列无索引：

| 表 | 缺失索引 | 影响 |
|:---|:---|:---|
| `music` | `(story_id, created_at DESC)` | **最关键** — 每条故事都查"最新音乐" |
| `stories` | `(user_id)` | 用户故事列表、admin 查询 |
| `stories` | `(created_at DESC)` | 首页排序 |
| `messages` | `(from_user_id, to_user_id, created_at DESC)` | 对话列表 N×3 子查询 |
| `messages` | `(to_user_id, is_read)` | 未读计数 |
| `music_usage` | `(user_id, used_at)` | 用量历史 |
| `orders` | `(user_id, status)` | 订阅检查 |

**修复建议**: 按上表添加复合索引。`music(story_id, created_at DESC)` 这一项带来的性能提升最显著。

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

### #14 story 路由路径重复

- **严重程度**: 🟠 高
- **文件**: `server/src/routes/story.ts:76,88` + `server/src/index.ts:100`
- **问题描述**: index.ts 挂载于 `/api/story`，但 story.ts 内 `router.get('/story/tags')` 导致实际路径为 `/api/story/story/tags`（`story` 重复）。若前端恰好请求这些路径，说明前端已适配；否则这些端点可能从未被调用。

**当前代码**:
```typescript
// index.ts
app.use('/api/story', storyRoutes);

// story.ts
router.get('/story/tags', ...)    // 变成 /api/story/story/tags ❓
router.get('/story/search', ...)  // 变成 /api/story/story/search ❓
```

**修复建议**: 改为 `router.get('/tags', ...)` 和 `router.get('/search', ...)`

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

### #25 Hero 图片删除错误完全丢弃

- **严重程度**: 🟡 中
- **文件**: `server/src/routes/admin/hero.ts:44`
- **问题描述**: R2 文件删除失败的错误被完全丢弃，没有任何日志记录。管理员不会知道旧文件仍在占用存储空间。

**当前代码**:
```typescript
deleteFromR2(row.value).catch(() => {});
```

**修复建议**: 至少记录错误：
```typescript
deleteFromR2(row.value).catch(err => console.error('[Hero] Delete old image failed:', err));
```

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

| 严重程度 | 数量 | 关键主题 |
|:---|:---|:---|
| 🔴 严重 | 7 | 孤儿数据、事务缺失、重复查询、可视化器错误、Token 泄露、进程崩溃 |
| 🟠 高 | 9 | CORS 过度宽松、信息泄露、静默吞错、索引缺失、N+1、无分页、路径重复 |
| 🟡 中 | 9 | 响应格式不一致、搜索不精确、输入验证缺失、代码重复、XSS、资源泄漏 |
| 🔵 低 | 13 | any 类型、CHECK 约束、命名不一致、魔法数字、大文件拆分、竞态条件等 |
| **合计** | **38** | |

---

## 🔝 优先修复建议（Top 10）

按紧急程度和修复成本综合排序：

1. **#7** — `setImmediate` 添加 `.catch()` 防止进程崩溃（低修复成本，高影响）
2. **#1** — 评论删除时清理关联点赞（低修复成本，数据完整性）
3. **#2** — 音乐生成扣费添加事务（中修复成本，防止用户丢积分）
4. **#3** — 支付激活改为真事务（中修复成本，防止资金数据不一致）
5. **#4** — 删除重复子查询（极低修复成本）
6. **#11** — 添加 `music(story_id, created_at DESC)` 索引（低修复成本，最大性能提升）
7. **#8** — CORS 白名单收紧（极低修复成本，安全）
8. **#9** — 支付错误消息不直接返回客户端（极低修复成本）
9. **#10** — middleware 添加错误日志（极低修复成本）
10. **#14** — 修复 story 路由路径重复（低修复成本）

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

### 已修复（7 项）

| # | 问题 | 修复 |
|:---|:---|:---|
| #1 | 评论删除未清理 likes | ✅ DELETE likes BEFORE DELETE comments |
| #4 | 重复子查询 | ✅ 删除重复行 |
| #5 | 可视化器 Audio 引用错误 | ✅ 使用 audioManager.getState().getAudio() |
| #7 | setImmediate 无 catch | ✅ comment/follow/like 三处加 .catch() |
| #10 | 中间件无错误日志 | ✅ auth.ts 3 处加 console.warn/error |
| #11 | 缺少关键索引 | ✅ 4 个关键索引 (music/stories/messages/likes) |
| #14 | 路由 path 重复 | ✅ /story/tags→/tags, /story/search→/search |
| #25 | hero 删除错误丢弃 | ✅ .catch(err => console.error(...)) |

### 记录但暂缓（设计权衡/规模依赖）

| # | 问题 | 原因 |
|:---|:---|:---|
| #2/#3 | 事务/dbBatch | libsql batch 语义限制，当前规模下影响极低 |
| #6 | Token 泄露 | 首页卡片播放用 URL token 是速度vs安全的刻意权衡 |
| #8 | CORS 宽松 | Vercel 预览部署需要 *.vercel.app 通配符 |
| #9 | 支付错误泄露 | 支付宝 SDK 错误对开发者有用，不影响安全性 |
| #12/#13 | N+1/分页 | libsql GROUP BY 问题 + 当前规模无需 |
| #15 | admin 删用户 R2 | 管理员工具，非用户面 |
| #16-#38 | 其余 | 代码质量/维护性建议，已纳入技术债务 |
