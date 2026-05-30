import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMusic, downloadMusicFile, analyzeEmotion, MOOD_LABELS } from '../services/minimax.js';
import type { MusicOptions } from '../services/minimax.js';
import { getDatabase } from '../models/database.js';
import path from 'path';
import fs from 'fs';

const router = Router();

// Fire-and-forget async music generation (credits deducted only on success)
async function processMusicAsync(
  userId: number,
  storyId: number,
  musicId: number,
  text: string,
  musicOptions: MusicOptions,
  isSubscription: boolean,
  subscriptionId: number | null,
) {
  const db = getDatabase();
  try {
    const result = await generateMusic(text, musicOptions);
    const filePath = await downloadMusicFile(result.audioUrl, storyId);

    db.transaction(() => {
      // Deduct credits only after successful generation
      if (isSubscription && subscriptionId) {
        db.prepare(
          'UPDATE subscriptions SET music_remaining = music_remaining - 1 WHERE id = ? AND music_remaining > 0'
        ).run(subscriptionId);
      } else if (!isSubscription) {
        db.prepare(
          'UPDATE users SET free_music_count = free_music_count - 1 WHERE id = ? AND free_music_count > 0'
        ).run(userId);
      }

      db.prepare(
        'UPDATE music SET status = ?, file_path = ? WHERE id = ?'
      ).run('completed', filePath, musicId);

      db.prepare(
        'INSERT INTO music_usage (user_id, story_id, music_id) VALUES (?, ?, ?)'
      ).run(userId, storyId, musicId);
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    console.error('[Music] Async generation failed:', message);
    db.prepare("UPDATE music SET status = 'failed' WHERE id = ?").run(musicId);
  }
}

router.post('/generate', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { storyId, text, musicType, musicMood, musicGenre } = req.body;

    if (!storyId || !text) {
      res.status(400).json({ error: 'storyId and text are required' });
      return;
    }

    const db = getDatabase();
    const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(storyId) as any;

    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    const userId = req.userId as number;

    const user = db.prepare(
      'SELECT free_music_count FROM users WHERE id = ?'
    ).get(userId) as { free_music_count: number } | undefined;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const subscription = db.prepare(
      "SELECT id, music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')"
    ).get(userId) as { id: number; music_remaining: number | null } | undefined;

    const hasCredits = subscription
      ? (subscription.music_remaining === null || subscription.music_remaining > 0)
      : user.free_music_count > 0;

    if (!hasCredits) {
      res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
      return;
    }

    const musicOptions: MusicOptions = { musicType, musicMood, musicGenre };

    let styleLabel: string;
    if (musicMood && MOOD_LABELS[musicMood]) {
      styleLabel = MOOD_LABELS[musicMood];
    } else {
      const detected = analyzeEmotion(text);
      styleLabel = detected.style;
    }

    const musicRecord = db.prepare(
      "INSERT INTO music (story_id, status, style) VALUES (?, 'pending', ?)"
    ).run(storyId, styleLabel);

    const musicId = Number(musicRecord.lastInsertRowid);
    const isSubscription = !!subscription;
    const subscriptionId = subscription?.id ?? null;

    // Fire-and-forget: credits deducted only on successful generation
    processMusicAsync(userId, storyId, musicId, text, musicOptions, isSubscription, subscriptionId);

    res.status(202).json({
      data: { musicId, status: 'pending' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/by-story/:storyId', (req: Request, res: Response) => {
  const db = getDatabase();
  const musicRecords = db.prepare(
    'SELECT * FROM music WHERE story_id = ? ORDER BY created_at DESC'
  ).all(req.params.storyId);

  res.json({ data: musicRecords });
});

router.get('/status/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const music = db.prepare('SELECT id, status, file_path, style FROM music WHERE id = ?').get(req.params.id) as any;

    if (!music) {
      res.status(404).json({ error: 'Music not found' });
      return;
    }

    res.json({ id: music.id, status: music.status, filePath: music.file_path, style: music.style });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDatabase();
    const music = db.prepare('SELECT * FROM music WHERE id = ?').get(req.params.id) as any;

    if (!music) {
      res.status(404).json({ error: 'Music not found' });
      return;
    }

    res.json({ data: music });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/:id/stream', async (req: AuthRequest, res: Response) => {
  try {
    const db = getDatabase();
    const music = db.prepare('SELECT * FROM music WHERE id = ?').get(req.params.id) as any;

    console.log('[Stream] Request for music id:', req.params.id);
    console.log('[Stream] Origin:', req.headers.origin || '(none)');
    console.log('[Stream] Range:', req.headers.range || '(none)');
    console.log('[Stream] Download mode:', req.query.download === '1');

    if (!music) {
      console.log('[Stream] Music record not found in DB');
      res.status(404).json({ error: 'Music file not available' });
      return;
    }

    console.log('[Stream] file_path:', music.file_path);
    console.log('[Stream] File exists:', fs.existsSync(music.file_path));

    if (!music.file_path || !fs.existsSync(music.file_path)) {
      console.log('[Stream] File missing on disk');
      res.status(404).json({ error: 'Music file not available' });
      return;
    }

    const stat = fs.statSync(music.file_path);
    console.log('[Stream] File size:', stat.size, 'bytes');
    const range = req.headers.range;
    const isDownload = req.query.download === '1';

    if (isDownload) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required for download' });
        return;
      }

      let tokenUserId: number;
      try {
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as { userId: number };
        tokenUserId = decoded.userId;
      } catch {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      const story = db.prepare(
        'SELECT s.user_id FROM stories s JOIN music m ON m.story_id = s.id WHERE m.id = ?'
      ).get(req.params.id) as { user_id: number | null } | undefined;

      if (!story || story.user_id !== tokenUserId) {
        res.status(403).json({ error: 'Only the author can download this music' });
        return;
      }

      const fileName = path.basename(music.file_path);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      console.log('[Stream] Range response: bytes', start, '-', end, '/', stat.size);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', 'audio/mpeg');
      fs.createReadStream(music.file_path, { start, end }).pipe(res);
    } else {
      console.log('[Stream] Full file response, size:', stat.size);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(music.file_path).pipe(res);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stream] Error:', message);
    res.status(500).json({ error: message });
  }
});

router.get('/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDatabase();
    const music = db.prepare('SELECT * FROM music WHERE id = ?').get(req.params.id) as any;

    if (!music) {
      res.status(404).json({ error: 'Music not found' });
      return;
    }

    if (!music.file_path) {
      res.status(404).json({ error: 'Music file not available yet' });
      return;
    }

    if (!fs.existsSync(music.file_path)) {
      res.status(404).json({ error: 'Music file not found on disk' });
      return;
    }

    const fileName = path.basename(music.file_path);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(music.file_path);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
