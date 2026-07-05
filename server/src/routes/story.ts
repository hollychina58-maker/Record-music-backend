import { Router, Request, Response } from 'express';
import { dbGet, dbAll, dbRun, dbBatch } from '../models/database.js';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';
import { detectLanguage } from '../services/language.js';
import { lookupGeo } from '../services/geoip.js';
import { generateCoverImage, buildCoverPrompt } from '../services/minimax.js';
import { uploadToR2, deleteFromR2 } from '../services/r2.js';
import { analyzeStory } from '../services/storyAnalysis.js';

const router = Router();

function parseTags(raw: string | null): string[] | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return []; }
}

router.get('/', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  const countryCode = req.query.countryCode as string | undefined;
  const onlyMine = req.query.onlyMine === 'true';
  const tab = req.query.tab as string | undefined;  // 'following' = stories from followed authors
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['bs.story_id IS NULL'];
  const params: unknown[] = [];

  if (onlyMine && req.userId) {
    conditions.push('s.user_id = ?');
    params.push(req.userId);
  } else if (tab === 'following' && req.userId) {
    conditions.push('s.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)');
    params.push(req.userId);
  }
  // Note: countryCode filtering removed — on a small platform it hides too many stories.
  // Revisit when there are 1000+ stories per region.

  const where = conditions.join(' AND ');

  // Use subqueries instead of JOINs + GROUP BY — avoids Turso/libsql row-dropping issues
  const storyQuery = `
    SELECT s.*,
           (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comment_count,
           (SELECT nickname FROM users WHERE id = s.user_id) as author_nickname,
           (SELECT status FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_status,
           (SELECT music_type FROM music WHERE story_id = s.id ORDER BY created_at DESC LIMIT 1) as music_type
    FROM stories s
    LEFT JOIN burned_stories bs ON s.id = bs.story_id
    WHERE ${where}
    ORDER BY s.like_count DESC, s.created_at DESC
    LIMIT ? OFFSET ?`;

  const stories = await dbAll<any>(storyQuery, [...params, limit, offset]);

  // Total count for pagination UI
  const countResult = await dbGet<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM stories s LEFT JOIN burned_stories bs ON s.id = bs.story_id WHERE ${where}`,
    params
  );
  const total = countResult?.cnt ?? 0;

  const parsed = stories.map((s: any) => ({
    ...s,
    tags: parseTags(s.tags),
  }));
  res.json({ data: parsed, meta: { page, limit, total } });
});

router.get('/:id', async (req: Request, res: Response) => {
  const story = await dbGet<any>(
    `SELECT s.*, u.nickname as author_nickname,
            CASE WHEN bs.story_id IS NOT NULL THEN 1 ELSE 0 END as isBurned
     FROM stories s
     LEFT JOIN users u ON s.user_id = u.id
     LEFT JOIN burned_stories bs ON s.id = bs.story_id
     WHERE s.id = ?`,
    [req.params.id]
  );
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  res.json({ data: { ...story, tags: parseTags(story.tags), isBurned: !!story.isBurned } });
});

router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, metadata } = req.body;
    if (!title || !content) { res.status(400).json({ error: 'title and content are required' }); return; }

    const language = detectLanguage(content);
    const ip = (req.headers['x-forwarded-for'] as string || req.ip || '127.0.0.1').split(',')[0].trim();
    const countryCode = lookupGeo(ip).countryCode || null;

    const result = await dbRun(
      'INSERT INTO stories (user_id, title, content, metadata, language, country_code) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId || null, title, content, metadata || null, language, countryCode]
    );
    const storyId = result.lastInsertRowid;

    // AI story analysis: extract tone and tags (runs synchronously so response includes them)
    const { tone, tags } = await analyzeStory(content).catch(() => ({ tone: null as string | null, tags: [] as string[] }));
    if (tone || tags.length > 0) {
      await dbRun('UPDATE stories SET tone = ?, tags = ? WHERE id = ?', [tone, JSON.stringify(tags), storyId]);
    }

    res.status(201).json({
      data: { id: storyId, userId: req.userId || null, title, content, metadata, tone, tags },
    });

    // Async: create notifications for followers
    const authorId = req.userId;
    if (authorId) {
      setImmediate(async () => {
        try {
          const followers = await dbAll<{ follower_id: number }>(
            'SELECT follower_id FROM follows WHERE followed_id = ?', [authorId]
          );
          if (followers.length === 0) return;
          const BATCH = 200;
          for (let i = 0; i < followers.length; i += BATCH) {
            const batch = followers.slice(i, i + BATCH).map(f => ({
              sql: 'INSERT OR IGNORE INTO notifications (user_id, type, source_id, actor_id) VALUES (?, ?, ?, ?)',
              args: [f.follower_id, 'new_story', storyId, authorId],
            }));
            await dbBatch(batch);
          }
          console.log(`[Story] Created ${followers.length} notifications for story ${storyId}`);
        } catch (e) {
          console.error('[Story] Failed to create notifications:', e);
        }
      });
    }
  } catch (err) {
    console.error('[Story] Create error:', err);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { title, content, metadata } = req.body;
  if (!title || !content) { res.status(400).json({ error: 'title and content are required' }); return; }

  const story = await dbGet<{ user_id: number | null }>('SELECT user_id FROM stories WHERE id = ?', [req.params.id]);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  if (story.user_id !== req.userId) { res.status(403).json({ error: 'Not authorized' }); return; }

  await dbRun('UPDATE stories SET title = ?, content = ?, metadata = ? WHERE id = ?',
    [title, content, metadata || null, req.params.id]);
  res.json({ data: { id: req.params.id, title, content, metadata } });
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const story = await dbGet<{ user_id: number | null }>('SELECT user_id FROM stories WHERE id = ?', [req.params.id]);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  if (story.user_id !== req.userId) { res.status(403).json({ error: 'Not authorized' }); return; }

  // Cascade cleanup — match admin/stories.ts pattern + R2 cleanup
  const id = parseInt(req.params.id, 10);

  // Delete R2 files before DB records (need file_path from music/cover before deletion)
  const musicFiles = await dbAll<{ file_path: string }>(
    'SELECT file_path FROM music WHERE story_id = ? AND file_path IS NOT NULL', [id]
  );
  for (const m of musicFiles) {
    deleteFromR2(m.file_path).catch(err => console.error('[Story Delete] R2 music delete failed:', err));
  }
  const storyRow = await dbGet<{ cover_image: string | null }>(
    'SELECT cover_image FROM stories WHERE id = ?', [id]
  );
  if (storyRow?.cover_image) {
    deleteFromR2(storyRow.cover_image).catch(err => console.error('[Story Delete] R2 cover delete failed:', err));
  }

  // DB cascade
  await dbRun('DELETE FROM likes WHERE target_type = ? AND target_id IN (SELECT id FROM comments WHERE story_id = ?)', ['comment', id]);
  await dbRun('DELETE FROM comments WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM likes WHERE target_type = ? AND target_id = ?', ['story', id]);
  await dbRun('DELETE FROM music_usage WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM music WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM burned_stories WHERE story_id = ?', [id]);
  await dbRun('DELETE FROM stories WHERE id = ?', [id]);
  res.json({ message: 'Story deleted successfully' });
});

// Async cover image generation helper
async function processCoverAsync(storyId: number, text: string, tone: string | null, tags: string[] | null) {
  try {
    const prompt = buildCoverPrompt(tone, tags, text);
    await dbRun('UPDATE stories SET cover_prompt = ? WHERE id = ?', [prompt, storyId]);

    const result = await generateCoverImage(prompt);
    // Upload to R2 for permanent storage (MiniMax image URL expires)
    const bucketKey = `covers/${storyId}_${Date.now()}.png`;
    const permanentUrl = await uploadToR2(result.imageUrl, bucketKey, 'image/png');
    await dbRun('UPDATE stories SET cover_image = ? WHERE id = ?', [permanentUrl, storyId]);
    console.log('[Cover] Image generated for story', storyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    console.error('[Cover] Generation failed for story', storyId, ':', message);
    // Set prompt as null on failure so user can retry
    await dbRun('UPDATE stories SET cover_prompt = NULL WHERE id = ?', [storyId]);
  }
}

// Generate cover image for a story (async)
router.post('/:id/generate-cover', authMiddleware, async (req: AuthRequest, res: Response) => {
  const story = await dbGet<{ id: number; user_id: number | null; content: string; tone: string | null; tags: string | null }>(
    'SELECT id, user_id, content, tone, tags FROM stories WHERE id = ?', [req.params.id]
  );
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  if (story.user_id !== req.userId) { res.status(403).json({ error: 'Not authorized' }); return; }

  const tags: string[] | null = story.tags ? (() => { try { return JSON.parse(story.tags); } catch { return null; } })() : null;

  // Fire-and-forget async generation
  processCoverAsync(story.id, story.content, story.tone, tags);

  res.status(202).json({ data: { coverStatus: 'pending' } });
});

// Delete cover image (author only)
router.delete('/:id/cover', authMiddleware, async (req: AuthRequest, res: Response) => {
  const story = await dbGet<{ user_id: number | null }>(
    'SELECT user_id FROM stories WHERE id = ?', [req.params.id]
  );
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  if (story.user_id !== req.userId) { res.status(403).json({ error: 'Not authorized' }); return; }

  await dbRun('UPDATE stories SET cover_image = NULL, cover_prompt = NULL WHERE id = ?', [req.params.id]);
  res.json({ message: 'Cover image deleted' });
});

export default router;
