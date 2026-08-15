import { Router, Response } from 'express';
import { dbGet, dbAll, dbBatch } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { deleteFromR2 } from '../services/r2.js';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const BURNED_CONTENT = '悲伤往事，没入尘烟，万载空悠，徒留悲伤';
const MEMORIAL_COMMENT = '曾经来过的足迹，已入尘烟！';

router.post('/stories/:id/burn', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const storyId = parseInt(req.params.id, 10);

  const story = await dbGet<{ id: number; user_id: number | null; cover_image: string | null }>(
    'SELECT id, user_id, cover_image FROM stories WHERE id = ?', [storyId]
  );
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  if (story.user_id !== req.userId) { res.status(403).json({ error: 'You can only burn your own stories' }); return; }

  const existingBurned = await dbGet('SELECT id FROM burned_stories WHERE story_id = ?', [storyId]);
  if (existingBurned) { res.status(400).json({ error: 'Story already burned' }); return; }

  // ── 1. Delete R2 files (music + cover) — fire-and-forget, best effort ──
  const musicRecords = await dbAll<{ file_path: string }>(
    'SELECT file_path FROM music WHERE story_id = ? AND file_path IS NOT NULL', [storyId]
  );
  for (const m of musicRecords) {
    deleteFromR2(m.file_path).catch(err => console.error('[Burn] R2 music delete failed:', err instanceof Error ? err.message : err));
  }
  if (story.cover_image) {
    deleteFromR2(story.cover_image).catch(err => console.error('[Burn] R2 cover delete failed:', err instanceof Error ? err.message : err));
  }

  // ── 2. Keep one memorial comment, then clean up DB ──
  const firstComment = await dbGet<{ id: number }>(
    'SELECT id FROM comments WHERE story_id = ? ORDER BY created_at ASC LIMIT 1', [storyId]
  );

  // ── 3. Execute the WHOLE burn atomically as a single transaction ──
  // 保留「纪念墓碑」：故事内容替换为诗句、封面清空；音乐/评论/点赞等从数据库清理。
  const stmts: { sql: string; args: unknown[] }[] = [
    // 清理指向该故事的悬空通知
    { sql: "DELETE FROM notifications WHERE type IN ('new_story','comment_story','like_story') AND source_id = ?", args: [storyId] },
    // 评论点赞
    { sql: "DELETE FROM likes WHERE target_type = ? AND EXISTS (SELECT 1 FROM comments c WHERE c.id = likes.target_id AND c.story_id = ?)", args: ['comment', storyId] },
    // 删除除第一条外的所有评论
    { sql: 'DELETE FROM comments WHERE story_id = ? AND id != ?', args: [storyId, firstComment?.id ?? 0] },
    // 故事点赞
    { sql: "DELETE FROM likes WHERE target_type = 'story' AND target_id = ?", args: [storyId] },
    // 音乐使用记录
    { sql: 'DELETE FROM music_usage WHERE story_id = ?', args: [storyId] },
    // 音乐记录
    { sql: 'DELETE FROM music WHERE story_id = ?', args: [storyId] },
    // 内容替换为诗句、清空封面（故事行保留，作为纪念墓碑）
    { sql: 'UPDATE stories SET content = ?, cover_image = NULL, cover_prompt = NULL WHERE id = ?', args: [BURNED_CONTENT, storyId] },
    // 焚烧标记
    { sql: 'INSERT INTO burned_stories (story_id) VALUES (?)', args: [storyId] },
  ];

  if (firstComment) {
    stmts.push({
      sql: 'UPDATE comments SET content = ?, author_name = ?, is_hidden = 0 WHERE id = ?',
      args: [MEMORIAL_COMMENT, '岁月', firstComment.id],
    });
  } else {
    stmts.push({
      sql: "INSERT INTO comments (story_id, author_name, content) VALUES (?, '岁月', ?)",
      args: [storyId, MEMORIAL_COMMENT],
    });
  }

  try {
    await dbBatch(stmts);
  } catch (err) {
    console.error('[Burn] dbBatch failed for story', storyId, ':', err instanceof Error ? err.message : err);
    throw err;
  }

  res.json({ success: true, data: { id: storyId, isBurned: true } });
}));

export default router;