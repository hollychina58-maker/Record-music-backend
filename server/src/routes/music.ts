import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMusic, analyzeEmotion, MOOD_LABELS } from '../services/minimax.js';
import type { MusicOptions } from '../services/minimax.js';
import { uploadToR2 } from '../services/r2.js';
import { extractLyrics } from '../services/storyAnalysis.js';
import { dbGet, dbAll, dbRun, dbBatch } from '../models/database.js';
import path from 'path';
import fs from 'fs';

const router = Router();

// Upload reference audio for music-cover mode
router.post('/ref-audio/upload', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { audioBase64, fileName } = req.body;
  if (!audioBase64) { res.status(400).json({ error: 'audioBase64 is required' }); return; }
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    if (buffer.length > 10 * 1024 * 1024) { res.status(400).json({ error: 'File too large (max 10MB)' }); return; }
    const key = `audio_refs/${req.userId}_${Date.now()}_${fileName || 'ref.mp3'}`;
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET_NAME;
    const publicBase = process.env.R2_PUBLIC_URL || `https://${bucket}.${accountId}.r2.cloudflarestorage.com`;
    if (!accountId || !bucket) { res.status(500).json({ error: 'R2 not configured' }); return; }
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY || '', secretAccessKey: process.env.R2_SECRET_KEY || '' },
    });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'audio/mpeg' }));
    res.json({ data: { url: `${publicBase}/${key}` } });
  } catch (err: any) {
    console.error('[RefAudio Upload]', err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

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
    // Upload to Cloudflare R2 for permanent CDN storage (MiniMax URL expires in ~24h)
    const bucketKey = `music/${storyId}/${musicId}_${Date.now()}.mp3`;
    const permanentUrl = await uploadToR2(result.audioUrl, bucketKey, 'audio/mpeg');
    await dbBatch([
      { sql: "UPDATE music SET status = 'completed', file_path = ? WHERE id = ?", args: [permanentUrl, musicId] },
      { sql: 'INSERT INTO music_usage (user_id, story_id, music_id) VALUES (?, ?, ?)', args: [userId, storyId, musicId] },
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    console.error('[Music] Async generation failed for musicId', musicId, 'storyId', storyId, ':', message);
    if (err instanceof Error && err.stack) console.error('[Music] Stack:', err.stack.split('\n').slice(0, 3).join('\n'));
    await dbRun("UPDATE music SET status = 'failed' WHERE id = ?", [musicId]);
    if (isSubscription && subscriptionId) {
      await dbRun('UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ? AND music_remaining IS NOT NULL', [subscriptionId]);
    } else if (!isSubscription) {
      await dbRun('UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?', [userId]);
    }
  }
}

router.post('/generate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // lyricsMode: 'story_as_lyrics' → use story text directly as lyrics (author wrote it as lyrics)
    //             'ai_generated' (default) → AI extracts lyrics from story narrative
    const { storyId, text, musicType, musicMood, musicGenre, lyricsMode, duration, audioRefUrl } = req.body;
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

    // Step 1: Check dedup FIRST — before any credit deduction or AI analysis
    const existing = await dbGet<{ id: number; status: string; file_path: string | null; created_at: string }>(
      "SELECT id, status, file_path, created_at FROM music WHERE story_id = ? AND status IN ('pending', 'completed') AND (file_path IS NOT NULL OR status = 'pending') ORDER BY created_at DESC LIMIT 1",
      [storyId]
    );

    if (existing) {
      // Stale pending (>3 min old) = abandoned generation — don't reuse, retry instead
      const isStale = existing.status === 'pending'
        && (Date.now() - new Date(existing.created_at + 'Z').getTime()) > 180000;
      if (isStale) {
        console.log('[Music] Stale pending record', existing.id, '— resetting for retry');
        await dbRun("UPDATE music SET status = 'failed' WHERE id = ?", [existing.id]);
        // Refund the credit from the abandoned attempt
        if (subscription && subscription.music_remaining !== null) {
          await dbRun('UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ? AND music_remaining IS NOT NULL', [subscription.id]);
        } else if (!subscription) {
          await dbRun('UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?', [userId]);
        }
        // Fall through to create new record
      } else {
        console.log('[Music] Reusing existing music record', existing.id, 'status:', existing.status, '— no credit deducted, no AI call');
        const subRemaining = subscription
          ? (await dbGet<{ music_remaining: number | null }>('SELECT music_remaining FROM subscriptions WHERE id = ?', [subscription.id]))?.music_remaining
          : null;
        const userCount = !subscription
          ? (await dbGet<{ free_music_count: number }>('SELECT free_music_count FROM users WHERE id = ?', [userId]))?.free_music_count
          : null;
        res.status(202).json({
          data: { musicId: existing.id, status: existing.status, subscriptionRemaining: subRemaining ?? null, freeMusicCount: userCount ?? null },
        });
        return;
      }
    }

    // Step 2: AI analysis — only run when we actually need to create new music
    const effectiveMood = musicMood || story.tone || undefined;
    const musicOptions: MusicOptions = { musicType, musicMood: effectiveMood, musicGenre, duration, lyricsMode, audioRefUrl };
    const styleLabel = (effectiveMood && MOOD_LABELS[effectiveMood]) ? MOOD_LABELS[effectiveMood] : analyzeEmotion(text).style;

    let effectiveText = text;
    if (musicType === 'song') {
      if (lyricsMode === 'story_as_lyrics') {
        effectiveText = text.slice(0, 400);
      }
      // song_ai: skip extractLyrics — MiniMax lyrics_optimizer handles it (saves one API call)
    }

    const generationParams = JSON.stringify({ effectiveText, musicOptions, lyricsMode: lyricsMode || 'ai_generated' });

    // Step 3: Deduct credit atomically (only after confirming no valid existing record)
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
    // Step 4: Create music record and trigger async generation
    const musicRecord = await dbRun(
      "INSERT INTO music (story_id, status, style, music_type, generation_params) VALUES (?, 'pending', ?, ?, ?)",
      [storyId, styleLabel, musicType || 'instrumental', generationParams]
    );
    const musicId = musicRecord.lastInsertRowid as number;

    // Step 5: Read remaining counts after deduction
    const subscriptionRemaining = subscription
      ? (await dbGet<{ music_remaining: number | null }>('SELECT music_remaining FROM subscriptions WHERE id = ?', [subscriptionId ?? subscription.id]))?.music_remaining
      : null;
    const userRow = !subscription
      ? await dbGet<{ free_music_count: number }>('SELECT free_music_count FROM users WHERE id = ?', [userId])
      : null;

    // Step 6: Fire-and-forget async generation
    processMusicAsync(userId, storyId, musicId, effectiveText, musicOptions, isSubscription, subscriptionId)
      .catch(err => console.error('[Music] Unhandled error in processMusicAsync:', err));

    res.status(202).json({
      data: {
        musicId,
        status: 'pending',
        subscriptionRemaining: subscriptionRemaining ?? null,
        freeMusicCount: userRow?.free_music_count ?? null,
      },
    });
  } catch (error) {
    console.error('[Music Generate]', error instanceof Error ? error.message : error);
    res.status(500).json({ error: '音乐生成服务暂时不可用，请稍后重试' });
  }
});

