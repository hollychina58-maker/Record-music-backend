import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMusic, analyzeEmotion, MOOD_LABELS } from '../services/minimax.js';
import type { MusicOptions } from '../services/minimax.js';
import { extractLyrics } from '../services/storyAnalysis.js';
import { dbGet, dbAll, dbRun, dbBatch } from '../models/database.js';
import path from 'path';
import fs from 'fs';

const router = Router();

async function processMusicAsync(
  userId: number,
  storyId: number,
  musicId: number,
  text: string,
  musicOptions: MusicOptions,
  isSubscription: boolean,
  subscriptionId: number | null,
) {
  try {
    const result = await generateMusic(text, musicOptions);
    await dbBatch([
      { sql: "UPDATE music SET status = 'completed', file_path = ? WHERE id = ?", args: [result.audioUrl, musicId] },
      { sql: 'INSERT INTO music_usage (user_id, story_id, music_id) VALUES (?, ?, ?)', args: [userId, storyId, musicId] },
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    console.error('[Music] Async generation failed:', message);
    await dbRun("UPDATE music SET status = 'failed' WHERE id = ?", [musicId]);
    if (isSubscription && subscriptionId) {
      await dbRun('UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ?', [subscriptionId]);
    } else if (!isSubscription) {
      await dbRun('UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?', [userId]);
    }
  }
}

router.post('/generate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // lyricsMode: 'story_as_lyrics' → use story text directly as lyrics (author wrote it as lyrics)
    //             'ai_generated' (default) → AI extracts lyrics from story narrative
    const { storyId, text, musicType, musicMood, musicGenre, lyricsMode } = req.body;
    if (!storyId || !text) { res.status(400).json({ error: 'storyId and text are required' }); return; }

    const story = await dbGet<{ id: number; tone: string | null }>('SELECT id, tone FROM stories WHERE id = ?', [storyId]);
    if (!story) { res.status(404).json({ error: 'Story not found' }); return; }

    const userId = req.userId as number;
    const subscription = await dbGet<{ id: number; music_remaining: number | null }>(
      "SELECT id, music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
      [userId]
    );

    let isSubscription = false;
    let subscriptionId: number | null = null;

    if (subscription) {
      isSubscription = true;
      subscriptionId = subscription.id;
      if (subscription.music_remaining !== null) {
        const lock = await dbRun(
          'UPDATE subscriptions SET music_remaining = music_remaining - 1 WHERE id = ? AND music_remaining > 0',
          [subscription.id]
        );
        if (lock.changes === 0) {
          res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
          return;
        }
      }
    } else {
      const lock = await dbRun(
        'UPDATE users SET free_music_count = free_music_count - 1 WHERE id = ? AND free_music_count > 0',
        [userId]
      );
      if (lock.changes === 0) {
        res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
        return;
      }
    }

    // AI tone from story analysis takes priority over client-supplied musicMood
    const effectiveMood = story.tone || musicMood || undefined;
    const musicOptions: MusicOptions = { musicType, musicMood: effectiveMood, musicGenre };
    const styleLabel = (effectiveMood && MOOD_LABELS[effectiveMood]) ? MOOD_LABELS[effectiveMood] : analyzeEmotion(text).style;

    // Determine lyrics text for song mode
    let effectiveText = text;
    if (musicType === 'song') {
      if (lyricsMode === 'story_as_lyrics') {
        // Author explicitly wrote story as lyrics — use directly (truncate if too long)
        effectiveText = text.slice(0, 400);
        console.log('[Music] Song mode: using story text as direct lyrics, length:', effectiveText.length);
      } else {
        // AI rewrites narrative into proper verse+chorus lyrics
        effectiveText = await extractLyrics(text, effectiveMood || 'peace').catch(() => text.slice(0, 200));
        console.log('[Music] Song mode: AI-extracted lyrics length:', effectiveText.length);
      }
    }

    // Persist generation params so URL can be refreshed later if the CDN link expires
    const generationParams = JSON.stringify({ effectiveText, musicOptions, lyricsMode: lyricsMode || 'ai_generated' });

    // Dedup: check BEFORE deducting credit — avoid race where we deduct then find existing
    const existing = await dbGet<{ id: number; status: string }>(
      "SELECT id, status FROM music WHERE story_id = ? AND status IN ('pending', 'completed') ORDER BY created_at DESC LIMIT 1",
      [storyId]
    );

    // Only deduct credit when actually creating a new music record
    if (existing) {
      console.log('[Music] Reusing existing music record', existing.id, 'status:', existing.status, '— no credit deducted');
    } else {
      // Atomic credit deduction + insert in a batch to avoid race
      if (subscription) {
        subscriptionId = subscription.id;
        if (subscription.music_remaining !== null) {
          const lock = await dbRun(
            'UPDATE subscriptions SET music_remaining = music_remaining - 1 WHERE id = ? AND music_remaining > 0',
            [subscription.id]
          );
          if (lock.changes === 0) {
            res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
            return;
          }
        }
        isSubscription = true;
      } else {
        const lock = await dbRun(
          'UPDATE users SET free_music_count = free_music_count - 1 WHERE id = ? AND free_music_count > 0',
          [userId]
        );
        if (lock.changes === 0) {
          res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
          return;
        }
      }

      // Final re-check after deducting credit — another request may have created the record
      const recheck = await dbGet<{ id: number; status: string }>(
        "SELECT id, status FROM music WHERE story_id = ? AND status IN ('pending', 'completed') ORDER BY created_at DESC LIMIT 1",
        [storyId]
      );
      if (recheck) {
        // Race hit: refund the credit we just deducted and return existing record
        if (isSubscription && subscriptionId) {
          await dbRun('UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ?', [subscriptionId]);
        } else {
          await dbRun('UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?', [userId]);
        }
        res.status(202).json({
          data: {
            musicId: recheck.id,
            status: 'pending',
            subscriptionRemaining: subscription
              ? (await dbGet<{ music_remaining: number | null }>('SELECT music_remaining FROM subscriptions WHERE id = ?', [subscriptionId!]))?.music_remaining
              : null,
            freeMusicCount: !subscription
              ? (await dbGet<{ free_music_count: number }>('SELECT free_music_count FROM users WHERE id = ?', [userId]))?.free_music_count
              : null,
          },
        });
        return;
      }
    }

    const musicRecord = existing
      ? { lastInsertRowid: existing.id }
      : await dbRun(
          "INSERT INTO music (story_id, status, style, music_type, generation_params) VALUES (?, 'pending', ?, ?, ?)",
          [storyId, styleLabel, musicType || 'instrumental', generationParams]
        );
    const musicId = musicRecord.lastInsertRowid as number;

    const subscriptionRemaining = subscription
      ? (await dbGet<{ music_remaining: number | null }>('SELECT music_remaining FROM subscriptions WHERE id = ?', [subscriptionId ?? subscription.id]))?.music_remaining
      : null;
    const userRow = !subscription
      ? await dbGet<{ free_music_count: number }>('SELECT free_music_count FROM users WHERE id = ?', [userId])
      : null;

    // Only trigger async generation for newly created records
    if (!existing) {
      processMusicAsync(userId, storyId, musicId, effectiveText, musicOptions, isSubscription, subscriptionId);
    }

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

router.get('/by-story/:storyId', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  // Return only non-failed music records, newest first.
  const records = await dbAll(
    "SELECT id, story_id, status, style, created_at FROM music WHERE story_id = ? AND status != 'failed' ORDER BY created_at DESC",
    [req.params.storyId]
  );
  res.json({ data: records });
});

router.get('/status/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const music = await dbGet<any>(
    `SELECT m.id, m.status, m.file_path, m.style, s.user_id
     FROM music m JOIN stories s ON m.story_id = s.id WHERE m.id = ?`, [req.params.id]
  );
  if (!music) { res.status(404).json({ error: 'Music not found' }); return; }
  if (music.user_id !== req.userId) { res.status(403).json({ error: 'Access denied' }); return; }
  res.json({ id: music.id, status: music.status, filePath: music.file_path, style: music.style });
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const music = await dbGet<any>(
    `SELECT m.*, s.user_id as story_user_id FROM music m JOIN stories s ON m.story_id = s.id WHERE m.id = ?`,
    [req.params.id]
  );
  if (!music) { res.status(404).json({ error: 'Music not found' }); return; }
  if (music.story_user_id !== req.userId) { res.status(403).json({ error: 'Access denied' }); return; }
  res.json({ data: music });
});

