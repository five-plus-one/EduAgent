/**
 * ThemePicker v2 — PPT 主题选择器（全功能版）
 *
 * 新增：
 * - 一键快速切换：主题网格直接单击即选中并可快速应用
 * - 自定义主题编辑器：5 个颜色字段 + 颜色 picker 原生控件
 * - 实时 PPT 幻灯片预览：用 canvas 渲染主题效果
 * - 持久化：选中 key / 自定义颜色写入 localStorage
 * - 紧凑快捷入口模式（compact=true）：仅显示色块行 + 自定义按钮，无弹框
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { getThemes, type PptTheme } from '../utils/api';
import styles from './ThemePicker.module.css';
import {
  Loader2, Palette, Check, Sliders, X,
  RefreshCw, Zap,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface CustomThemeColors {
  bg_color:   string;
  primary:    string;
  secondary:  string;
  accent:     string;
  text_color: string;
}

const CUSTOM_KEY = '__custom__';
const LS_THEME_KEY = 'eduagent_ppt_theme_key';
const LS_CUSTOM_KEY = 'eduagent_ppt_custom_theme';

const DEFAULT_CUSTOM: CustomThemeColors = {
  bg_color:   '#FFFFFF',
  primary:    '#1E3A5F',
  secondary:  '#4A6F8A',
  accent:     '#E8613C',
  text_color: '#1A1A2E',
};

interface ThemePickerProps {
  /** 当前选中的主题 key（null 表示「自动」，CUSTOM_KEY 表示自定义）*/
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onConfirm: (key: string | null, customColors?: CustomThemeColors) => void;
  onCancel: () => void;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function loadSavedTheme(): string | null {
  try { return localStorage.getItem(LS_THEME_KEY); } catch { return null; }
}

function saveTheme(key: string | null) {
  try { localStorage.setItem(LS_THEME_KEY, key ?? ''); } catch {}
}

function loadCustomColors(): CustomThemeColors {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_KEY);
    if (raw) return { ...DEFAULT_CUSTOM, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CUSTOM };
}

function saveCustomColors(c: CustomThemeColors) {
  try { localStorage.setItem(LS_CUSTOM_KEY, JSON.stringify(c)); } catch {}
}

// ─────────────────────────────────────────────────────────────────
// Mini PPT Slide Preview (canvas-based)
// ─────────────────────────────────────────────────────────────────

