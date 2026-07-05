/** Vercel Edge Function — serve story-specific OG meta tags for social media crawlers */
export const config = { runtime: 'edge' };

const CRAWLER_UA = /twitterbot|facebookexternalhit|slack|linkedinbot|discord|whatsapp|telegrambot|viber|iframely/i;

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const ua = (req.headers.get('user-agent') || '').toLowerCase();

  // Not a crawler → serve the SPA index.html so React can take over
  if (!CRAWLER_UA.test(ua)) {
    const spaHtml = await fetch(new URL('/index.html', url.origin));
    return new Response(spaHtml.body, { headers: { 'Content-Type': 'text/html' } });
  }

  const storyId = url.searchParams.get('id');
  if (!storyId) return new Response(null, { status: 404 });

  try {
    const storyRes = await fetch(`https://ustory-umusic.com/api/story/${storyId}`);
    if (!storyRes.ok) return new Response(null, { status: 404 });
    const { data: story } = await storyRes.json() as any;

    const title = `${story.title} — 墨韵`;
    const desc = (story.content || '').slice(0, 160);
    const image = story.cover_image || 'https://ustory-umusic.com/icon-512.png';

    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:url" content="https://ustory-umusic.com/story/${storyId}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<link rel="canonical" href="https://ustory-umusic.com/story/${storyId}">
</head><body></body></html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
