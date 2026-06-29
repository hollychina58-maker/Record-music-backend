import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface MiniMaxMusicResponse {
  data?: {
    audio?: string;
    status?: number;
  };
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

interface EmotionResult {
  emotion: string;
  style: string;
  prompt: string;
}

interface MoodProfile {
  mood: string;
  style: string;
  tempo: string;
  instruments: string;
}

const MOOD_PROFILES: MoodProfile[] = [
  { mood: 'sorrow', style: 'melancholic piano ballad', tempo: 'slow', instruments: 'piano, cello, strings' },
  { mood: 'joy', style: 'bright uplifting pop', tempo: 'upbeat', instruments: 'acoustic guitar, piano, light percussion' },
  { mood: 'peace', style: 'ambient nature soundscape', tempo: 'very slow', instruments: 'flute, guqin, soft pads' },
  { mood: 'nostalgia', style: 'wistful folk ballad', tempo: 'moderate slow', instruments: 'erhu, acoustic guitar, soft strings' },
  { mood: 'passion', style: 'epic cinematic orchestral', tempo: 'dramatic', instruments: 'full orchestra, brass, timpani' },
  { mood: 'mystery', style: 'dark ambient cinematic', tempo: 'slow eerie', instruments: 'synth pads, low strings, bells' },
  { mood: 'warmth', style: 'warm romantic orchestral', tempo: 'moderate', instruments: 'violin, harp, warm strings' },
  { mood: 'loneliness', style: 'sparse minimal piano', tempo: 'very slow', instruments: 'solo piano, soft strings' },
];

const KEYWORD_MOOD: Record<string, { mood: string; weight: number }> = {
  // Chinese keywords
  悲: { mood: 'sorrow', weight: 3 }, 伤: { mood: 'sorrow', weight: 2 },
  痛: { mood: 'sorrow', weight: 2 }, 哭: { mood: 'sorrow', weight: 3 },
  泪: { mood: 'sorrow', weight: 3 }, 恨: { mood: 'sorrow', weight: 2 },
  孤: { mood: 'loneliness', weight: 3 }, 独: { mood: 'loneliness', weight: 2 },
  愁: { mood: 'sorrow', weight: 2 }, 怨: { mood: 'sorrow', weight: 2 },
  忧: { mood: 'sorrow', weight: 1 }, 离: { mood: 'sorrow', weight: 2 },
  别: { mood: 'sorrow', weight: 2 }, 丧: { mood: 'sorrow', weight: 3 },
  暗: { mood: 'sorrow', weight: 1 }, 灰: { mood: 'sorrow', weight: 1 },
  寒: { mood: 'sorrow', weight: 1 }, 冷: { mood: 'sorrow', weight: 1 },
  碎: { mood: 'sorrow', weight: 2 }, 弃: { mood: 'sorrow', weight: 2 },
  喜: { mood: 'joy', weight: 3 }, 乐: { mood: 'joy', weight: 2 },
  欢: { mood: 'joy', weight: 3 }, 笑: { mood: 'joy', weight: 3 },
  甜: { mood: 'joy', weight: 2 }, 幸: { mood: 'joy', weight: 3 },
  福: { mood: 'joy', weight: 2 }, 美: { mood: 'joy', weight: 2 },
  暖: { mood: 'warmth', weight: 2 }, 阳光: { mood: 'joy', weight: 3 },
  盛: { mood: 'joy', weight: 1 }, 欣: { mood: 'joy', weight: 2 },
  悦: { mood: 'joy', weight: 3 },
  静: { mood: 'peace', weight: 3 }, 安: { mood: 'peace', weight: 2 },
  宁: { mood: 'peace', weight: 3 }, 淡: { mood: 'peace', weight: 2 },
  清: { mood: 'peace', weight: 2 }, 幽: { mood: 'peace', weight: 2 },
  柔: { mood: 'peace', weight: 2 }, 梦: { mood: 'peace', weight: 2 },
  闲: { mood: 'peace', weight: 2 }, 逸: { mood: 'peace', weight: 2 },
  禅: { mood: 'peace', weight: 3 }, 空: { mood: 'peace', weight: 2 },
  素: { mood: 'peace', weight: 1 }, 净: { mood: 'peace', weight: 1 },
  云: { mood: 'peace', weight: 1 }, 月: { mood: 'peace', weight: 1 },
  风: { mood: 'peace', weight: 1 }, 雨: { mood: 'peace', weight: 1 },
  雪: { mood: 'peace', weight: 1 }, 露: { mood: 'peace', weight: 1 },
  雾: { mood: 'peace', weight: 1 },
  忆: { mood: 'nostalgia', weight: 3 }, 怀: { mood: 'nostalgia', weight: 3 },
  念: { mood: 'nostalgia', weight: 2 }, 思念: { mood: 'nostalgia', weight: 3 },
  往昔: { mood: 'nostalgia', weight: 3 }, 曾经: { mood: 'nostalgia', weight: 2 },
  旧: { mood: 'nostalgia', weight: 2 }, 故: { mood: 'nostalgia', weight: 2 },
  故乡: { mood: 'nostalgia', weight: 3 }, 童年: { mood: 'nostalgia', weight: 3 },
  过去: { mood: 'nostalgia', weight: 1 }, 岁: { mood: 'nostalgia', weight: 1 },
  年: { mood: 'nostalgia', weight: 1 }, 老: { mood: 'nostalgia', weight: 1 },
  记: { mood: 'nostalgia', weight: 1 },
  怒: { mood: 'passion', weight: 3 }, 烈: { mood: 'passion', weight: 2 },
  暴: { mood: 'passion', weight: 2 }, 雷: { mood: 'passion', weight: 2 },
  火: { mood: 'passion', weight: 2 }, 炎: { mood: 'passion', weight: 1 },
  热血: { mood: 'passion', weight: 3 }, 壮: { mood: 'passion', weight: 2 },
  志: { mood: 'passion', weight: 2 }, 慷慨: { mood: 'passion', weight: 3 },
  激昂: { mood: 'passion', weight: 3 }, 战: { mood: 'passion', weight: 2 },
  斗: { mood: 'passion', weight: 2 }, 胜: { mood: 'passion', weight: 1 },
  冲: { mood: 'passion', weight: 1 },
  秘: { mood: 'mystery', weight: 3 }, 谜: { mood: 'mystery', weight: 3 },
  疑: { mood: 'mystery', weight: 2 }, 恐: { mood: 'mystery', weight: 2 },
  怖: { mood: 'mystery', weight: 3 }, 鬼: { mood: 'mystery', weight: 3 },
  怪: { mood: 'mystery', weight: 2 }, 异: { mood: 'mystery', weight: 2 },
  幻: { mood: 'mystery', weight: 1 }, 冥: { mood: 'mystery', weight: 2 },
  魂: { mood: 'mystery', weight: 1 },
  爱: { mood: 'warmth', weight: 3 }, 情: { mood: 'warmth', weight: 2 },
  母: { mood: 'warmth', weight: 2 }, 父: { mood: 'warmth', weight: 2 },
  家: { mood: 'warmth', weight: 2 }, 友: { mood: 'warmth', weight: 2 },
  亲: { mood: 'warmth', weight: 2 }, 恩: { mood: 'warmth', weight: 2 },
  侣: { mood: 'warmth', weight: 3 }, 伴: { mood: 'warmth', weight: 2 },
  护: { mood: 'warmth', weight: 1 }, 宠: { mood: 'warmth', weight: 2 },
  // English keywords — sorrow
  sad: { mood: 'sorrow', weight: 3 }, sorrow: { mood: 'sorrow', weight: 3 },
  cry: { mood: 'sorrow', weight: 3 }, tears: { mood: 'sorrow', weight: 3 },
  pain: { mood: 'sorrow', weight: 2 }, grief: { mood: 'sorrow', weight: 3 },
  loss: { mood: 'sorrow', weight: 2 }, mourn: { mood: 'sorrow', weight: 3 },
  // English keywords — loneliness
  lonely: { mood: 'loneliness', weight: 3 }, alone: { mood: 'loneliness', weight: 2 },
  solitude: { mood: 'loneliness', weight: 3 }, isolation: { mood: 'loneliness', weight: 2 },
  empty: { mood: 'loneliness', weight: 2 }, abandoned: { mood: 'loneliness', weight: 3 },
  forgotten: { mood: 'loneliness', weight: 2 },
  // English keywords — joy
  happy: { mood: 'joy', weight: 3 }, joy: { mood: 'joy', weight: 3 },
  laugh: { mood: 'joy', weight: 3 }, smile: { mood: 'joy', weight: 3 },
  celebrate: { mood: 'joy', weight: 2 }, wonderful: { mood: 'joy', weight: 2 },
  delight: { mood: 'joy', weight: 3 }, cheerful: { mood: 'joy', weight: 2 },
  // English keywords — peace
  peace: { mood: 'peace', weight: 3 }, calm: { mood: 'peace', weight: 3 },
  serene: { mood: 'peace', weight: 3 }, tranquil: { mood: 'peace', weight: 3 },
  quiet: { mood: 'peace', weight: 2 }, still: { mood: 'peace', weight: 2 },
  gentle: { mood: 'peace', weight: 2 }, harmony: { mood: 'peace', weight: 2 },
  // English keywords — nostalgia
  nostalgia: { mood: 'nostalgia', weight: 3 }, nostalgic: { mood: 'nostalgia', weight: 3 },
  memory: { mood: 'nostalgia', weight: 2 }, remember: { mood: 'nostalgia', weight: 2 },
  childhood: { mood: 'nostalgia', weight: 3 }, reminisce: { mood: 'nostalgia', weight: 3 },
  past: { mood: 'nostalgia', weight: 2 }, longing: { mood: 'nostalgia', weight: 2 },
  // English keywords — passion
  passion: { mood: 'passion', weight: 3 }, angry: { mood: 'passion', weight: 3 },
  rage: { mood: 'passion', weight: 3 }, fury: { mood: 'passion', weight: 3 },
  fire: { mood: 'passion', weight: 2 }, intense: { mood: 'passion', weight: 2 },
  fierce: { mood: 'passion', weight: 2 }, battle: { mood: 'passion', weight: 2 },
  // English keywords — mystery
  mystery: { mood: 'mystery', weight: 3 }, mysterious: { mood: 'mystery', weight: 3 },
  dark: { mood: 'mystery', weight: 2 }, fear: { mood: 'mystery', weight: 2 },
  horror: { mood: 'mystery', weight: 3 }, ghost: { mood: 'mystery', weight: 3 },
  strange: { mood: 'mystery', weight: 2 }, eerie: { mood: 'mystery', weight: 3 },
  // English keywords — warmth
  love: { mood: 'warmth', weight: 3 }, warm: { mood: 'warmth', weight: 2 },
  heart: { mood: 'warmth', weight: 2 }, embrace: { mood: 'warmth', weight: 2 },
  family: { mood: 'warmth', weight: 2 }, friend: { mood: 'warmth', weight: 2 },
  tender: { mood: 'warmth', weight: 2 }, beloved: { mood: 'warmth', weight: 3 },
  kiss: { mood: 'warmth', weight: 2 }, hug: { mood: 'warmth', weight: 2 },
};

const THEME_CHARS: Record<string, string> = {
  spring: '春', summer: '夏', autumn: '秋', winter: '冬',
  rain: '雨', snow: '雪', wind: '风', moon: '月',
  flower: '花', mountain: '山', river: '江河湖海流',
  night: '夜晚暮宵', forest: '林树森木', road: '路道径途',
  home: '家屋房院', city: '城市街楼', sea: '海涛浪',
  sky: '天空星日', boat: '船舟帆', bird: '鸟燕雁雀',
  tea: '茶酒', music: '歌声琴笛', dream: '梦',
  light: '光阳灯烛', shadow: '影',
};

export function analyzeEmotion(text: string): EmotionResult {
  const scores: Record<string, number> = {};
  for (const p of MOOD_PROFILES) {
    scores[p.mood] = 0;
  }

  for (const [keyword, info] of Object.entries(KEYWORD_MOOD)) {
    const count = (text.match(new RegExp(keyword, 'g')) || []).length;
    if (count > 0) {
      scores[info.mood] += count * info.weight;
    }
  }

  let bestMood = 'peace';
  let bestScore = 0;
  for (const [mood, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestMood = mood;
    }
  }

  const profile = MOOD_PROFILES.find((p) => p.mood === bestMood) || MOOD_PROFILES[2];

  const themes: string[] = [];
  for (const [theme, chars] of Object.entries(THEME_CHARS)) {
    for (const ch of chars) {
      if (text.includes(ch)) {
        themes.push(theme);
        break;
      }
    }
  }

  const themeHint =
    themes.length > 0
      ? `with ${themes.slice(0, 3).join(' and ')} atmosphere, `
      : '';

  const prompt = [
    `${profile.style} instrumental music`,
    `${profile.tempo} tempo`,
    `featuring ${profile.instruments}`,
    `conveying a ${profile.mood} mood`,
  ]
    .filter(Boolean)
    .join(', ')
    + `, ${themeHint}no vocals, pure instrumental, suitable for storytelling`;

  return {
    emotion: profile.mood,
    style: profile.style,
    prompt,
  };
}

export interface MusicOptions {
  musicType?: 'instrumental' | 'song';
  musicMood?: string;
  musicGenre?: string;
  duration?: 'short' | 'medium' | 'long';
  lyricsMode?: 'story_as_lyrics' | 'ai_generated';
}

const GENRE_STYLES: Record<string, string> = {
  chinese_folk: 'Chinese folk style with pentatonic melodies, featuring erhu, guzheng, dizi, pipa, natural reverb',
  classical: 'Western classical style with orchestral arrangements, featuring strings, woodwinds, piano, dynamic range',
  pop: 'modern pop style with catchy melodies, featuring acoustic guitar, piano, light beats, radio-ready production',
  opera: 'Chinese opera style with dramatic vocals, featuring gong, erhu, suona, percussion',
  electronic: 'electronic ambient style, synth pads, digital texture, atmospheric sound design',
  jazz: 'jazz style, warm swing feel, double bass, piano trio, gentle brush drums',
  rock: 'rock style, electric guitar, driving drums, energetic and powerful',
  lofi: 'lo-fi hip-hop style, chill beats, vinyl crackle texture, warm tape saturation',
  rnb: 'R&B style, soulful and smooth, groovy bass, electric piano, modern production',
  world: 'world music style, ethnic fusion, diverse traditional instruments, cinematic atmosphere',
};

// Emotion → BPM + Key auto-mapping (MiniMax 2.6 matches BPM/Key >99%)
const MOOD_MUSIC_PARAMS: Record<string, { keys: string[]; bpm: string }> = {
  sorrow:      { keys: ['A minor', 'E minor', 'D minor'],          bpm: '60-75' },
  joy:         { keys: ['C major', 'G major', 'D major'],          bpm: '100-130' },
  peace:       { keys: ['D dorian', 'F major', 'C major'],         bpm: '50-70' },
  nostalgia:   { keys: ['G major', 'E minor', 'A minor'],          bpm: '70-90' },
  passion:     { keys: ['D minor', 'C minor', 'G minor'],          bpm: '100-140' },
  mystery:     { keys: ['E phrygian', 'B minor', 'F minor'],       bpm: '50-70' },
  warmth:      { keys: ['F major', 'C major', 'A major'],          bpm: '75-95' },
  loneliness:  { keys: ['A minor', 'E minor', 'D minor'],          bpm: '50-65' },
};

const DURATION_SECONDS: Record<string, number> = {
  short: 30,
  medium: 60,
  long: 120,
};

export const MOOD_LABELS: Record<string, string> = {
  sorrow: '悲伤',
  joy: '喜悦',
  passion: '激情',
  peace: '平静',
  mystery: '神秘',
  nostalgia: '怀旧',
  warmth: '温暖',
  loneliness: '孤独',
};

export async function generateMusic(text: string, options: MusicOptions = {}): Promise<{ audioUrl: string }> {
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!apiKey) {
    throw new Error('MiniMax API credentials not configured');
  }

  let profile: MoodProfile | undefined;

  if (options.musicMood) {
    profile = MOOD_PROFILES.find((p) => p.mood === options.musicMood);
  }

  if (!profile) {
    const detected = analyzeEmotion(text);
    profile = MOOD_PROFILES.find((p) => p.mood === detected.emotion) || MOOD_PROFILES[2];
  }

  const isInstrumental = options.musicType !== 'song';
  const genreHint = options.musicGenre ? GENRE_STYLES[options.musicGenre] || '' : '';

  // Auto-map emotion → BPM + Key (MiniMax 2.6 matching rate >99%)
  const musicParams = MOOD_MUSIC_PARAMS[profile.mood] || MOOD_MUSIC_PARAMS.peace;
  const randomKey = musicParams.keys[Math.floor(Math.random() * musicParams.keys.length)];
  const bpm = musicParams.bpm;

  // Duration mapping
  const durationSec = DURATION_SECONDS[options.duration || 'medium'] || 60;
  const moodCN = MOOD_LABELS[profile.mood] || profile.mood;

  // Build structured prompt with BPM/Key
  let prompt = [
    `${randomKey}, ${bpm} BPM`,
    `${profile.style} style, ${moodCN}情绪`,
    `${profile.tempo} tempo, ${profile.instruments}为主奏乐器`,
    genreHint,
    isInstrumental ? '纯器乐无人声' : '中文深情演唱，歌词富有诗意和故事感',
    `叙事配乐风格，${durationSec}秒时长`,
  ]
    .filter(Boolean)
    .join(', ');

  const payload: Record<string, unknown> = {
    model: 'music-2.6',
    prompt,
    is_instrumental: isInstrumental,
    output_format: 'url',
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3',
    },
  };

  if (!isInstrumental) {
    // song_ai mode: let MiniMax auto-generate structured lyrics based on story context
    if (options.lyricsMode !== 'story_as_lyrics') {
      payload.lyrics_optimizer = true;
      // Inject story context into prompt so MiniMax generates story-relevant lyrics
      prompt += `。故事主题：${text.slice(0, 300)}`;
    } else {
      // story_as_lyrics: use truncated text directly as lyrics
      payload.lyrics = text.slice(0, 300);
    }
  }

  // Re-assign prompt — must be AFTER lyrics_optimizer block (string is immutable, += creates new string)
  payload.prompt = prompt;

  // Longer timeout for longer music (120s may need 3-4 min during peak)
  const timeout = durationSec <= 60 ? 120000 : 240000;

  const response = await axios.post<MiniMaxMusicResponse>(
    `${process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1'}/music_generation`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout,
    }
  );

  if (response.data.base_resp && response.data.base_resp.status_code !== 0) {
    throw new Error(response.data.base_resp.status_msg || 'MiniMax API error');
  }

  if (!response.data.data?.audio) {
    throw new Error('No audio URL in response');
  }

  return { audioUrl: response.data.data.audio };
}

