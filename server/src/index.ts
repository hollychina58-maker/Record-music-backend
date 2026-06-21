import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
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

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

const app: Application = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.endsWith('.vercel.app') || origin === process.env.FRONTEND_URL || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' },
});

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);

// Geo IP endpoint
app.get('/api/geo', (req, res) => {
  const ip = req.headers['x-forwarded-for'] as string || req.ip || '127.0.0.1';
  const clientIp = ip.split(',')[0].trim();
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
    res.status(500).json({ error: message });
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
app.use('/api/admin', adminDashboardRoutes);
app.use('/api/admin', adminStoryRoutes);
app.use('/api/admin', adminCommentRoutes);
app.use('/api/admin', adminUserRoutes);
app.use('/api/admin', adminProductRoutes);
app.use('/api/admin', adminCouponRoutes);
app.use('/api/admin', adminOrderRoutes);

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

process.on('SIGINT', () => {
  closeDatabase().finally(() => server.close(() => process.exit(0)));
});

export default app;
