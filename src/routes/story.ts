import { Router, Request, Response } from 'express';
import { getDatabase } from '../models/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { detectLanguage } from '../services/language.js';
import { lookupGeo } from '../services/geoip.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const db = getDatabase();
  const language = req.query.language as string | undefined;
  const countryCode = req.query.countryCode as string | undefined;

  const baseQuery = `SELECT s.*, COUNT(c.id) as comment_count
     FROM stories s
     LEFT JOIN burned_stories bs ON s.id = bs.story_id
     LEFT JOIN comments c ON s.id = c.story_id
     WHERE bs.story_id IS NULL`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (language) {
    conditions.push('s.language = ?');
    params.push(language);
  }

  if (countryCode) {
    conditions.push('(s.country_code = ? OR s.country_code IS NULL)');
    params.push(countryCode);
  }

  const whereClause = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
  const query = baseQuery + whereClause + ' GROUP BY s.id ORDER BY (s.like_count + COUNT(c.id) * 2) DESC, s.created_at DESC';

  let stories = db.prepare(query).all(...params);

  if (stories.length === 0 && countryCode) {
    stories = db.prepare(baseQuery + ' AND s.user_id IS NULL GROUP BY s.id ORDER BY (s.like_count + COUNT(c.id) * 2) DESC, s.created_at DESC').all();
  }

  res.json({ data: stories });
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }
  res.json({ data: story });
});

router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { title, content, metadata } = req.body;
    const userId = req.userId;

    console.log('[Story] Create request — userId:', userId, 'title:', title, 'content length:', content?.length);

    if (!title || !content) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    const db = getDatabase();
    const language = detectLanguage(content);
    console.log('[Story] Detected language:', language);

    const ip = req.headers['x-forwarded-for'] as string || req.ip || '127.0.0.1';
    const clientIp = ip.split(',')[0].trim();
    const geo = lookupGeo(clientIp);
    const countryCode = geo.countryCode || null;
    console.log('[Story] Country code:', countryCode);

    const result = db.prepare(
      'INSERT INTO stories (user_id, title, content, metadata, language, country_code) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId || null, title, content, metadata || null, language, countryCode);

    console.log('[Story] Created story id:', Number(result.lastInsertRowid));

    res.status(201).json({
      data: {
        id: Number(result.lastInsertRowid),
        userId: userId || null,
        title,
        content,
        metadata,
      },
    });
  } catch (err) {
    console.error('[Story] Create error:', err);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

router.put('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const { title, content, metadata } = req.body;
  const db = getDatabase();

  const story = db.prepare('SELECT user_id FROM stories WHERE id = ?').get(req.params.id) as { user_id: number | null } | undefined;
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }
  if (story.user_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const result = db.prepare(
    'UPDATE stories SET title = ?, content = ?, metadata = ? WHERE id = ?'
  ).run(title, content, metadata || null, req.params.id);

  res.json({ data: { id: req.params.id, title, content, metadata } });
});

router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDatabase();

  const story = db.prepare('SELECT user_id FROM stories WHERE id = ?').get(req.params.id) as { user_id: number | null } | undefined;
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }
  if (story.user_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const result = db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
  res.json({ message: 'Story deleted successfully' });
});

export default router;
