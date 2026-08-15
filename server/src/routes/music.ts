import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMusic, analyzeEmotion, MOOD_LABELS } from '../services/minimax.js';
import type { MusicOptions } from '../services/minimax.js';
import { uploadToR2 } from '../services/r2.js';
import { extractLyrics } from '../services/storyAnalysis.js';
import { dbGet, dbAll, dbRun, dbBatch, getDatabase } from '../models/database.js';
import path from 'path';
import fs from 'fs';

import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Upload reference audio for music-cover mode
router.post('/ref-audio/upload', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { audioBase64, fileName } = req.body;
  if (!audioBase64) { res.status(400).json({ error: 'audioBase64 is required' }); return; }
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    if (buffer.length > 10 * 1024 * 1024) { res.status(400).json({ error: 'File too large (max 10MB)' }); return; }
        // 3-7: sanitize user-supplied fileName — whitelist [\w.-], cap length (no path separators)
    const safeName = String(fileName || 'ref.mp3').replace(/[^\w.-]/g, '_').slice(0, 50);
    const key = `audio_refs/${req.userId}_${Date.now()}_${safeName}`;
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
}));

async function processMusicAsync(
  userId: number,
  storyId: number,
  musicId: number,
  text: string,
  musicOptions: MusicOptions,
  isSubscription: boolean,
  subscriptionId: number | null,
) {
  const startedAt = Date.now();
  try {
    console.log(`[Music] Starting async generation musicId=${musicId} storyId=${storyId} type=${musicOptions.musicType || 'instrumental'} duration=${musicOptions.duration || 'medium'}`);
    const result = await generateMusic(text, musicOptions);
    console.log(`[Music] MiniMax generated audio: ${result.audioUrl.slice(0, 80)}...`);
    // Upload to Cloudflare R2 for permanent CDN storage (MiniMax URL expires in ~24h)
    const bucketKey = `music/${storyId}/${musicId}_${Date.now()}.mp3`;
    const permanentUrl = await uploadToR2(result.audioUrl, bucketKey, 'audio/mpeg');
    console.log(`[Music] R2 permanent URL: ${permanentUrl.slice(0, 80)}...`);
    await dbBatch([
      { sql: "UPDATE music SET status = 'completed', file_path = ? WHERE id = ?", args: [permanentUrl, musicId] },
      { sql: 'INSERT INTO music_usage (user_id, story_id, music_id) VALUES (?, ?, ?)', args: [userId, storyId, musicId] },
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    const code = (err as any)?.code || '';
    console.error(`[Music] Async generation failed for musicId=${musicId} storyId=${storyId} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s (code=${code}): ${message}`);
    if (err instanceof Error && err.stack) console.error('[Music] Stack:', err.stack.split('\n').slice(0, 3).join('\n'));
    await dbRun("UPDATE music SET status = 'failed' WHERE id = ?", [musicId]);
    if (isSubscription && subscriptionId) {
      await dbRun('UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ? AND music_remaining IS NOT NULL', [subscriptionId]);
    } else if (!isSubscription) {
      await dbRun('UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?', [userId]);
    }
  }
}

router.post('/generate', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    // lyricsMode: 'story_as_lyrics' → use story text directly as lyrics (author wrote it as lyrics)
    //             'ai_generated' (default) → AI extracts lyrics from story narrative
    const { storyId, text, musicType, musicMood, musicGenre, lyricsMode, duration, audioRefUrl } = req.body;
    if (!storyId || !text) { res.status(400).json({ error: 'storyId and text are required' }); return; }

    const story = await dbGet<{ id: number; tone: string | null; user_id: number | null }>('SELECT id, tone, user_id FROM stories WHERE id = ?', [storyId]);
    if (!story) { res.status(404).json({ error: 'Story not found' }); return; }
    // H1: ownership check — users can only generate music for their own stories
    if (story.user_id !== (req.userId as number)) {
      res.status(403).json({ error: 'You can only generate music for your own stories' });
      return;
    }

    const userId = req.userId as number;
    const subscription = await dbGet<{ id: number; music_remaining: number | null }>(
      "SELECT id, music_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
      [userId]
    );

    let isSubscription = false;
    let subscriptionId: number | null = null;

    // Compute AI options BEFORE the transaction (pure — no DB access)
    const effectiveMood = musicMood || story.tone || undefined;
    const musicOptions: MusicOptions = { musicType, musicMood: effectiveMood, musicGenre, duration, lyricsMode, audioRefUrl };
    const styleLabel = (effectiveMood && MOOD_LABELS[effectiveMood]) ? MOOD_LABELS[effectiveMood] : analyzeEmotion(text).style;

    let effectiveText = text;
    if (musicType === 'song' && lyricsMode === 'story_as_lyrics') {
      effectiveText = text.slice(0, 400);
    }
    const generationParams = JSON.stringify({ effectiveText, musicOptions, lyricsMode: lyricsMode || 'ai_generated' });

    // S2: run dedup → credit deduction → INSERT inside ONE write transaction, so a
    // double-click can't double-charge and an INSERT failure can't lose credits.
    const client = getDatabase();
    const tx = await client.transaction('write');
    let musicId: number;
    let reusedId: number | null = null;
    let reusedStatus: string | null = null;
    try {
      // Dedup check (serialized by the write transaction)
      const existingRes = await tx.execute({
        sql: "SELECT id, status, file_path, created_at FROM music WHERE story_id = ? AND status IN ('pending', 'completed') AND (file_path IS NOT NULL OR status = 'pending') ORDER BY created_at DESC LIMIT 1",
        args: [storyId],
      });
      const existingRow = existingRes.rows[0] as unknown as { id: number; status: string; file_path: string | null; created_at: string } | undefined;

      if (existingRow) {
        const isStale = existingRow.status === 'pending'
          && (Date.now() - new Date(existingRow.created_at + 'Z').getTime()) > 300000;
        if (!isStale) {
          // Reuse existing record — no deduction, no AI call
          reusedId = existingRow.id;
          reusedStatus = existingRow.status;
          await tx.rollback();
        } else {
          // Stale pending → mark failed + refund the abandoned attempt, then create new
          console.log('[Music] Stale pending record', existingRow.id, '— resetting for retry');
          await tx.execute({ sql: "UPDATE music SET status = 'failed' WHERE id = ?", args: [existingRow.id] });
          if (subscription && subscription.music_remaining !== null) {
            await tx.execute({ sql: 'UPDATE subscriptions SET music_remaining = music_remaining + 1 WHERE id = ? AND music_remaining IS NOT NULL', args: [subscription.id] });
          } else if (!subscription) {
            await tx.execute({ sql: 'UPDATE users SET free_music_count = free_music_count + 1 WHERE id = ?', args: [userId] });
          }
        }
      }

      if (reusedId === null) {
        // Deduct credit atomically inside the transaction
        if (subscription) {
          subscriptionId = subscription.id;
          if (subscription.music_remaining !== null) {
            const lock = await tx.execute({ sql: 'UPDATE subscriptions SET music_remaining = music_remaining - 1 WHERE id = ? AND music_remaining > 0', args: [subscription.id] });
            if (lock.rowsAffected === 0) {
              await tx.rollback();
              res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
              return;
            }
          }
          isSubscription = true;
        } else {
          const lock = await tx.execute({ sql: 'UPDATE users SET free_music_count = free_music_count - 1 WHERE id = ? AND free_music_count > 0', args: [userId] });
          if (lock.rowsAffected === 0) {
            await tx.rollback();
            res.status(402).json({ error: 'No music generation remaining. Please purchase a plan.' });
            return;
          }
        }

        const ins = await tx.execute({
          sql: "INSERT INTO music (story_id, status, style, music_type, generation_params) VALUES (?, 'pending', ?, ?, ?)",
          args: [storyId, styleLabel, musicType || 'instrumental', generationParams],
        });
        musicId = Number(ins.lastInsertRowid);
        await tx.commit();
      } else {
        musicId = reusedId;
      }
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }

    // Reuse path: return existing record without any new deduction
    if (reusedId !== null) {
      const subRemaining = subscription
        ? (await dbGet<{ music_remaining: number | null }>('SELECT music_remaining FROM subscriptions WHERE id = ?', [subscription.id]))?.music_remaining
        : null;
      const userCount = !subscription
        ? (await dbGet<{ free_music_count: number }>('SELECT free_music_count FROM users WHERE id = ?', [userId]))?.free_music_count
        : null;
      res.status(202).json({
        data: { musicId: reusedId, status: reusedStatus, subscriptionRemaining: subRemaining ?? null, freeMusicCount: userCount ?? null },
      });
      return;
    }

    // Read remaining counts after deduction
    const subscriptionRemaining = subscription
      ? (await dbGet<{ music_remaining: number | null }>('SELECT music_remaining FROM subscriptions WHERE id = ?', [subscriptionId ?? subscription.id]))?.music_remaining
      : null;
    const userRow = !subscription
      ? await dbGet<{ free_music_count: number }>('SELECT free_music_count FROM users WHERE id = ?', [userId])
      : null;

    // Fire-and-forget async generation
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
}));

