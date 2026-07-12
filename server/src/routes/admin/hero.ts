import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';
import { adminMiddleware } from '../../middleware/admin.js';
import { dbGet, dbRun } from '../../models/database.js';
import { generateCoverImage } from '../../services/minimax.js';
import { uploadToR2, deleteFromR2 } from '../../services/r2.js';

const router = Router();

// Get current hero image
router.get('/hero-image', async (_req, res: Response) => {
  const row = await dbGet<{ value: string }>("SELECT value FROM site_config WHERE key = 'hero_image'");
  res.json({ data: { url: row?.value || null } });
});

// Generate new hero image (admin only)
router.post('/hero-image/generate', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    // Delete old R2 file before overwriting DB record
    const old = await dbGet<{ value: string }>("SELECT value FROM site_config WHERE key = 'hero_image'");
    if (old?.value) {
      deleteFromR2(old.value).catch(err => console.error('[Hero] Old image delete failed:', err));
    }

    const prompt = '中国水墨画风格，意境深远，留白构图，远山朦胧，云雾缭绕，松柏点缀，湖面如镜，一叶扁舟，墨色浓淡相宜，宣纸质感，适合文学网站首页横幅';
    const result = await generateCoverImage(prompt);
    const bucketKey = `hero/hero_${Date.now()}.png`;
    const permanentUrl = await uploadToR2(result.imageUrl, bucketKey, 'image/png');

    await dbRun("INSERT OR REPLACE INTO site_config (key, value) VALUES ('hero_image', ?)", [permanentUrl]);
    await dbRun("INSERT OR REPLACE INTO site_config (key, value) VALUES ('hero_prompt', ?)", [prompt]);

    res.json({ data: { url: permanentUrl } });
  } catch (err) {
    console.error('[Hero] Generation failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Hero image generation failed' });
  }
});

// Delete hero image (admin only)
router.delete('/hero-image', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  const row = await dbGet<{ value: string }>("SELECT value FROM site_config WHERE key = 'hero_image'");
  if (row?.value) {
    deleteFromR2(row.value).catch(err => console.error('[Hero] Delete old image failed:', err));
    await dbRun("DELETE FROM site_config WHERE key = 'hero_image'");
    await dbRun("DELETE FROM site_config WHERE key = 'hero_prompt'");
  }
  res.json({ ok: true });
});

export default router;
