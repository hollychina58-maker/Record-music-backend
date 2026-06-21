import { Router, Request, Response } from 'express';
import { dbAll } from '../models/database.js';

const router = Router();

// Sitemap endpoint — lists all public story pages + static routes
router.get('/sitemap.xml', async (_req: Request, res: Response) => {
  try {
    const stories = await dbAll<{ id: number; created_at: string }>(
      `SELECT s.id, s.created_at
       FROM stories s
       LEFT JOIN burned_stories bs ON s.id = bs.story_id
       WHERE bs.story_id IS NULL
       ORDER BY s.created_at DESC`
    );

    const baseUrl = process.env.FRONTEND_URL || 'https://ustory-umusic.com';

    const staticPages = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/login', priority: '0.5', changefreq: 'monthly' },
      { loc: '/register', priority: '0.5', changefreq: 'monthly' },
      { loc: '/payment', priority: '0.8', changefreq: 'weekly' },
    ];

    const urls = [
      ...staticPages.map(p => `  <url>
    <loc>${baseUrl}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`),
      ...stories.map(s => `  <url>
    <loc>${baseUrl}/story/${s.id}</loc>
    <lastmod>${s.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(xml);
  } catch (err) {
    console.error('[Sitemap] Error:', err);
    res.status(500).send('Internal server error');
  }
});

export default router;
