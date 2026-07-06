import axios, { AxiosInstance } from 'axios';
import { getAuthHeader, useAuthStore } from '../stores/authStore';

const API_BASE_URL = `${import.meta.env.VITE_API_URL || ''}/api`;

export interface Story {
  id: number;
  user_id: number;
  title: string;
  content: string;
  metadata: string | null;
  language: string;
  country_code: string | null;
  created_at: string;
  isBurned?: boolean;
  comment_count?: number;
  like_count?: number;
  tags: string[] | null;
  tone: string | null;
  author_nickname: string | null;
  music_id: number | null;
  music_status: 'pending' | 'completed' | 'failed' | null;
  music_type: 'instrumental' | 'song' | null;
  cover_image: string | null;
  cover_prompt: string | null;
}

export interface Comment {
  id: number;
  story_id: number;
  author_name: string;
  content: string;
  is_hidden: number;
  like_count?: number;
  created_at: string;
}

export interface CreateStoryInput {
  userId: number;
  title: string;
  content: string;
  metadata?: string;
}

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      const authHeader = getAuthHeader();
      Object.assign(config.headers, authHeader);
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          // Only redirect if the user was logged in (expired token).
          // Guests browsing public content may hit 401 on auth-required endpoints — that's fine.
          if (useAuthStore.getState().isAuthenticated) {
            useAuthStore.getState().logout();
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async getStories(options?: { countryCode?: string | null; onlyMine?: boolean; tab?: string; tag?: string }): Promise<Story[]> {
    const parts: string[] = [];
    if (options?.countryCode) parts.push(`countryCode=${encodeURIComponent(options.countryCode)}`);
    if (options?.onlyMine) parts.push('onlyMine=true');
    if (options?.tab) parts.push(`tab=${encodeURIComponent(options.tab)}`);
    const qs = parts.length > 0 ? '?' + parts.join('&') : '';
    const response = await this.client.get<{ data: Story[] }>('/story' + qs);
    return response.data.data;
  }

  async getStoryById(id: number): Promise<Story> {
    const response = await this.client.get<{ data: Story }>('/story/' + id);
    return response.data.data;
  }

  async createStory(input: CreateStoryInput): Promise<Story> {
    const response = await this.client.post<{ data: Story }>('/story', input);
    return response.data.data;
  }

  async deleteStory(id: number): Promise<void> {
    await this.client.delete('/story/' + id);
  }

  async getComments(storyId: number): Promise<Comment[]> {
    const response = await this.client.get<{ data: Comment[] }>('/stories/' + storyId + '/comments');
    return response.data.data;
  }

  async addComment(storyId: number, _authorName: string, content: string): Promise<Comment> {
    const response = await this.client.post<{ data: Comment }>('/stories/' + storyId + '/comments', {
      content,
    });
    return response.data.data;
  }

  async deleteComment(id: number): Promise<void> {
    await this.client.delete('/comments/' + id);
  }

  async shareStory(id: number): Promise<{ shareLink: string; storyId: number }> {
    const response = await this.client.post<{ data: { shareLink: string; storyId: number } }>('/stories/' + id + '/share');
    return response.data.data;
  }

  async burnStory(id: number): Promise<Story> {
    const response = await this.client.post<{ data: Story }>('/stories/' + id + '/burn');
    return response.data.data;
  }

  async generateCover(storyId: number): Promise<{ coverStatus: string }> {
    const response = await this.client.post<{ data: { coverStatus: string } }>('/story/' + storyId + '/generate-cover');
    return response.data.data;
  }

  async deleteCover(storyId: number): Promise<void> {
    await this.client.delete('/story/' + storyId + '/cover');
  }

  async analyzePhoto(imageBase64: string): Promise<{
    description: string; mood: string; elements: string; inspiration: string;
  }> {
    const response = await this.client.post<{ data: { description: string; mood: string; elements: string; inspiration: string } }>(
      '/photo-inspiration', { image: imageBase64 }, { timeout: 45000 }
    );
    return response.data.data;
  }

  async toggleLike(targetType: 'story' | 'comment', targetId: number): Promise<{ liked: boolean; likeCount: number }> {
    const response = await this.client.post<{ liked: boolean; likeCount: number }>('/likes', { targetType, targetId });
    return response.data;
  }

  async getLikeInfo(storyId: number): Promise<{
    storyLikes: number;
    storyLiked: boolean;
    commentLikes: Record<number, boolean>;
  }> {
    const response = await this.client.get<{ data: {
      storyLikes: number;
      storyLiked: boolean;
      commentLikes: Record<number, boolean>;
    } }>('/likes/story/' + storyId);
    return response.data.data;
  }

  async getMyProfile(): Promise<{
    id: number; email: string; nickname: string; avatar: string | null;
    bio: string | null; role: string; freeMusicCount: number; createdAt: string;
    subscription: { planName: string; planType: string; expiresAt: string; musicRemaining: number | null } | null;
    stats: { storyCount: number; totalLikes: number; musicCount: number };
  }> {
    const response = await this.client.get<{ success: boolean; data: any }>('/users/me/profile');
    return response.data.data;
  }

  async updateProfile(data: { nickname?: string; bio?: string }): Promise<void> {
    await this.client.put('/users/me/profile', data);
  }

  async getMyStories(): Promise<Story[]> {
    const response = await this.client.get<{ success: boolean; data: Story[] }>('/users/me/stories');
    return response.data.data;
  }

  async getLikedStories(): Promise<Story[]> {
    const response = await this.client.get<{ success: boolean; data: Story[] }>('/users/me/liked-stories');
    return response.data.data;
  }

  async getMyStats(): Promise<{
    storyCount: number; totalLikes: number; musicCount: number;
    commentCount: number; recentMusicCount: number;
  }> {
    const response = await this.client.get<{ success: boolean; data: any }>('/users/me/stats');
    return response.data.data;
  }

  async generateMusic(
    storyId: number,
    text: string,
    options?: { musicType?: string; musicGenre?: string; lyricsMode?: 'story_as_lyrics' | 'ai_generated'; duration?: 'short' | 'medium' | 'long'; musicMood?: string }
  ): Promise<{ musicId: number; status: string; freeMusicCount: number | null; subscriptionRemaining: number | null }> {
    const response = await this.client.post<{ data: { musicId: number; status: string; freeMusicCount: number | null; subscriptionRemaining: number | null } }>(
      '/music/generate',
      { storyId, text, ...options },
      { timeout: 15000 }
    );
    return response.data.data;
  }

  async pollMusicStatus(musicId: number): Promise<{ id: number; status: string; filePath: string | null }> {
    const response = await this.client.get<{ id: number; status: string; filePath: string | null }>(
      '/music/status/' + musicId
    );
    return response.data;
  }

  async getMusicByStory(storyId: number): Promise<{ id: number; status: string; filePath: string | null }[]> {
    const response = await this.client.get<{ data: { id: number; status: string; filePath: string | null }[] }>('/music/by-story/' + storyId);
    return response.data.data;
  }

  async clientGet(path: string): Promise<any> {
    const response = await this.client.get(path);
    return response.data;
  }

  async clientPost(path: string, body?: unknown): Promise<any> {
    const response = await this.client.post(path, body);
    return response.data;
  }

  async clientPut(path: string, body?: unknown): Promise<any> {
    const response = await this.client.put(path, body);
    return response.data;
  }

  async clientDelete(path: string): Promise<any> {
    const response = await this.client.delete(path);
    return response.data;
  }

  async downloadMusic(musicId: number, fileName?: string): Promise<void> {
    // Use /download endpoint (auth required, returns file or redirect)
    // Token goes in Authorization header via axios interceptor — not in URL
    const response = await this.client.get(
      `/music/${musicId}/download`,
      { responseType: 'blob' }
    );
    const blob = new Blob([response.data]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || `music_${musicId}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const apiService = new ApiService();