router.get('/by-story/:storyId', optionalAuthMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  // Return music records with their file_path.
  // If file_path is NULL (expired CDN URL that couldn't regenerate), mark as 'expired'
  // so the client can show a "regenerate" prompt instead of a broken player.
  // H1: do not expose music records of burned stories (music is destroyed on burn)
  const burned = await dbGet('SELECT id FROM burned_stories WHERE story_id = ?', [req.params.storyId]);
  if (burned) { res.json({ data: [] }); return; }
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
}));

router.get('/status/:id', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const music = await dbGet<any>(
    `SELECT m.id, m.status, m.file_path, m.style, s.user_id
     FROM music m JOIN stories s ON m.story_id = s.id WHERE m.id = ?`, [req.params.id]
  );
  if (!music) { res.status(404).json({ error: 'Music not found' }); return; }
  if (music.user_id !== req.userId) { res.status(403).json({ error: 'Access denied' }); return; }
  res.json({ id: music.id, status: music.status, filePath: music.file_path, style: music.style });
}));

router.get('/:id', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const music = await dbGet<any>(
    `SELECT m.*, s.user_id as story_user_id FROM music m JOIN stories s ON m.story_id = s.id WHERE m.id = ?`,
    [req.params.id]
  );
  if (!music) { res.status(404).json({ error: 'Music not found' }); return; }
  if (music.story_user_id !== req.userId) { res.status(403).json({ error: 'Access denied' }); return; }
  res.json({ data: music });
}));

