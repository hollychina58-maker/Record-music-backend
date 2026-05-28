import { Router, Request, Response } from 'express';
import { getDatabase } from '../models/database.js';

const router = Router();

router.post('/stories/:id/share', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();

  const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(id);
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }

  const baseUrl = process.env.SHARE_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const shareLink = `${baseUrl}/story/${id}`;

  res.json({
    data: {
      shareLink,
      storyId: parseInt(id, 10),
      createdAt: new Date().toISOString(),
    },
  });
});

export default router;