import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { apiService } from '../services/api';
import './AuthorSidebar.css';

interface AuthorInfo {
  id: number;
  nickname: string;
  avatar: string | null;
  bio: string | null;
  story_count: number;
  created_at: string;
}

interface AuthorStory {
  id: number;
  title: string;
  created_at: string;
}

export function AuthorSidebar({ authorId, authorNickname, excludeStoryId }: { authorId: number; authorNickname: string; excludeStoryId?: number }) {
  const { t } = useLanguage();
  const [author, setAuthor] = useState<AuthorInfo | null>(null);
  const [stories, setStories] = useState<AuthorStory[]>([]);

  useEffect(() => {
    if (!authorId) return;
    apiService.clientGet('/users/' + authorId + '/profile')
      .then(d => setAuthor(d.data as AuthorInfo))
      .catch(() => {});
    apiService.clientGet('/users/' + authorId + '/stories?limit=4')
      .then(d => setStories((d.data as AuthorStory[]).filter(s => s.title && s.id !== excludeStoryId).slice(0, 3)))
      .catch(() => {});
  }, [authorId]);

  if (!author) return null;

  // Exclude current story — StoryDetailPage passes the current story ID via context, but we don't have it here
  // We just show up to 3 stories; if the current story is included, the user can just see it

  return (
    <aside className="author-sidebar">
      {/* Author card */}
      <div className="author-card">
        <Link to={'/user/' + authorId} className="author-avatar-placeholder">
          {authorNickname?.charAt(0) || '?'}
        </Link>
        <Link to={'/user/' + authorId} className="author-name">{authorNickname}</Link>
        {author.bio && <p className="author-bio">{author.bio}</p>}
        <div className="author-meta">
          <span>{t('author.storyCount', { count: author.story_count })}</span>
        </div>
        <div className="author-actions">
          {/* Follow button — functional in Phase B */}
          <button className="sidebar-btn sidebar-btn--follow" disabled title={t('follow.comingSoon')}>
            {t('follow.follow')}
          </button>
          {/* Message button — functional in Phase C */}
          <button className="sidebar-btn sidebar-btn--msg" disabled title={t('msg.comingSoon')}>
            ✉
          </button>
        </div>
      </div>

      {/* Other stories */}
      {stories.length > 0 && (
        <div className="author-stories">
          <h4 className="author-stories-title">{t('author.otherStories')}</h4>
          {stories.map(s => (
            <Link key={s.id} to={'/story/' + s.id} className="author-story-link">
              <span className="author-story-title">{s.title}</span>
              <span className="author-story-date">
                {new Date(s.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
