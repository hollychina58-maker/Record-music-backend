import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMusic, analyzeEmotion, MOOD_LABELS } from '../services/minimax.js';
import type { MusicOptions } from '../services/minimax.js';
import { getDatabase } from '../models/database.js';
import path from 'path';
import fs from 'fs';

const router = Router();

// Credits are locked BEFORE async generation to prevent TOCTOU race conditions.
// On failure the credit is refunded.
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

    // Store the CDN URL directly — no local download, works on ephemeral filesystems
    db.transaction(() => {
      db.prepare("UPDATE music SET status = 'completed', file_path = ? WHERE id = ?")
        .run(result.audioUrl, musicId);
      db.prepare('INSERT INTO music_usage (user_id, story_id, music_id) VALUES (?, ?, ?)')
        .run(userId, storyId, musicId);
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    console.error('[Music] Async generation failed:', message);
    db.prepare("UPDATE music SET status = 'failed' WHERE id = ?").run(musicId);

    // Refund credit — it was locked upfront
    if (isSubscription && subscriptionId) {
      db.prepare(
        'UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ?'
      ).run(subscriptionId);
    } else if (!isSubscription) {
      db.prepare(
        'UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?'
      ).run(userId);
    }
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
    const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }

    const userId = req.userId as number;

    const subscription = db.prepare(
      "SELECT id, music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')"
    ).get(userId) as { id: number; music_remaining: number | null } | undefined;

    // Lock credit atomically before launching async task — prevents concurrent over-use
    let isSubscription = false;
    let subscriptionId: number | null = null;

    if (subscription) {
      isSubscription = true;
      subscriptionId = subscription.id;
      if (subscription.music_remaining !== null) {
        const lock = db.prepare(
          'UPDATE subscriptions SET music_remaining = music_remaining - 1 WHERE id = ? AND music_remaining > 0'
        ).run(subscription.id);
        if (lock.changes === 0) {
          res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
          return;
        }
      }
      // Unlimited subscription (yearly, music_remaining IS NULL): no lock needed
    } else {
      const lock = db.prepare(
        'UPDATE users SET free_music_count = free_music_count - 1 WHERE id = ? AND free_music_count > 0'
      ).run(userId);
      if (lock.changes === 0) {
        res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
        return;
      }
    }

    const musicOptions: MusicOptions = { musicType, musicMood, musicGenre };
    const styleLabel = (musicMood && MOOD_LABELS[musicMood])
      ? MOOD_LABELS[musicMood]
      : analyzeEmotion(text).style;

    const musicRecord = db.prepare(
      "INSERT INTO music (story_id, status, style) VALUES (?, 'pending', ?)"
    ).run(storyId, styleLabel);
    const musicId = Number(musicRecord.lastInsertRowid);

    // Fetch updated credit count to return to client
    const subscriptionRemaining = subscription
      ? (db.prepare("SELECT music_remaining FROM subscriptions WHERE id = ?").get(subscriptionId ?? subscription.id) as any)?.music_remaining
      : null;
    const userRow = !subscription
      ? (db.prepare("SELECT free_music_count FROM users WHERE id = ?").get(userId) as any)
      : null;

    processMusicAsync(userId, storyId, musicId, text, musicOptions, isSubscription, subscriptionId);

    res.status(202).json({
      data: {
        musicId,
        status: 'pending',
        subscriptionRemaining: subscriptionRemaining ?? null,
        freeMusicCount: userRow?.free_music_count ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/by-story/:storyId', authMiddleware, (_req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const musicRecords = db.prepare(
    'SELECT id, story_id, status, style, created_at FROM music WHERE story_id = ? ORDER BY created_at DESC'
  ).all(_req.params.storyId);
  res.json({ data: musicRecords });
});

router.get('/status/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDatabase();
    const music = db.prepare(
      'SELECT id, status, file_path, style FROM music WHERE id = ?'
    ).get(req.params.id) as any;

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

router.get('/:id/stream', async (req: Request, res: Response) => {
  // Accept token from Authorization header OR ?token= query param (needed for HTML audio elements)
  const secret = process.env.JWT_SECRET;
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!rawToken || !secret) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    jwt.verify(rawToken, secret);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  try {
    const db = getDatabase();
    const music = db.prepare(
      'SELECT m.*, m.story_id FROM music m WHERE m.id = ?'
    ).get(req.params.id) as any;

    if (!music || !music.file_path) {
      res.status(404).json({ error: 'Music not available' });
      return;
    }

    // Block streaming for burned stories
    const burned = db.prepare('SELECT id FROM burned_stories WHERE story_id = ?').get(music.story_id);
    if (burned) {
      res.status(403).json({ error: 'This story has been burned' });
      return;
    }

    // CDN URL storage — proxy to client to avoid CORS issues
    if (music.file_path.startsWith('http')) {
      const upstream = await axios.get<NodeJS.ReadableStream>(music.file_path, {
        responseType: 'stream',
        timeout: 30000,
      });
      res.setHeader('Content-Type', String(upstream.headers['content-type'] || 'audio/mpeg'));
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', String(upstream.headers['content-length']));
      }
      (upstream.data as NodeJS.ReadableStream).pipe(res);
      return;
    }

    // Legacy: local file (backward compatibility)
    if (!fs.existsSync(music.file_path)) {
      res.status(404).json({ error: 'Music file not available' });
      return;
    }

    // Validate path stays within storage directory to prevent traversal
    const storagePath = path.resolve(process.env.STORAGE_PATH || './storage');
    const resolvedPath = path.resolve(music.file_path);
    if (!resolvedPath.startsWith(storagePath)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const isDownload = req.query.download === '1';
    if (isDownload) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required for download' });
        return;
      }
      try {
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as { userId: number };
        const storyRow = db.prepare(
          'SELECT s.user_id FROM stories s JOIN music m ON m.story_id = s.id WHERE m.id = ?'
        ).get(req.params.id) as { user_id: number | null } | undefined;
        if (!storyRow || storyRow.user_id !== decoded.userId) {
          res.status(403).json({ error: 'Only the author can download this music' });
          return;
        }
      } catch {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(music.file_path)}"`);
    }

    const stat = fs.statSync(music.file_path);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(music.file_path, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(music.file_path).pipe(res);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDatabase();
    const music = db.prepare('SELECT * FROM music WHERE id = ?').get(req.params.id) as any;

    if (!music?.file_path) {
      res.status(404).json({ error: 'Music file not available' });
      return;
    }

    if (music.file_path.startsWith('http')) {
      const storyRow = db.prepare(
        'SELECT s.user_id FROM stories s JOIN music m ON m.story_id = s.id WHERE m.id = ?'
      ).get(req.params.id) as { user_id: number | null } | undefined;
      if (!storyRow || storyRow.user_id !== req.userId) {
        res.status(403).json({ error: 'Only the author can download this music' });
        return;
      }
      res.redirect(302, music.file_path);
      return;
    }

    if (!fs.existsSync(music.file_path)) {
      res.status(404).json({ error: 'Music file not found' });
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(music.file_path)}"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(path.resolve(music.file_path));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