export async function downloadMusicFile(fileUrl: string, storyId: number): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!apiKey) {
    throw new Error('MiniMax API credentials not configured');
  }

  const musicDir = path.join(
    process.env.STORAGE_PATH || path.join(process.cwd(), 'storage'),
    'music'
  );

  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filePath = path.join(musicDir, `music_${storyId}_${timestamp}.mp3`);

  const fileResponse = await axios.get(fileUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    responseType: 'arraybuffer',
  });

  fs.writeFileSync(filePath, Buffer.from(fileResponse.data));

  return filePath;
}

/** Build an AI image prompt from story analysis */
export function buildCoverPrompt(tone: string | null, tags: string[] | null, text: string): string {
  const moodMap: Record<string, string> = {
    sorrow: '悲伤', joy: '喜悦', passion: '激情', peace: '平静',
    mystery: '神秘', nostalgia: '怀旧', warmth: '温暖', loneliness: '孤独',
  };
  const moodCN = tone && moodMap[tone] ? moodMap[tone] : tone || '平静';

  const tagPart = tags && tags.length > 0 ? tags.join('、') : '';
  const textSnippet = text.slice(0, 400);

  return [
    '中国水墨画风格插画，意境深远，留白构图，',
    `基调：${moodCN}`,
    tagPart ? `，元素：${tagPart}` : '',
    `，意境：${textSnippet}，`,
    '柔和光线，雅致色调，适合文学故事封面',
  ].join('');
}

