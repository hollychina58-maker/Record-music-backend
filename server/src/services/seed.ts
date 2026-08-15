import { dbGet, dbRun } from '../models/database.js';
import { generateMusic } from './minimax.js';

const DEFAULT_STORY = {
  title: '墨韵初章',
  content: `墨池之畔，烟霭氤氲。

那一方古砚，静卧于案，砚池中余墨未干，映着窗棂外斜照的暮光，幽幽如深潭。执笔之人端坐，指节苍劲，提腕间，一管紫毫饱蘸浓墨，落于素宣之上。

笔锋乍落，如孤鸿踏雪，轻而决绝。墨痕晕开，仿佛千年前某位无名书生的叹息，穿透了时光的帷幕，在这一刻被重新唤醒。横如千里阵云，竖如万岁枯藤——每一笔，都是山水的魂魄，是风骨与血肉的交织。

墨有魂魄。浓处是山河沈寂，淡处是烟雨迷离；枯笔见风骨嶙峋，湿墨蕴温润如玉。研墨之人深知，这黑不只是黑，是万物归于一心后的澄明。它在宣纸上呼吸、生长、蔓延，终而凝结成一方独立于时间之外的小宇宙。

风入轩窗，吹动案头残卷，沙沙声如远古的回响。执笔者搁笔，凝视着纸上的墨迹——它不言，却已说尽了一切。`,
  language: 'cmn',
  country_code: 'CN',
};

const MUSIC_OPTIONS = {
  musicType: 'instrumental' as const,
  musicMood: 'peace' as const,
  musicGenre: 'chinese_folk' as const,
};

export async function seedDefaultStory(): Promise<void> {
  if (!process.env.MINIMAX_API_KEY) {
    console.log('[Seed] MiniMax API key not configured — skipping seed');
    return;
  }

  // Check if default story already exists
  const existing = await dbGet<{ id: number }>('SELECT id FROM stories WHERE user_id IS NULL LIMIT 1');

  let storyId: number;
  if (existing) {
    storyId = existing.id;
    console.log(`[Seed] Default story already exists (id: ${storyId})`);
  } else {
    const storyResult = await dbRun(
      'INSERT INTO stories (user_id, title, content, language, country_code) VALUES (NULL, ?, ?, ?, ?)',
      [DEFAULT_STORY.title, DEFAULT_STORY.content, DEFAULT_STORY.language, DEFAULT_STORY.country_code]
    );
    storyId = storyResult.lastInsertRowid;
    console.log(`[Seed] Default story created (id: ${storyId})`);
  }

  // Check music status for this story
  const existingMusic = await dbGet<{ id: number; status: string; file_path: string | null }>(
    'SELECT id, status, file_path FROM music WHERE story_id = ? ORDER BY id ASC LIMIT 1',
    [storyId]
  );

  if (existingMusic?.status === 'completed' && existingMusic.file_path) {
    // Music already generated and stored — nothing to do
    console.log(`[Seed] Music already complete (id: ${existingMusic.id})`);
    return;
  }

  let musicId: number;
  if (existingMusic) {
    // Music record exists but is pending or failed — retry generation in place
    musicId = existingMusic.id;
    await dbRun("UPDATE music SET status = 'pending', file_path = NULL WHERE id = ?", [musicId]);
    console.log(`[Seed] Retrying music generation (id: ${musicId}, was: ${existingMusic.status})`);
  } else {
    // Create a new music record
    const musicResult = await dbRun(
      "INSERT INTO music (story_id, status, style) VALUES (?, 'pending', '辽阔悠扬')",
      [storyId]
    );
    musicId = musicResult.lastInsertRowid;
    console.log(`[Seed] Music record created (id: ${musicId})`);
  }

  try {
    console.log('[Seed] Generating music for default story...');
    const { audioUrl } = await generateMusic(DEFAULT_STORY.content, MUSIC_OPTIONS);
    await dbRun(
      "UPDATE music SET status = 'completed', file_path = ? WHERE id = ?",
      [audioUrl, musicId]
    );
    console.log('[Seed] Default story music generated and saved:', audioUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[Seed] Music generation failed: ${message} — music will remain pending`);
    await dbRun("UPDATE music SET status = 'failed' WHERE id = ?", [musicId]);
  }
}
