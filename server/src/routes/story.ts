import { Router, Request, Response } from 'express';
import { dbGet, dbAll, dbRun } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { detectLanguage } from '../services/language.js';
import { lookupGeo } from '../services/geoip.js';
import { analyzeStory } from '../services/storyAnalysis.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const language = req.query.language as string | undefined;
  const countryCode = req.query.countryCode as string | undefined;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['bs.story_id IS NULL'];
  const params: unknown[] = [];

  if (language) { conditions.push('s.language = ?'); params.push(language); }
  if (countryCode) { conditions.push('(s.country_code = ? OR s.country_code IS NULL)'); params.push(countryCode); }

  const where = conditions.join(' AND ');
  let stories = await dbAll<any>(
    `SELECT s.*, COUNT(c.id) as comment_count
     FROM stories s
     LEFT JOIN burned_stories bs ON s.id = bs.story_id
     LEFT JOIN comments c ON s.id = c.story_id
     WHERE ${where}
     GROUP BY s.id ORDER BY (s.like_count + COUNT(c.id) * 2) DESC, s.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  if (stories.length === 0 && countryCode) {
    stories = await dbAll<any>(
      `SELECT s.*, COUNT(c.id) as comment_count
       FROM stories s
       LEFT JOIN burned_stories bs ON s.id = bs.story_id
       LEFT JOIN comments c ON s.id = c.story_id
       WHERE bs.story_id IS NULL AND s.user_id IS NULL
       GROUP BY s.id ORDER BY (s.like_count + COUNT(c.id) * 2) DESC, s.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  const parsed = stories.map((s: any) => ({
    ...s,
    tags: s.tags ? (() => { try { return JSON.parse(s.tags); } catch { return []; } })() : null,
  }));
  res.json({ data: parsed, meta: { page, limit } });
});

router.get('/:id', async (req: Request, res: Response) => {
  const story = await dbGet<any>('SELECT * FROM stories WHERE id = ?', [req.params.id]);
  if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
  const tags = story.tags ? (() => { try { return JSON.parse(story.tags); } catch { return []; } })() : null;
  res.json({ data: { ...story, tags } });
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

  await dbRun('DELETE FROM stories WHERE id = ?', [req.params.id]);
  res.json({ message: 'Story deleted successfully' });
});

export default router;
