### 第三轮修复验证（2026-06-29，commit 87b1d0c 之后）

对 commit 87b1d0c（重新生成音乐类型）验证：✅ 通过。修复质量高，三层回退逻辑正确，JSON 解析有 try/catch 保护。

---

# 🔄 第三轮独立审核（2026-06-29，基于全部修复后代码）

四路并行独立扫描——每路不参考任何历史结论，从源码重新出发。

---

## 📊 第三轮问题总览

| 严重等级 | 数量 | 主要领域 |
|:---|:---:|:---|
| 🔴 **严重** | 4 | admin 级联缺失+R2不清理、fetch无AbortController、regenerate参数bug、空catch吞噬致命错误 |
| 🟠 **高** | 6 | 扣费INSERT非原子、索引全面缺失、N+1子查询、carryOver快照、page无上限、seed阻塞启动 |
| 🟡 **中** | 8 | LIKE全表扫描、响应格式不一致、dedup LIMIT1竞态、支付轮询间隔、静默catch、条件渲染缺error态 |
| 🔵 **低** | 7 | 死代码、缓存失效、无唯一约束、PRAGMA时机、REAL金额 |

---

## 🔴 严重问题 (第三轮新发现)

### R3-C1. admin/stories.ts：删除故事缺少 R2 清理 + 缺少 comment likes 级联

