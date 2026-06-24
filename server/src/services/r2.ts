import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

  try {
    // Download from source (MiniMax CDN)
    const response = await axios.get(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
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
    console.error('[R2] Upload failed for', bucketKey, ':', err instanceof Error ? err.message : err);
    return sourceUrl; // fallback to original URL on failure
  }
}
