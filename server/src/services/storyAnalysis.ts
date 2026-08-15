import axios from 'axios';
import { analyzeEmotion } from './minimax.js';

const MINIMAX_CHAT_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2';
const VALID_TONES = ['sorrow', 'joy', 'passion', 'peace', 'mystery', 'nostalgia', 'warmth', 'loneliness'] as const;
type ToneKey = typeof VALID_TONES[number];

const TONE_LABELS: Record<ToneKey, string> = {
  sorrow: '悲伤', joy: '喜悦', passion: '激情', peace: '平静',
  mystery: '神秘', nostalgia: '怀旧', warmth: '温暖', loneliness: '孤独',
};

async function callMinimaxChat(messages: Array<{ role: string; content: string }>, maxTokens = 512): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY not configured');

  const response = await axios.post(
    MINIMAX_CHAT_URL,
    {
      model: 'abab6.5s-chat',
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 12000,
    }
  );

  const choice = response.data?.choices?.[0];
  return choice?.message?.content || choice?.text || '';
}

export async function analyzeStory(content: string): Promise<{ tone: string; tags: string[] }> {
  try {
    const truncated = content.slice(0, 1500);
    const reply = await callMinimaxChat([
      {
        role: 'system',
        content: `You are a literary analysis assistant. Analyze the story and return a strict JSON format, nothing else.
tone must be one of: sorrow/joy/passion/peace/mystery/nostalgia/warmth/loneliness
tags: 2 to 4 SHORT English tag keywords (max 4 chars each), reflecting themes, imagery, or mood.
Output ONLY JSON in this exact format: {"tone":"sorrow","tags":["farewell","moonlight","longing"]}`,
      },
      { role: 'user', content: truncated },
    ]);

    const jsonMatch = reply.match(/\{[^}]+\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as { tone?: string; tags?: unknown };
    const tone = VALID_TONES.includes(parsed.tone as ToneKey) ? parsed.tone! : null;
    const tags = Array.isArray(parsed.tags)
      ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 4)
      : [];

    if (!tone) throw new Error(`Invalid tone: ${parsed.tone}`);
    return { tone, tags };
  } catch (err) {
    console.warn('[StoryAnalysis] analyzeStory failed, falling back to keyword analysis:', err instanceof Error ? err.message : err);
    const fallbackTone = analyzeEmotion(content).emotion;
    return { tone: fallbackTone, tags: [] };
  }
}

export async function extractLyrics(content: string, tone: string): Promise<string> {
  try {
    const toneLabel = TONE_LABELS[tone as ToneKey] || tone;
    const truncated = content.slice(0, 1500);
    const lyrics = await callMinimaxChat(
      [
        {
          role: 'system',
          content: `你是一个词作家。将用户的故事改写为适合演唱的中文歌词，保留核心情感和意象。
基调是"${toneLabel}"，风格应与基调匹配。
格式：主歌A（4行）+ 副歌（4行）+ 主歌B（4行），共12行，每行不超过15字。
只输出歌词正文，不要标注"主歌""副歌"等段落名称，不要有其他说明文字。`,
        },
        { role: 'user', content: truncated },
      ],
      400
    );

    const trimmed = lyrics.trim();
    if (trimmed.length < 10) throw new Error('Lyrics too short');
    return trimmed.slice(0, 400);
  } catch (err) {
    console.warn('[StoryAnalysis] extractLyrics failed, falling back to raw truncation:', err instanceof Error ? err.message : err);
    return content.slice(0, 200);
  }
}
