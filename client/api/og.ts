/** Vercel Edge Function — serve story-specific OG meta tags for social media crawlers */
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const storyMatch = url.pathname.match(/^\/story\/(\d+)/);
  if (!storyMatch) return new Response(null, { status: 404 });

  const storyId = storyMatch[1];
  const userAgent = (req.headers.get('user-agent') || '').toLowerCase();
  const isCrawler = /twitterbot|facebookexternalhit|slack|linkedinbot|discord|whatsapp|telegrambot|viber/.test(userAgent);
  if (!isCrawler) return new Response(null, { status: 404 });

  try {
    const apiBase = process.env.VITE_API_URL || 'https://ustory-umusic.com';
    const storyRes = await fetch(`${apiBase}/api/story/${storyId}`);
    if (!storyRes.ok) return new Response(null, { status: 404 });
    const { data: story } = await storyRes.json() as any;

    const title = `${story.title} — 墨韵`;
    const desc = (story.content || '').slice(0, 160) + (story.content?.length > 160 ? '…' : '');
    const image = story.cover_image || 'https://ustory-umusic.com/icon-512.png';
    const pageUrl = `https://ustory-umusic.com/story/${storyId}`;

    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<link rel="canonical" href="${pageUrl}">
</head><body></body></html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
