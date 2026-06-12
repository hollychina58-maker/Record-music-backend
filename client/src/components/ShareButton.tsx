import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

interface ShareButtonProps {
  storyId: number;
  storyTitle: string;
  storyTags: string[] | null;
  disabled?: boolean;
}

const WechatIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.38 1.417a.295.295 0 0 0 .418.331l1.627-.826a.59.59 0 0 1 .525-.032c.955.389 2.004.607 3.086.607.168 0 .334-.005.5-.013a6.24 6.24 0 0 1-.087-.874c0-2.84 2.687-5.155 5.977-5.155.127 0 .253.003.378.01C14.307 8.18 11.762 5.23 8.69 5.23c-.672 0-1.329.093-1.957.27a.59.59 0 0 1-.495-.077L4.667 4.55a.295.295 0 0 0-.425.303l.33 1.733a.59.59 0 0 1-.151.512C2.95 8.507 2.07 9.938 2.07 11.5c0 1.199.637 2.322 1.66 3.082a.295.295 0 0 1 .08.376l-.26.513a.147.147 0 0 0 .21.175l1.092-.636a.295.295 0 0 1 .305.015 5.09 5.09 0 0 0 2.474.705c.623 0 1.23-.114 1.805-.33a5.89 5.89 0 0 1-.411-1.366 5.97 5.97 0 0 1 3.783-3.236 4.55 4.55 0 0 0-3.36-1.33c-.768 0-1.486.17-2.132.47a.295.295 0 0 1-.243.006L6.13 11.192a.147.147 0 0 1-.196-.185l.286-.838a.295.295 0 0 0-.047-.284C5.035 8.673 4.484 7.31 4.484 5.85c0-2.348 2.305-4.25 5.152-4.25 2.846 0 5.152 1.902 5.152 4.25 0 .21-.02.418-.057.622a5.955 5.955 0 0 1 1.28-.125c.168 0 .335.006.5.018C16.189 3.98 12.778 2.188 8.691 2.188z" />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

export function ShareButton({ storyId, storyTitle, storyTags, disabled }: ShareButtonProps) {
  const { t } = useLanguage();
  const [showPanel, setShowPanel] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wechatCopied, setWechatCopied] = useState(false);

  const tagText = storyTags && storyTags.length > 0
    ? storyTags.map(tag => `#${tag}`).join(' ')
    : '';

  const buildShareText = (link: string) => {
    const parts = [storyTitle];
    if (tagText) parts.push(tagText);
    parts.push(link);
    return parts.join('\n');
  };

  const handleShare = async () => {
    if (disabled) return;
    try {
      const { apiService } = await import('../services/api');
      const data = await apiService.shareStory(storyId);
      setShareLink(data.shareLink);

      // Try native Web Share API first on mobile
      if (navigator.share) {
        try {
          await navigator.share({
            title: storyTitle,
            text: tagText,
            url: data.shareLink,
          });
          return;
        } catch {
          // User cancelled or API failed — show panel
        }
      }
      setShowPanel(true);
    } catch (error) {
      console.error('Failed to generate share link', error);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    const ok = await copyToClipboard(shareLink);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWechatShare = async () => {
    if (!shareLink) return;
    const ok = await copyToClipboard(shareLink);
    if (ok) {
      setWechatCopied(true);
      setTimeout(() => setWechatCopied(false), 4000);
    }
  };

  const openPlatform = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer,width=640,height=480');
  };

  const platforms = [
    {
      key: 'wechat',
      name: t('share.wechat'),
      color: '#07C160',
      icon: <WechatIcon />,
    },
    {
      key: 'twitter',
      name: 'X',
      color: '#0F1419',
      icon: <XIcon />,
      url: (link: string) =>
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(storyTitle + '\n' + tagText)}&url=${encodeURIComponent(link)}`,
    },
    {
      key: 'facebook',
      name: 'Facebook',
      color: '#1877F2',
      icon: <FacebookIcon />,
      url: (link: string) =>
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(storyTitle + ' ' + tagText)}`,
    },
    {
      key: 'whatsapp',
      name: 'WhatsApp',
      color: '#25D366',
      icon: <WhatsAppIcon />,
      url: (link: string) =>
        `https://api.whatsapp.com/send?text=${encodeURIComponent(buildShareText(link))}`,
    },
  ];

  return (
    <>
      <button
        type="button"
        className="share-btn"
        onClick={handleShare}
        disabled={disabled}
        aria-label={t('share.copyLink')}
      >
        <svg viewBox="0 0 24 24" className="share-icon" width="20" height="20">
          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" fill="currentColor" />
        </svg>
      </button>

      {showPanel && shareLink && (
        <div className="share-panel-overlay" onClick={() => setShowPanel(false)}>
          <div className="share-panel" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="share-panel-close"
              onClick={() => setShowPanel(false)}
              aria-label={t('common.back')}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* 故事标题 + 标签预览 */}
            <div className="share-preview">
              <p className="share-preview-title">{storyTitle}</p>
              {tagText && <p className="share-preview-tags">{tagText}</p>}
            </div>

            <h3 className="share-panel-title">{t('share.panelTitle')}</h3>

            <div className="share-platforms">
              {platforms.map(platform => (
                <button
                  key={platform.key}
                  type="button"
                  className={`share-platform-btn${platform.key === 'wechat' ? ' wechat-btn' : ''}`}
                  onClick={() => {
                    if (platform.key === 'wechat') {
                      handleWechatShare();
                    } else if (platform.url) {
                      openPlatform(platform.url(shareLink));
                    }
                  }}
                  style={{ '--platform-color': platform.color } as React.CSSProperties}
                >
                  {platform.icon}
                  <span>{platform.name}</span>
                </button>
              ))}
            </div>

            {wechatCopied && (
              <p className="share-wechat-hint">{t('share.wechatHint')}</p>
            )}

            <div className="share-link-container">
              <input
                type="text"
                readOnly
                value={shareLink}
                className="share-link-input"
                onClick={e => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                className={`share-copy-btn${copied ? ' copied' : ''}`}
                onClick={handleCopyLink}
              >
                {copied ? t('share.copied') : t('share.copyLink')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
