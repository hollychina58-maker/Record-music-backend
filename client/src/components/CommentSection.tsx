import { useState, useEffect } from 'react';
import { Comment } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n/LanguageContext';
import { LikeButton } from './LikeButton';
import './CommentSection.css';

interface CommentSectionProps {
  storyId: number;
  isBurned?: boolean;
  commentLikes?: Record<number, boolean>;
}

export function CommentSection({ storyId, isBurned, commentLikes = {} }: CommentSectionProps) {
  const user = useAuthStore((s) => s.user);
  const { t } = useLanguage();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const authorName = user?.nickname || t('comment.guest');

  useEffect(() => {
    loadComments();
  }, [storyId]);

  const loadComments = async () => {
    try {
      const { apiService } = await import('../services/api');
      const data = await apiService.getComments(storyId);
      setComments(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitError(false);
    setSubmitting(true);
    try {
      const { apiService } = await import('../services/api');
      const newComment = await apiService.addComment(storyId, authorName, content.trim());
      setComments((prev) => [newComment, ...prev]);
      setContent('');
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: number) => {
    try {
      const { apiService } = await import('../services/api');
      await apiService.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // Removal from list is optimistic; show toast on failure is best
    }
  };

  if (loading) {
    return <div className="comment-section"><p className="cmt-loading">{t('comment.loading')}</p></div>;
  }

  if (loadError) {
    return <div className="comment-section"><p className="cmt-empty">{t('common.error')}</p></div>;
  }

  return (
    <div className="comment-section">
      <h3 className="cmt-heading">{t('comment.heading')}</h3>

      {isBurned && comments.length > 0 && (
        <div className="cmt-burned-notice">
          <p>{comments[0].content}</p>
        </div>
      )}

      {!isBurned && (
        <form className="cmt-form" onSubmit={handleSubmit}>
          <span className="cmt-author-badge">
            {user ? user.nickname : t('comment.guest')}
          </span>
          <div className="cmt-input-row">
            <textarea
              placeholder={t('comment.placeholder')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="cmt-textarea"
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="cmt-actions">
            <span className="cmt-hint">{content.length}/500</span>
            <button
              type="submit"
              className="cmt-submit"
              disabled={submitting || !content.trim()}
            >
              {submitting ? t('comment.submitting') : t('comment.submit')}
            </button>
            {submitError && <p className="cmt-submit-error">{t('common.error')}</p>}
          </div>
        </form>
      )}

      <div className="cmt-list">
        {!isBurned && comments.length === 0 && (
          <p className="cmt-empty">{t('comment.empty')}</p>
        )}
        {!isBurned &&
          comments.map((comment) => (
            <div key={comment.id} className="cmt-item">
              <div className="cmt-meta">
                <span className="cmt-author">{comment.author_name}</span>
                <span className="cmt-date">
                  {new Date(comment.created_at).toLocaleDateString('zh-CN')}
                </span>
                <button
                  type="button"
                  className="cmt-delete"
                  onClick={() => handleDelete(comment.id)}
                  aria-label={t('comment.delete')}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </div>
              <p className="cmt-text">{comment.content}</p>
                <div className="cmt-footer">
                  <LikeButton
                    targetType="comment"
                    targetId={comment.id}
                    initialLiked={!!commentLikes[comment.id]}
                    initialCount={comment.like_count || 0}
                  />
                </div>
            </div>
          ))}
      </div>
    </div>
  );
}
