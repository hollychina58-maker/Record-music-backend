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
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  async getStories(options?: { language?: string | null; countryCode?: string | null }): Promise<Story[]> {
    const parts: string[] = [];
    if (options?.language) parts.push(`language=${encodeURIComponent(options.language)}`);
    if (options?.countryCode) parts.push(`countryCode=${encodeURIComponent(options.countryCode)}`);
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
    options?: { musicType?: string; musicMood?: string; musicGenre?: string }
  ): Promise<{ id: number; status: string; filePath: string; remainingFreeCount?: number; subscriptionRemaining?: number | null }> {
    const response = await this.client.post<{ data: { id: number; status: string; filePath: string; remainingFreeCount?: number; subscriptionRemaining?: number | null } }>(
      '/music/generate',
      { storyId, text, ...options },
      { timeout: 180000 }
    );
    return response.data.data;
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
    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE_URL}/music/${musicId}/stream?download=1`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Download failed');
    }

    const blob = await response.blob();
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
