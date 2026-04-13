import { useEffect, useState, useRef } from 'react';
import { getThemes, PptTheme } from '../utils/api';
import styles from './ThemePicker.module.css';
import { Loader2, Palette, Check } from 'lucide-react';

interface ThemePickerProps {
  /** 当前选中的主题 key（null 表示「自动」） */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onConfirm: (key: string | null) => void;
  onCancel: () => void;
}

export default function ThemePicker({ selectedKey, onSelect, onConfirm, onCancel }: ThemePickerProps) {
  const [themes, setThemes] = useState<PptTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getThemes()
      .then(data => { if (!cancelled) setThemes(data); })
      .catch(() => { if (!cancelled) setError('主题加载失败，请检查网络或重试。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 点击面板外部关闭
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onCancel]);

  const light = themes.filter(t => t.category === 'light');
  const dark  = themes.filter(t => t.category === 'dark');

  return (
    <div className={styles.overlay}>
      <div className={styles.panel} ref={ref}>
        {/* 头部 */}
        <div className={styles.header}>
          <Palette size={18} className={styles.headerIcon} />
          <span className={styles.headerTitle}>选择 PPT 主题</span>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loadingState}>
              <Loader2 size={24} className={styles.spin} />
              <p>加载主题中...</p>
            </div>
          ) : error ? (
            <div className={styles.errorState}>{error}</div>
          ) : (
            <>
              {/* 「自动」选项 */}
              <div className={styles.section}>
                <h4 className={styles.sectionLabel}>自动选择</h4>
                <div className={styles.chipGrid}>
                  <button
                    className={`${styles.autoChip} ${selectedKey === null ? styles.selected : ''}`}
                    onClick={() => onSelect(null)}
                    title="由后端按会话哈希自动决定主题"
                  >
                    {selectedKey === null && <Check size={12} className={styles.checkIcon} />}
                    <span>自动 (Auto)</span>
                    <span className={styles.autoHint}>后端智能分配</span>
                  </button>
                </div>
              </div>

              {/* 浅色主题 */}
              {light.length > 0 && (
                <div className={styles.section}>
                  <h4 className={styles.sectionLabel}>浅色主题</h4>
                  <div className={styles.chipGrid}>
                    {light.map(t => (
                      <ThemeChip
                        key={t.key}
                        theme={t}
                        isSelected={selectedKey === t.key}
                        onClick={() => onSelect(t.key)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 深色主题 */}
              {dark.length > 0 && (
                <div className={styles.section}>
                  <h4 className={styles.sectionLabel}>深色主题</h4>
                  <div className={styles.chipGrid}>
                    {dark.map(t => (
                      <ThemeChip
                        key={t.key}
                        theme={t}
                        isSelected={selectedKey === t.key}
                        onClick={() => onSelect(t.key)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onCancel}>取消</button>
          <button
            className={styles.confirmBtn}
            onClick={() => onConfirm(selectedKey)}
            disabled={loading}
          >
            确定并导出
          </button>
        </div>
      </div>
    </div>
  );
}

/* 色块卡片 */
function ThemeChip({
  theme,
  isSelected,
  onClick,
}: {
  theme: PptTheme;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`${styles.chip} ${isSelected ? styles.selected : ''}`}
      onClick={onClick}
      title={`${theme.label} (${theme.key})`}
      style={{ '--chip-border': isSelected ? theme.accent : 'transparent' } as React.CSSProperties}
    >
      {/* 色塊预览 */}
      <div className={styles.chipPreview} style={{ background: theme.bg_color }}>
        <div className={styles.chipStripe} style={{ background: theme.primary }} />
        <div className={styles.chipAccent} style={{ background: theme.accent }} />
        {isSelected && (
          <div className={styles.chipCheckOverlay}>
            <Check size={14} style={{ color: theme.accent }} />
          </div>
        )}
      </div>
      {/* 标签 */}
      <span
        className={styles.chipLabel}
        style={{ background: theme.bg_color, color: theme.text_color }}
      >
        {theme.label}
      </span>
    </button>
  );
}
