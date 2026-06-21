import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { apiService } from '../services/api';
import './PhotoInspirationPage.css';

interface AnalysisResult {
  description: string;
  mood: string;
  elements: string;
  inspiration: string;
}

export function PhotoInspirationPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setError(null);
    setResult(null);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setAnalyzing(true);
    setError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      const data = await apiService.analyzePhoto(base64);
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || '分析失败，请重试');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleStartWriting = () => {
    if (!result) return;
    navigate(`/create?inspiration=${encodeURIComponent(result.inspiration)}&mood=${encodeURIComponent(result.mood)}&elements=${encodeURIComponent(result.elements)}`);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const moodLabelMap: Record<string, string> = {
    sorrow: '悲伤', joy: '喜悦', peace: '平静', nostalgia: '怀旧',
    warmth: '温暖', loneliness: '孤独', passion: '激情', mystery: '神秘',
    悲伤: '悲伤', 喜悦: '喜悦', 平静: '平静', 怀旧: '怀旧',
    温暖: '温暖', 孤独: '孤独', 激情: '激情', 神秘: '神秘',
  };

  return (
    <div className="inspiration-page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <svg viewBox="0 0 24 24" className="back-icon">
            <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <h1 className="page-title">{t('inspiration.title')}</h1>
        <div className="header-spacer" />
      </header>

      <main className="inspiration-main">
        <p className="inspiration-subtitle">{t('inspiration.subtitle')}</p>

        {!previewUrl && (
          <label
            className="upload-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              hidden
            />
            <div className="upload-zone-content">
              <svg viewBox="0 0 24 24" className="upload-icon" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span className="upload-text">{t('inspiration.upload')}</span>
              <span className="upload-hint">JPG / PNG / WebP</span>
            </div>
          </label>
        )}

        {previewUrl && (
          <div className="preview-section">
            <img src={previewUrl} alt="预览" className="preview-image" />

            {!result && !analyzing && (
              <div className="preview-actions">
                <button className="ink-btn ink-btn--outline" onClick={handleReset}>{t('inspiration.reupload')}</button>
                <button className="ink-btn ink-btn--primary" onClick={handleAnalyze}>{t('inspiration.analyze')}</button>
              </div>
            )}

            {analyzing && (
              <div className="analyzing-indicator">
                <div className="analyzing-spinner" />
                <span>{t('inspiration.analyzing')}</span>
              </div>
            )}

            {error && (
              <div className="analyze-error">
                <span>{error}</span>
                <button className="ink-btn ink-btn--outline" onClick={handleReset}>{t('inspiration.reupload')}</button>
              </div>
            )}

            {result && (
              <div className="analysis-result">
                <div className="result-cards">
                  <div className="result-card">
                    <span className="result-label">{t('inspiration.description')}</span>
                    <span className="result-value">{result.description}</span>
                  </div>
                  <div className="result-card">
                    <span className="result-label">{t('inspiration.mood')}</span>
                    <span className="result-value result-tag">{moodLabelMap[result.mood] || result.mood}</span>
                  </div>
                  <div className="result-card">
                    <span className="result-label">{t('inspiration.elements')}</span>
                    <span className="result-value">{result.elements}</span>
                  </div>
                </div>

                <div className="inspiration-block">
                  <span className="result-label">💡 {t('inspiration.inspiration')}</span>
                  <p className="inspiration-text">{result.inspiration}</p>
                </div>

                <div className="result-actions">
                  <button className="ink-btn ink-btn--outline" onClick={handleReset}>{t('inspiration.reupload')}</button>
                  <button className="ink-btn ink-btn--primary" onClick={handleStartWriting}>
                    {t('inspiration.startWriting')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