router.get('/:id/stream', async (req: Request, res: Response) => {
  const secret = process.env.JWT_SECRET;
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  // Optional auth — guests can stream public story music too
  let requestUserId: number | null = null;
  if (rawToken && secret) {
    try {
      const decoded = jwt.verify(rawToken, secret) as { userId: number };
      requestUserId = decoded.userId;
    } catch { /* invalid token — treat as guest */ }
  }

  try {
    const music = await dbGet<any>('SELECT m.*, m.story_id FROM music m WHERE m.id = ?', [req.params.id]);
    if (!music?.file_path) { res.status(404).json({ error: 'Music not available' }); return; }

    // Public story music: anyone (including guests) can stream.
    const burned = await dbGet('SELECT id FROM burned_stories WHERE story_id = ?', [music.story_id]);
    if (burned) { res.status(403).json({ error: 'This story has been burned' }); return; }

    if (music.file_path.startsWith('http') || music.file_path.startsWith('__regenerating__')) {
      let streamUrl = music.file_path;

      // Handle stuck sentinel — auto-release after 60s
      if (music.file_path.startsWith('__regenerating__')) {
        const ts = parseInt(music.file_path.split(':')[1] || '0', 10);
        if (Date.now() - ts > 60000) {
          // Sentinel stuck — clear it so this request can regenerate
          await dbRun('UPDATE music SET file_path = NULL WHERE id = ? AND file_path = ?', [music.id, music.file_path]);
          res.status(503).json({ error: 'Music is being regenerated, please retry in a moment' });
          return;
        }
        // Another request is regenerating — wait briefly
        await new Promise(r => setTimeout(r, 2000));
        const refreshed = await dbGet<any>('SELECT file_path FROM music WHERE id = ?', [music.id]);
        if (refreshed?.file_path && !refreshed.file_path.startsWith('__regenerating__') && refreshed.file_path.startsWith('http')) {
          streamUrl = refreshed.file_path;
        } else {
          res.status(503).json({ error: 'Music is being regenerated, please retry in a moment' });
          return;
        }
      }

      // Probe URL — MiniMax CDN links expire after ~24-48h; refresh silently if stale
      if (streamUrl.startsWith('http')) {
        try {
          await axios.head(streamUrl, { timeout: 8000 });
        } catch (probeErr: any) {
          const status = probeErr?.response?.status;
          if (status === 403 || status === 404 || status === 410) {
            const params = music.generation_params ? JSON.parse(music.generation_params) : null;
            if (params) {
              // Optimistic lock with timestamped sentinel — auto-releases after 60s
              const sentinel = `__regenerating__:${Date.now()}`;
              const claimed = await dbRun(
                "UPDATE music SET file_path = ? WHERE id = ? AND file_path = ?",
                [sentinel, music.id, streamUrl]
              );
              if (claimed.changes === 0) {
                // Another request is already regenerating — wait and read its result
                await new Promise(r => setTimeout(r, 2000));
                const refreshed = await dbGet<any>('SELECT file_path FROM music WHERE id = ?', [music.id]);
                if (refreshed?.file_path && refreshed.file_path.startsWith('http')) {
                  streamUrl = refreshed.file_path;
                } else {
                  res.status(503).json({ error: 'Music is being regenerated, please retry' });
                  return;
                }
              } else {
                // No generation_params — this music was created before the field existed.
                // Cannot regenerate. Mark URL as permanently gone so subsequent requests
                // don't keep re-probing and re-triggering the sentinel.
                console.warn('[Music] CDN expired, no generation_params for music id:', music.id);
                await dbRun('UPDATE music SET file_path = NULL WHERE id = ?', [music.id]);
                res.status(410).json({ error: 'Music URL expired and cannot be regenerated' });
                return;
              }
            } else {
              res.status(410).json({ error: 'Music URL expired and no params to regenerate' });
              return;
            }
          }
        }
      }

      // Stream with Range support — iOS Safari requires partial content responses
      const range = req.headers.range;
      try {
        const upstream = await axios.get<NodeJS.ReadableStream>(streamUrl, {
          responseType: 'stream',
          timeout: 30000,
          headers: range ? { Range: range } : {},
        });
        const upstreamStatus = upstream.status;
        res.setHeader('Content-Type', String(upstream.headers['content-type'] || 'audio/mpeg'));
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        if (upstream.headers['content-length']) res.setHeader('Content-Length', String(upstream.headers['content-length']));
        if (upstream.headers['content-range']) res.setHeader('Content-Range', String(upstream.headers['content-range']));
        res.status(upstreamStatus);
        (upstream.data as NodeJS.ReadableStream).pipe(res);
      } catch {
        res.status(502).json({ error: 'Failed to stream audio' });
      }
      return;
    }

    if (!fs.existsSync(music.file_path)) { res.status(404).json({ error: 'Music file not available' }); return; }

    const storagePath = path.resolve(process.env.STORAGE_PATH || './storage');
    const resolvedPath = path.resolve(music.file_path);
    if (!resolvedPath.startsWith(storagePath)) { res.status(403).json({ error: 'Access denied' }); return; }

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
  const music = await dbGet<any>(
    `SELECT m.*, s.user_id as story_user_id FROM music m
     JOIN stories s ON m.story_id = s.id WHERE m.id = ?`,
    [req.params.id]
  );
  if (!music?.file_path) { res.status(404).json({ error: 'Music file not available' }); return; }
  if (music.story_user_id !== req.userId) { res.status(403).json({ error: 'Only the author can download this music' }); return; }

  if (music.file_path.startsWith('http')) {
    res.redirect(302, music.file_path);
    return;
  }

  if (!fs.existsSync(music.file_path)) { res.status(404).json({ error: 'Music file not found' }); return; }

  // Path traversal guard: resolve and confirm file is within storage root
  const storagePath = path.resolve(process.env.STORAGE_PATH || './storage');
  const resolvedPath = path.resolve(music.file_path);
  if (!resolvedPath.startsWith(storagePath)) { res.status(403).json({ error: 'Access denied' }); return; }

  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resolvedPath)}"`);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(resolvedPath);
});

export default router;
