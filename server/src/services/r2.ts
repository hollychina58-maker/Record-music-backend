import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY;
  const secretKey = process.env.R2_SECRET_KEY;
  if (!accountId || !accessKey || !secretKey) {
    console.warn('[R2] Credentials not configured, skipping R2 upload');
    return null;
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

/**
 * Download a file from a URL and upload to Cloudflare R2.
 * Returns the R2 public URL, or the original URL if R2 is not configured.
 */
export async function uploadToR2(
  sourceUrl: string,
  bucketKey: string,
  contentType = 'audio/mpeg',
): Promise<string> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  if (!client || !bucket) return sourceUrl; // fallback: return original URL

  // Retry up to 2 times for transient network errors
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Download from source (MiniMax CDN). Music-2.6 audio URLs live on MiniMax's
      // OSS bucket and require the API key — image URLs are public but the header is
      // harmless for them too (this was missing before, causing audio downloads to 401
      // and fall back to the raw, expiring MiniMax URL).
      const miniMaxKey = process.env.MINIMAX_API_KEY;
      const response = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 180000, // 3min — 跨海下载国内 OSS 音频(9MB+)可能较慢，60s 太短会误判 R2 失败
        maxRedirects: 0, // 禁止重定向，防止 sourceUrl 被劫持后 302 到内网（SSRF）
        headers: miniMaxKey ? { Authorization: `Bearer ${miniMaxKey}` } : undefined,
      });

      // Upload to R2
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: bucketKey,
          Body: Buffer.from(response.data),
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );

      // Return public URL (if you have a custom domain, use R2_PUBLIC_URL)
      const publicBase = process.env.R2_PUBLIC_URL
        || `https://${bucket}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      const r2Url = `${publicBase}/${bucketKey}`;
      console.log('[R2] Uploaded:', bucketKey);
      return r2Url;
    } catch (err) {
      const anyErr = err as { response?: { status?: number }; message?: string };
      const status = anyErr?.response?.status;
      if (attempt === MAX_RETRIES - 1) {
        // 失败时抛出而非静默回退——否则音乐会被标记为 completed 却存了一个
        // 临时的 MiniMax URL，用户看不到失败、也不会退款。抛错让 processMusicAsync
        // 捕获 → 标记 failed → 退款，用户可重试。
        console.error('[R2] Upload failed after', MAX_RETRIES, 'attempts for', bucketKey, ':', anyErr?.message || err, status ? `(HTTP ${status})` : '');
        throw new Error(`R2 upload failed (download HTTP ${status ?? 'unknown'}): ${anyErr?.message || err}`);
      }
      console.warn('[R2] Upload attempt', attempt + 1, 'failed, retrying:', anyErr?.message || err, status ? `(HTTP ${status})` : '');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('R2 upload failed after retries');
}

/**
 * Delete a file from Cloudflare R2 by its public URL.
 * Extracts the key from the URL path. No-op if R2 is not configured or URL is not from R2.
 */
export async function deleteFromR2(fileUrl: string): Promise<void> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  if (!client || !bucket || !fileUrl) return;

  // Extract key from R2 URL path (e.g. https://pub-xxx.r2.dev/music/10/33.mp3 → music/10/33.mp3)
  try {
    const url = new URL(fileUrl);
    // Safety: verify the URL belongs to our R2 bucket before deleting
    const publicUrlHost = process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL).hostname : null;
    const expectedHost = publicUrlHost || `${bucket}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    if (url.hostname !== expectedHost) {
      console.warn('[R2] Skipping delete — URL hostname mismatch:', url.hostname, 'expected:', expectedHost);
      return;
    }
    const key = url.pathname.slice(1);
    if (!key) return;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log('[R2] Deleted:', key);
  } catch (err) {
    console.error('[R2] Delete failed for', fileUrl, ':', err instanceof Error ? err.message : err);
  }
}