import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { useNotificationStore } from '../stores/notificationStore';
import { apiService } from '../services/api';
import './NotificationBell.css';

type Tab = 'stories' | 'messages';

export function NotificationBell() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('stories');
  const { unreadCount, notifications, setUnreadCount, setNotifications, markRead, markAllRead } = useNotificationStore();
  const bellRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [open]);

  // Fetch on open
  useEffect(() => {
    if (!open) return;
    apiService.clientGet('/notifications/unread-count').then((d: any) => setUnreadCount(d.count ?? 0)).catch(() => {});
    apiService.clientGet('/notifications?limit=20').then((d: any) => setNotifications(d.data ?? [])).catch(() => {});
  }, [open, setUnreadCount, setNotifications]);

  const handleMarkAll = async () => {
    await apiService.clientPost('/notifications/read-all').catch(() => {});
    markAllRead();
  };

  const notifLabel = (n: { type: string; actor_nickname?: string | null }): string => {
    const name = n.actor_nickname || '';
    switch (n.type) {
      case 'like_story': return name + ' ' + t('notif.likedStory');
      case 'comment_story': return name + ' ' + t('notif.commentedStory');
      case 'follow': return name + ' ' + t('notif.followedYou');
      case 'new_story': return t('notif.newStory', { author: name, title: '' });
      case 'new_message': return t('notif.newMessage', { from: name });
      default: return name;
    }
  };

  const handleClick = async (n: { id: number; type: string; source_id: number; actor_id?: number | null; is_read: number }) => {
    if (!n.is_read) {
      await apiService.clientPost('/notifications/' + n.id + '/read').catch(() => {});
      markRead(n.id);
    }
    setOpen(false);
    let target: string;
    switch (n.type) {
      case 'new_story': target = '/story/' + n.source_id; break;
      case 'like_story': target = '/story/' + n.source_id; break;
      case 'comment_story': target = '/story/' + n.source_id; break;
      case 'follow': target = '/user/' + (n.actor_id || n.source_id); break;
      case 'new_message': target = '/messages/' + (n.actor_id || n.source_id); break;
      default: target = '/story/' + n.source_id;
    }
    navigate(target);
  };

  const filtered = tab === 'stories'
    ? notifications.filter(n => ['new_story', 'like_story', 'comment_story', 'follow'].includes(n.type))
    : notifications.filter(n => n.type === 'new_message');

  const formatTime = (ts: string): string => {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return t('time.justNow');
    if (diff < 3600000) return Math.floor(diff / 60000) + t('time.minAgo');
    if (diff < 86400000) return Math.floor(diff / 3600000) + t('time.hrAgo');
    return Math.floor(diff / 86400000) + t('time.dayAgo');
  };

  return (
    <div className="notif-bell-wrap" ref={bellRef}>
      <button
        className={`nav-link notif-bell-btn${open ? ' notif-bell-btn--open' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label={t('notif.title')}
      >
        <span className="notif-bell-icon">🔔</span>
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" onClick={(e) => e.stopPropagation()}>
          {/* Tabs */}
          <div className="notif-tabs">
            <button className={`notif-tab${tab === 'stories' ? ' notif-tab--active' : ''}`} onClick={() => setTab('stories')}>
              {t('notif.tabStories')}
            </button>
            <button className={`notif-tab${tab === 'messages' ? ' notif-tab--active' : ''}`} onClick={() => setTab('messages')}>
              {t('notif.tabMessages')}
            </button>
          </div>

          {/* List */}
          <div className="notif-list">
            {filtered.length === 0 ? (
              <p className="notif-empty">{t('notif.empty')}</p>
            ) : (
              filtered.map(n => (
                <button
                  key={n.id}
                  className={`notif-item${!n.is_read ? ' notif-item--unread' : ''}`}
                  onClick={() => handleClick(n)}
                >
                  {!n.is_read && <span className="notif-dot" />}
                  <span className="notif-text">{notifLabel(n)}
                  </span>
                  <span className="notif-time">{formatTime(n.created_at)}</span>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="notif-footer">
              <button className="notif-read-all" onClick={handleMarkAll}>{t('notif.markAllRead')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