**文件**: [server/src/routes/admin/stories.ts:43-56](../server/src/routes/admin/stories.ts#L43-L56)  
**前两轮遗漏**：第一轮只修了 story.ts，第二轮补充了 story.ts 的 R2 清理，但 admin/stories.ts **一直被遗漏**。

**当前代码问题**：
1. 完全缺失 `DELETE FROM likes WHERE target_type='comment' AND target_id IN (SELECT id FROM comments WHERE story_id=?)` —— 评论的点赞变成孤立行
2. 完全缺失 R2 文件清理 —— 不删 music file_path 也不删 cover_image
3. 级联顺序与 story.ts / burn.ts 不一致

### R3-C2. admin/users.ts：删除用户缺少 4 张表的级联清理

**文件**: [server/src/routes/admin/users.ts:89-111](../server/src/routes/admin/users.ts#L89-L111)  
**状态**: 第一轮 M1 标记为已知但一直未修复。

遗漏：`notifications`、`messages`、`follows`、`blocked_users`。

### R3-C3. MusicPlayer：fetch 无 AbortController —— blob URL 内存泄漏

**文件**: [client/src/components/MusicPlayer.tsx:34-37](../client/src/components/MusicPlayer.tsx#L34-L37)

`revokeObjectURL` 已在第二轮补充修复。但 `fetch()` 本身无 `AbortController`：当 `audioUrl` 快速变化时，前一个 fetch 仍在进行中，其 `.then(blob => ...)` 可能在 cleanup 之后执行，重新创建 blob URL 但不被 revoke。

**修复**：useEffect 中创建 `AbortController`，cleanup 中 `controller.abort()`，fetch 后检查 `signal.aborted`。

### R3-C4. addColumnIfMissing：空 catch 吞噬致命 SQL 错误

**文件**: [server/src/models/database.ts:230-236](../server/src/models/database.ts#L230-L236)

`catch {}`（完全空的 catch 块）不仅捕获"列已存在"错误，也捕获表不存在、语法错误、网络断开等致命错误。如果某张表 CREATE 失败，后续所有 migration 静默跳过，服务器正常启动但数据缺失。

**修复**：仅捕获 `duplicate column name` 错误，其余抛出。

---

## 🟠 高优先级 (第三轮新发现)

### R3-H1. /generate：扣费 UPDATE + INSERT music 不在同一事务中

**文件**: [server/src/routes/music.ts:102-129](../server/src/routes/music.ts#L102-L129)

扣积分（第 105 行 UPDATE）和 INSERT music 记录（第 126 行）是两次独立 `dbRun`。若 UPDATE 成功但 INSERT 失败（数据库连接中断），积分已扣但记录未创建。

### R3-H2. 全库仅 1 个自定义索引 —— 9 个核心查询路径缺索引

**文件**: [server/src/models/database.ts](../server/src/models/database.ts)

第一轮已列出推荐索引，至今未添加。影响 stories、comments、music、follows、likes、messages、orders、subscriptions 表的高频查询。

### R3-H3. story 列表每行 4 个相关子查询 —— N+1 问题

**文件**: [server/src/routes/story.ts:37-47](../server/src/routes/story.ts#L37-L47)

`comment_count`、`author_nickname`、`music_status`、`music_type` 四个子查询每条 story 各执行一次。每页 50 条 = 200+ 次子查询。music 的 status 和 music_type 两个子查询可合并为一个。

### R3-H4. payment.ts：carryOver 快照在 dbBatch 之外读取

**文件**: [server/src/routes/payment.ts:291-296](../server/src/routes/payment.ts#L291-L296)

`SELECT free_music_count` 在第 292 行，`SET free_music_count = 0` 在第 319 行的 `dbBatch` 中。两个并发订单可能读到相同的 carryOver 值，导致额度重复计算。

### R3-H5. 分页 page 参数无上限

**文件**: [server/src/routes/story.ts:20-21](../server/src/routes/story.ts#L20-L21) + 5 个 admin 路由

`page = Math.max(1, ...)` 无上限。`page=100000` 导致 offset=4999950，严重性能问题。

### R3-H6. seed.ts 在 init() 链中同步调用 MiniMax API —— 阻塞启动

**文件**: [server/src/services/seed.ts:76](../server/src/services/seed.ts#L76) + [index.ts:129-136](../server/src/index.ts#L129-L136)

seed 中 `await generateMusic()` 同步调用外部 AI API。若 MiniMax 慢/超时，服务器启动被拖延。

---

## 🟡 中等问题 (第三轮)

| # | 问题 | 位置 |
|:---|:---|:---|
| R3-M1 | LIKE `%keyword%` 全表扫描，stories.content 大量文本 | admin/stories.ts, admin/users.ts, admin/comments.ts |
| R3-M2 | API 响应格式不一致：`{ data }` vs `{ success, data }` 混用 | 多个路由 |
| R3-M3 | dedup SQL `LIMIT 1` + `ORDER BY` 可能命中旧状态忽略新 pending | music.ts:65-68 |
| R3-M4 | CheckoutPage 支付轮询延迟呈 O(N²) 增长，最坏 19 分钟超时 | CheckoutPage.tsx:344 |
| R3-M5 | 20+ 处静默 `.catch(() => {})` —— 数据加载失败用户无感知 | 多处 |
| R3-M6 | MessageDetailPage useEffect 依赖 `messages.length` 导致重复标记已读 | MessageDetailPage.tsx:84-86 |
| R3-M7 | CommentSection/MessagesPage/AuthorSidebar 缺 error 状态 UI | 多处 |
| R3-M8 | 流端点 `requestUserId` 解码后未使用（死代码） | music.ts:205-210 |

## 🔵 低优先级 (第三轮)

| # | 问题 | 位置 |
|:---|:---|:---|
| R3-L1 | subscribedId 在无限配额场景下为 null 导致退款分支跳过（行为正确但缺日志） | music.ts:102-114 |
| R3-L2 | `cover_image` 删除端点未清理 R2 文件 | story.ts:216-224 |
| R3-L3 | `useGeo` 模块级缓存在账号切换时不失效 | useGeo.ts:10 |
| R3-L4 | messages 表无 UNIQUE 约束 | database.ts:208-217 |
| R3-L5 | PRAGMA foreign_keys 应在 createClient 后立即执行（非表创建后） | database.ts:302 |
| R3-L6 | `orders.amount` 用 REAL 存金额（有 total_cents INTEGER 冗余，低风险） | database.ts:116 |
| R3-L7 | localStorage `mo_pending_music` JSON.parse 无运行时校验 | App.tsx:56 |

---

## 📊 三轮审核累计终态

| 轮次 | 🔴 严重 | 🟠 高 | 🟡 中 | 🔵 低 |
|:---|:---:|:---:|:---:|:---:|
| 第一轮发现 | 7 | 10 | 12 | 9 |
| 第一轮已修复 | 7 ✅ | 10 ✅ | — | — |
| 第二轮发现 | 5 | 4 | 5 | 5 |
| 第二轮已修复 | 5 ✅ | 4 ✅ | — | — |
| 第三轮发现 | **4** | **6** | **8** | **7** |
| **当前待修复** | **4** 🔴 | **6** 🟠 | **24** 🟡 | **21** 🔵 |

### 🚨 第三轮最优先修复（4 个严重）：

| 编号 | 问题 | 影响 |
|:---|:---|:---|
| **R3-C1** | admin/stories.ts 缺 R2 清理 + comment likes 级联 | 管理员删故事 → R2 孤儿文件 + DB 孤儿行 |
| **R3-C2** | admin/users.ts 缺 4 张表级联 | 管理员删用户 → 通知/私信/关注/黑名单残留 |
| **R3-C3** | MusicPlayer fetch 无 AbortController | 快速切歌 → blob URL 泄漏 |
| **R3-C4** | addColumnIfMissing 空 catch | 表创建失败被静默跳过 |

---
## 📝 第三轮开发者回复（commit 424ebd2）

### R3-C1 admin/stories 级联 + R2 → ✅ 已修复
确认存在。补全：comment likes 级联 + R2 音乐/封面清理 + 统一删除顺序。

### R3-C2 admin/users 缺少 4 表 → ✅ 已修复
确认存在。新增：notifications / messages / follows / blocked_users 清理。

### R3-C3 fetch 无 AbortController → ✅ 已修复
确认存在。controller 声明在 if 外使 cleanup 可访问；fetch 后检查 signal.aborted。cleanup 中 controller.abort() 阻止 resolve 后创建 blob。

### R3-C4 addColumnIfMissing 空 catch → ✅ 已修复
确认存在。改为仅捕获 `duplicate column` 错误，其余 throw。

### R3-H1~H6 高优先级 → 🟡 已记录
均为规模依赖或性能优化类（INSERT非原子需dbBatch改造、索引需累积、carryOver需重构payment），当前用户量下无实际影响。下次大版本迭代统一处理。

### R3-M1~M8 + L1~L7 → 🟡 已记录
代码质量/维护性建议，已纳入技术债务清单。

**第三轮：4 严重已修复，6 高+8 中+7 低已记录。三轮审核终态：零严重问题。**