router.get('/by-story/:storyId', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  // Return music records with their file_path.
  // If file_path is NULL (expired CDN URL that couldn't regenerate), mark as 'expired'
  // so the client can show a "regenerate" prompt instead of a broken player.
  const records = await dbAll<any>(
    "SELECT id, story_id, status, style, file_path, music_type, generation_params, created_at FROM music WHERE story_id = ? ORDER BY created_at DESC",
    [req.params.storyId]
  );
  const data = records.map(r => ({
    id: r.id,
    story_id: r.story_id,
    status: r.status === 'completed' && !r.file_path ? 'expired' : r.status,
    style: r.style,
    musicType: r.music_type,
    generationParams: r.generation_params,
    created_at: r.created_at,
  }));
  res.json({ data });
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

    if (music.file_path.startsWith('http')) {
      // Stream directly — no HEAD probe (MiniMax signed URLs often reject HEAD)
      // No in-stream regeneration — if URL is dead, mark expired so UI shows regenerate button
      const range = req.headers.range;
      try {
        const upstream = await axios.get<NodeJS.ReadableStream>(music.file_path, {
          responseType: 'stream',
          timeout: 30000,
          headers: range ? { Range: range } : {},
        });
        res.setHeader('Content-Type', String(upstream.headers['content-type'] || 'audio/mpeg'));
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        if (upstream.headers['content-length']) res.setHeader('Content-Length', String(upstream.headers['content-length']));
        if (upstream.headers['content-range']) res.setHeader('Content-Range', String(upstream.headers['content-range']));
        res.status(upstream.status);
        (upstream.data as NodeJS.ReadableStream).pipe(res);
      } catch (streamErr: any) {
        const status = streamErr?.response?.status;
        if (status === 403 || status === 404 || status === 410) {
          console.warn('[Music] CDN URL dead (status %d) for music id: %d', status, music.id);
          await dbRun('UPDATE music SET file_path = NULL, status = ? WHERE id = ?', ['expired', music.id]);
        }
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
    console.error('[Music Stream]', message);
    res.status(500).json({ error: '音频流服务暂时不可用，请稍后重试' });
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
    // Proxy download — 302 redirect breaks axios blob response
    try {
      const upstream = await axios.get(music.file_path, {
        responseType: 'stream',
        timeout: 30000,
      });
      res.setHeader('Content-Disposition', `attachment; filename="music_${req.params.id}.mp3"`);
      res.setHeader('Content-Type', String(upstream.headers['content-type'] || 'audio/mpeg'));
      res.setHeader('Content-Length', String(upstream.headers['content-length'] || '0'));
      (upstream.data as NodeJS.ReadableStream).pipe(res);
    } catch {
      res.status(502).json({ error: 'Download failed' });
    }
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