router.get('/:id/stream', asyncHandler(async (req: Request, res: Response) => {
  const secret = process.env.JWT_SECRET;
  // 3-16: Authorization header only — token must NOT travel in the URL query string
  const authHeader = req.headers.authorization;
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // Optional auth — guests can stream public story music too
  let requestUserId: number | null = null;
  if (rawToken && secret) {
    try {
      const decoded = jwt.verify(rawToken, secret, { algorithms: ['HS256'] }) as { userId: number };
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
        // If file_path is a MiniMax URL (R2 upload fell back), it needs the MiniMax key.
        // R2 public URLs ignore the header, so adding it unconditionally is safe.
        const miniMaxKey = process.env.MINIMAX_API_KEY;
        const upstream = await axios.get<NodeJS.ReadableStream>(music.file_path, {
          responseType: 'stream',
          timeout: 30000,
          headers: {
            ...(range ? { Range: range } : {}),
            ...(miniMaxKey ? { Authorization: `Bearer ${miniMaxKey}` } : {}),
          },
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
}));

router.get('/:id/download', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const music = await dbGet<any>(
    `SELECT m.*, s.user_id as story_user_id FROM music m
     JOIN stories s ON m.story_id = s.id WHERE m.id = ?`,
    [req.params.id]
  );
  if (!music?.file_path) { res.status(404).json({ error: 'Music file not available' }); return; }
  if (music.story_user_id !== req.userId) { res.status(403).json({ error: 'Only the author can download this music' }); return; }

  if (music.file_path.startsWith('http')) {
    // 3-19: proxy the file through the authenticated endpoint instead of 302 to a
    // public permanent URL (a 302 would hand out a shareable link bypassing auth)
    try {
      const upstream = await axios.get<NodeJS.ReadableStream>(music.file_path, {
        responseType: 'stream',
        timeout: 30000,
      });
      res.setHeader('Content-Type', String(upstream.headers['content-type'] || 'audio/mpeg'));
      res.setHeader('Content-Disposition', `attachment; filename="music_${music.id}.mp3"`);
      if (upstream.headers['content-length']) res.setHeader('Content-Length', String(upstream.headers['content-length']));
      res.status(upstream.status);
      (upstream.data as NodeJS.ReadableStream).pipe(res);
    } catch (err) {
      console.error('[Music Download] Upstream fetch failed for music id', music.id, ':', err instanceof Error ? err.message : err);
      res.status(502).json({ error: 'Failed to download audio' });
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
}));

export default router;