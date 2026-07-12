import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { apiService } from '../services/api';
import './MessagesPage.css';

interface Conversation {
  id: number;
  nickname: string;
  avatar: string | null;
  last_content: string;
  last_time: string;
  unread: number;
}

export function MessagesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiService.clientGet('/messages')
      .then((d: any) => setConversations(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="msgs-page"><div className="loading">{t('common.loading')}</div></div>;

  const formatTime = (ts: string): string => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="msgs-page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => navigate('/')} aria-label={t('common.back')}>
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{t('msg.title')}</h1>
      </header>

      <main className="msgs-content">
        {conversations.length === 0 ? (
          <div className="empty">
            <p className="empty-title">{t('msg.noConversations')}</p>
          </div>
        ) : (
          <div className="msg-list">
            {conversations.map((c, i) => (
              <Link key={c.id} to={'/messages/' + c.id} className="msg-item"
                style={{ animationDelay: `${Math.min(i * 0.04, 0.6)}s` }}>
                <div className="msg-avatar">{c.nickname?.charAt(0) || '?'}</div>
                <div className="msg-info">
                  <div className="msg-top">
                    <span className="msg-name">{c.nickname}</span>
                    <span className="msg-time">{formatTime(c.last_time)}</span>
                  </div>
                  <div className="msg-bottom">
                    <span className="msg-preview">{c.last_content?.slice(0, 40) || ''}</span>
                    {c.unread > 0 && <span className="msg-badge">{c.unread}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
