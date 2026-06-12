import { Router, Request, Response } from 'express';
import { dbGet } from '../models/database.js';

const router = Router();

router.post('/stories/:id/share', async (req: Request, res: Response) => {
  const { id } = req.params;
  const story = await dbGet('SELECT id FROM stories WHERE id = ?', [id]);
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }
  const baseUrl = process.env.FRONTEND_URL || process.env.SHARE_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({
    data: {
      shareLink: `${baseUrl}/story/${id}`,
      storyId: parseInt(id, 10),
      createdAt: new Date().toISOString(),
    },
  });
});

export default router;
