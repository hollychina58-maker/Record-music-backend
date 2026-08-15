import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { initDatabase, closeDatabase } from './models/database.js';
import { lookupGeo, countryToLanguage } from './services/geoip.js';
import { analyzePhotoImage } from './services/minimax.js';
import { seedDefaultStory } from './services/seed.js';
import storyRoutes from './routes/story.js';
import userRoutes from './routes/user.js';
import musicRoutes from './routes/music.js';
import commentRoutes from './routes/comment.js';
import sitemapRoutes from './routes/sitemap.js';
import shareRoutes from './routes/share.js';
import burnRoutes from './routes/burn.js';
import paymentRoutes from './routes/payment.js';
import likeRoutes from './routes/like.js';
import adminDashboardRoutes from './routes/admin/dashboard.js';
import adminStoryRoutes from './routes/admin/stories.js';
import adminCommentRoutes from './routes/admin/comments.js';
import adminUserRoutes from './routes/admin/users.js';
import adminProductRoutes from './routes/admin/products.js';
import adminCouponRoutes from './routes/admin/coupons.js';
import adminOrderRoutes from './routes/admin/orders.js';
import adminHeroRoutes from './routes/admin/hero.js';
import followRoutes from './routes/follow.js';
import notificationRoutes from './routes/notification.js';
import messageRoutes from './routes/message.js';
import blockRoutes from './routes/block.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

const app: Application = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

// H2: strict CORS origin whitelist — no wildcard subdomains (.vercel.app) or prefix matches
const ALLOWED_ORIGINS: string[] = [
  process.env.FRONTEND_URL,
  'https://ustory-umusic.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []),
].filter((v): v is string => !!v);

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser requests (curl, server-to-server) may omit Origin — allow
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
}));

// H3: derive the real client IP honoring `trust proxy` — use req.ip (Express resolves
// the trusted proxy chain) instead of trusting the first X-Forwarded-For entry.
function getClientIp(req: express.Request): string {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  return ip.replace(/^::ffff:/, '').replace('::1', '127.0.0.1');
}
app.use(express.json({ limit: '10mb' }));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  // configurable so local/E2E can raise it; production keeps the secure default
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)), // H3: trusted IP + IPv6 subnet normalization
  message: { error: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  // configurable for local/E2E; production keeps the secure default (10/min)
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)), // H3
  message: { error: 'Too many auth attempts, please try again later' },
});

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);

// Geo IP endpoint
app.get('/api/geo', (req, res) => {
  const clientIp = getClientIp(req);
  const geo = lookupGeo(clientIp);
  const language = countryToLanguage(geo.countryCode);
  res.json({ data: { countryCode: geo.countryCode, language } });
});

// Photo inspiration — analyze uploaded image with MiniMax VLM
app.post('/api/photo-inspiration', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'image (base64 or data URL) is required' });
      return;
    }
    const result = await analyzePhotoImage(image);
    res.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PhotoInspiration] Error:', message);
    res.status(500).json({ error: '图片分析服务暂时不可用，请稍后重试' });
  }
});

app.use('/api/story', storyRoutes);
app.use('/api', userRoutes);
app.use('/api/music', musicRoutes);
app.use('/api', commentRoutes);
app.use('/api', shareRoutes);
app.use('/api', sitemapRoutes);
app.use('/api', burnRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api', followRoutes);
app.use('/api', notificationRoutes);
app.use('/api', messageRoutes);
app.use('/api', blockRoutes);
app.use('/api/admin', adminDashboardRoutes);
app.use('/api/admin', adminStoryRoutes);
app.use('/api/admin', adminCommentRoutes);
app.use('/api/admin', adminUserRoutes);
app.use('/api/admin', adminProductRoutes);
app.use('/api/admin', adminCouponRoutes);
app.use('/api/admin', adminOrderRoutes);
app.use('/api/admin', adminHeroRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

initDatabase().then(() => {
  seedDefaultStory().catch((err) => {
    console.error('[Seed] Fatal error seeding default story:', err instanceof Error ? err.message : err);
  });
}).catch((err) => {
  console.error('[DB] Fatal: failed to initialize database:', err instanceof Error ? err.message : err);
  process.exit(1);
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  closeDatabase().finally(() => server.close(() => process.exit(0)));
});

// S1: prevent a single async-handler rejection from crashing the whole process.
// Express 4 does not await async route handlers, so a DB error surfaces as an
// unhandledRejection — Node 15+ would exit by default. Log and keep serving instead.
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err?.stack || err);
});

process.on('SIGINT', () => {
  closeDatabase().finally(() => server.close(() => process.exit(0)));
});

export default app;