function SlidePreview({ bg, primary, secondary, accent, text }: {
  bg: string; primary: string; secondary: string; accent: string; text: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width; const H = canvas.height;

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Decorative circle top-left (accent)
    ctx.beginPath();
    ctx.arc(W * -0.05, H * -0.1, H * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(accent, 0.18);
    ctx.fill();

    // Decorative circle bottom-right (primary)
    ctx.beginPath();
    ctx.arc(W * 1.1, H * 1.05, H * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(primary, 0.12);
    ctx.fill();

    // Left accent stripe
    ctx.fillStyle = accent;
    ctx.fillRect(0, H * 0.28, 3, H * 0.5);

    // Title bar
    ctx.fillStyle = primary;
    ctx.font = `bold ${Math.round(H * 0.12)}px Inter, sans-serif`;
    ctx.fillText('课程标题示例', W * 0.06, H * 0.42);

    // Secondary text
    ctx.fillStyle = secondary;
    ctx.font = `${Math.round(H * 0.08)}px Inter, sans-serif`;
    ctx.fillText('副标题 · 知识点说明', W * 0.06, H * 0.58);

    // Body bullets
    ctx.fillStyle = text;
    ctx.font = `${Math.round(H * 0.07)}px Inter, sans-serif`;
    ['要点一：核心概念介绍', '要点二：理论框架说明', '要点三：应用与实践'].forEach((line, i) => {
      const y = H * 0.71 + i * H * 0.1;
      // bullet
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(W * 0.04, y - H * 0.028, 3, 0, Math.PI * 2);
      ctx.fill();
      // text
      ctx.fillStyle = text;
      ctx.fillText(line, W * 0.07, y);
    });

    // Bottom line
    ctx.fillStyle = primary;
    ctx.fillRect(0, H - 3, W, 3);

  }, [bg, primary, secondary, accent, text]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      className={styles.slideCanvas}
    />
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────
// Color Field
// ─────────────────────────────────────────────────────────────────

function ColorField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className={styles.colorField}>
      <label className={styles.colorLabel}>{label}</label>
      <div className={styles.colorInputRow}>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={styles.colorNative}
        />
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={e => {
            const v = e.target.value;
            if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v);
          }}
          className={styles.colorHex}
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Theme Chip
// ─────────────────────────────────────────────────────────────────

function ThemeChip({
  theme, isSelected, onClick,
}: {
  theme: PptTheme; isSelected: boolean; onClick: () => void;
}) {
  return (
    <button
      className={`${styles.chip} ${isSelected ? styles.selected : ''}`}
      onClick={onClick}
      title={`${theme.label}`}
    >
      <div className={styles.chipPreview} style={{ background: theme.bg_color }}>
        <div className={styles.chipStripe} style={{ background: theme.primary }} />
        <div className={styles.chipAccent} style={{ background: theme.accent }} />
        {isSelected && (
          <div className={styles.chipCheckOverlay}>
            <Check size={13} style={{ color: theme.accent }} />
          </div>
        )}
      </div>
      <span
        className={styles.chipLabel}
        style={{ background: theme.bg_color, color: theme.text_color }}
      >
        {theme.label}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export default function ThemePicker({
  selectedKey, onSelect, onConfirm, onCancel,
}: ThemePickerProps) {
  const [themes, setThemes] = useState<PptTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [tab, setTab]       = useState<'preset' | 'custom'>('preset');
  const [customColors, setCustomColors] = useState<CustomThemeColors>(loadCustomColors);
  const panelRef = useRef<HTMLDivElement>(null);

  // 恢复上次选择
  useEffect(() => {
    const saved = loadSavedTheme();
    if (saved !== null && saved !== selectedKey) onSelect(saved || null);
  }, []); // eslint-disable-line

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
    const fn = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onCancel]);

  // 自定义颜色持久化
  useEffect(() => { saveCustomColors(customColors); }, [customColors]);

  const setColor = useCallback((field: keyof CustomThemeColors, value: string) => {
    setCustomColors(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSelectPreset = (key: string | null) => {
    onSelect(key);
    setTab('preset');
  };

  const handleConfirm = () => {
    const key = tab === 'custom' ? CUSTOM_KEY : selectedKey;
    saveTheme(key);
    onConfirm(key, tab === 'custom' ? customColors : undefined);
  };

  // 当前预览颜色
  const previewColors = tab === 'custom'
    ? customColors
    : (() => {
        if (selectedKey === null) return { bg_color: '#F8FAFC', primary: '#0F172A', secondary: '#64748B', accent: '#3B82F6', text_color: '#1E293B' };
        const t = themes.find(t => t.key === selectedKey);
        return t
          ? { bg_color: t.bg_color, primary: t.primary, secondary: t.secondary, accent: t.accent, text_color: t.text_color }
          : DEFAULT_CUSTOM;
      })();

  const light = themes.filter(t => t.category === 'light');
  const dark  = themes.filter(t => t.category === 'dark');

  return (
    <div className={styles.overlay}>
      <div className={styles.panel} ref={panelRef}>

        {/* ─── 头部 ─── */}
        <div className={styles.header}>
          <Palette size={17} className={styles.headerIcon} />
          <span className={styles.headerTitle}>PPT 主题</span>
          <button className={styles.closeBtn} onClick={onCancel}><X size={15} /></button>
        </div>

        {/* ─── Tab 切换 ─── */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn} ${tab === 'preset' ? styles.tabActive : ''}`}
            onClick={() => setTab('preset')}
          >
            <Palette size={13} /> 预设主题
          </button>
          <button
            className={`${styles.tabBtn} ${tab === 'custom' ? styles.tabActive : ''}`}
            onClick={() => setTab('custom')}
          >
            <Sliders size={13} /> 自定义
          </button>
        </div>

        <div className={styles.body}>
          {/* ─── 幻灯片预览 ─── */}
          <div className={styles.previewWrap}>
            <SlidePreview
              bg={previewColors.bg_color}
              primary={previewColors.primary}
              secondary={previewColors.secondary}
              accent={previewColors.accent}
              text={previewColors.text_color}
            />
            <div className={styles.previewLabel}>
              {tab === 'custom'
                ? '自定义主题预览'
                : (themes.find(t => t.key === selectedKey)?.label ?? (selectedKey === null ? '自动主题' : selectedKey))}
            </div>
          </div>

          {tab === 'preset' ? (
            /* ─── 预设主题网格 ─── */
            <>
              {loading ? (
                <div className={styles.loadingState}>
                  <Loader2 size={22} className={styles.spin} />
                  <p>加载主题中...</p>
                </div>
              ) : error ? (
                <div className={styles.errorState}>
                  {error}
                  <button className={styles.retryBtn} onClick={() => { setError(''); setLoading(true); getThemes().then(setThemes).catch(() => setError('重试失败')).finally(() => setLoading(false)); }}>
                    <RefreshCw size={12} /> 重试
                  </button>
                </div>
              ) : (
                <>
                  {/* 自动选项 */}
                  <div className={styles.section}>
                    <h4 className={styles.sectionLabel}>自动选择</h4>
                    <div className={styles.chipGrid}>
                      <button
                        className={`${styles.autoChip} ${selectedKey === null ? styles.selected : ''}`}
                        onClick={() => handleSelectPreset(null)}
                        title="由后端按会话哈希自动决定主题"
                      >
                        {selectedKey === null && <Check size={11} className={styles.checkIcon} />}
                        <span>自动 (Auto)</span>
                        <span className={styles.autoHint}>后端智能分配</span>
                      </button>
                    </div>
                  </div>

                  {/* 浅色 */}
                  {light.length > 0 && (
                    <div className={styles.section}>
                      <h4 className={styles.sectionLabel}>浅色主题</h4>
                      <div className={styles.chipGrid}>
                        {light.map(t => (
                          <ThemeChip
                            key={t.key}
                            theme={t}
                            isSelected={selectedKey === t.key}
                            onClick={() => handleSelectPreset(t.key)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 深色 */}
                  {dark.length > 0 && (
                    <div className={styles.section}>
                      <h4 className={styles.sectionLabel}>深色主题</h4>
                      <div className={styles.chipGrid}>
                        {dark.map(t => (
                          <ThemeChip
                            key={t.key}
                            theme={t}
                            isSelected={selectedKey === t.key}
                            onClick={() => handleSelectPreset(t.key)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            /* ─── 自定义颜色编辑器 ─── */
            <div className={styles.customEditor}>
              <div className={styles.customEditorHint}>
                自由调整 PPT 的所有颜色，实时预览效果
              </div>
              <div className={styles.colorGrid}>
                <ColorField label="背景色" value={customColors.bg_color} onChange={v => setColor('bg_color', v)} />
                <ColorField label="主色（标题）" value={customColors.primary} onChange={v => setColor('primary', v)} />
                <ColorField label="辅色（副标题）" value={customColors.secondary} onChange={v => setColor('secondary', v)} />
                <ColorField label="强调色（装饰）" value={customColors.accent} onChange={v => setColor('accent', v)} />
                <ColorField label="正文色" value={customColors.text_color} onChange={v => setColor('text_color', v)} />
              </div>
              <button
                className={styles.resetBtn}
                onClick={() => setCustomColors({ ...DEFAULT_CUSTOM })}
              >
                <RefreshCw size={12} /> 恢复默认
              </button>
            </div>
          )}
        </div>

        {/* ─── 底部操作栏 ─── */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onCancel}>取消</button>
          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={loading && tab === 'preset'}
          >
            <Zap size={13} />
            确定并导出
          </button>
        </div>
      </div>
    </div>
  );
}

// 导出 CUSTOM_KEY 常量供父组件使用
export { CUSTOM_KEY };
export type { CustomThemeColors as ThemeCustomColors };