/** Generate cover image via MiniMax Image-01 */
export async function generateCoverImage(prompt: string): Promise<{ imageUrl: string }> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MiniMax API credentials not configured');

  const baseUrl = process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1';

  const payload = {
    model: 'image-01',
    prompt,
    n: 1,
    aspect_ratio: '1:1',
    response_format: 'url',
  };

  const response = await axios.post<{
    data?: { image_urls?: string[] };
    base_resp?: { status_code: number; status_msg: string };
  }>(`${baseUrl}/image_generation`, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  if (response.data.base_resp && response.data.base_resp.status_code !== 0) {
    throw new Error(response.data.base_resp.status_msg || 'MiniMax image API error');
  }

  const imageUrl = response.data.data?.image_urls?.[0];
  if (!imageUrl) throw new Error('No image URL in response');

  return { imageUrl };
}

/** Photo inspiration — analyze uploaded image via MiniMax VLM */
export async function analyzePhotoImage(imageBase64: string): Promise<{
  description: string;
  mood: string;
  elements: string;
  inspiration: string;
}> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MiniMax API credentials not configured');

  const baseUrl = process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1';

  const prompt = [
    '请分析这张照片，用中文给出：',
    '1. 照片描述（30字内）',
    '2. 情绪基调（如喜悦/悲伤/平静/孤独/温暖等，一个词）',
    '3. 场景元素（用逗号分隔的关键词，如 黄昏,海边,孤影）',
    '4. 灵感故事开头（50字内，直接是故事正文）',
    '请严格按以下JSON格式回复（不要加任何解释）：',
    '{"description":"...","mood":"...","elements":"...","inspiration":"..."}',
  ].join('\n');

  const response = await axios.post<{
    content?: string;
    base_resp?: { status_code: number; status_msg: string };
  }>(`${baseUrl}/coding_plan/vlm`, {
    model: 'vlm',
    prompt,
    image_url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
  }, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  if (response.data.base_resp && response.data.base_resp.status_code !== 0) {
    throw new Error(response.data.base_resp.status_msg || 'MiniMax VLM API error');
  }

  const content = response.data.content || '';
  // Parse JSON from response (may be wrapped in markdown)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse VLM response');

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    description: parsed.description || '',
    mood: parsed.mood || 'peace',
    elements: parsed.elements || '',
    inspiration: parsed.inspiration || '',
  };
}
