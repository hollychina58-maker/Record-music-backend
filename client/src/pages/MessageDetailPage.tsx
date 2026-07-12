import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';
import './MessageDetailPage.css';

interface Message {
  id: number;
  from_user_id: number;
  to_user_id: number;
  content: string;
  is_read: number;
  created_at: string;
  from_nickname: string;
}

export function MessageDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const currentUser = useAuthStore(s => s.user);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [sending, setSending] = useState(false);
  const [otherNickname, setOtherNickname] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const otherId = parseInt(userId || '0');

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [userId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadMessages = async () => {
    try {
      const d: any = await apiService.clientGet('/messages/' + otherId + '?limit=30');
      setMessages(d.data ?? []);
      setIsBlocked(d.isBlocked ?? false);
      if (d.data?.length > 0) {
        const last = d.data[d.data.length - 1];
        setOtherNickname(last.from_user_id === currentUser?.id ? last.to_nickname : last.from_nickname);
      } else {
        // Get nickname from profile
        try {
          const p: any = await apiService.clientGet('/users/' + otherId + '/profile');
          setOtherNickname(p.data?.nickname || '');
        } catch { /* */ }
      }
    } catch { /* */ }
    finally { setLoading(false); }
  };

  const handleSend = async () => {
    if (!input.trim() || sending || isBlocked) return;
    if (input.trim().length > 2000) {
      // Max length constraint
      return;
    }
    setSending(true);
    try {
      await apiService.clientPost('/messages', { toUserId: otherId, content: input.trim() });
      setInput('');
      loadMessages();
    } catch (err: any) {
      if (err?.response?.data?.code === 'blocked') {
        setIsBlocked(true);
      }
    }
    finally { setSending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Mark as read
  useEffect(() => {
    apiService.clientPost('/messages/' + otherId + '/read').catch(() => {});
  }, [otherId, messages.length]);

  if (loading) return <div className="chat-page"><div className="loading">{t('common.loading')}</div></div>;

  return (
    <div className="chat-page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => navigate('/messages')} aria-label={t('common.back')}>
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{otherNickname || t('msg.chat')}</h1>
      </header>

      <div className="chat-messages">
        {messages.map((m, i) => {
          const isMine = m.from_user_id === currentUser?.id;
          return (
            <div key={m.id}
              className={`chat-bubble-wrap${isMine ? ' chat-bubble-wrap--mine' : ''}`}
              style={{ animationDelay: `${Math.min(i * 0.05, 0.8)}s` }}>
              <div className={`chat-bubble${isMine ? ' chat-bubble--mine' : ''}`}>
                {m.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        {isBlocked ? (
          <p className="chat-blocked-hint">{t('msg.blocked')}</p>
        ) : (
          <>
            <textarea
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('msg.placeholder')}
              maxLength={2000}
              rows={1}
            />
            <button className="chat-send-btn" onClick={handleSend} disabled={sending || !input.trim()}>
              {t('msg.send')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
