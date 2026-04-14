/**
 * GamePublicPage — 互动游戏公开落地页
 *
 * 路由: /play/:code
 * 特点:
 * - 无需登录，完全公开
 * - 仅展示游戏标题 + iframe 游戏内容
 * - 极简品牌 header / footer
 * - 游戏 HTML 通过 srcdoc 注入（规避 X-Frame-Options）
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicGame, type PublicGameInfo } from '../utils/gamesApi';
import styles from './GamePublicPage.module.css';

// ─────────────────────────────────────────────────────────────────
// Error States
// ─────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'loading' }
  | { status: 'ok'; game: PublicGameInfo }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'error'; message: string };

function ErrorCard({ emoji, title, subtitle }: { emoji: string; title: string; subtitle: string }) {
  return (
    <div className={styles.errorWrap}>
      <div className={styles.errorEmoji}>{emoji}</div>
      <h2 className={styles.errorTitle}>{title}</h2>
      <p className={styles.errorSub}>{subtitle}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

export default function GamePublicPage() {
  const { code } = useParams<{ code: string }>();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  // 锁定 body 滚动，防止游戏 iframe 高度计算被干扰
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!code) { setState({ status: 'not_found' }); return; }
    setState({ status: 'loading' });

    getPublicGame(code)
      .then(game => {
        document.title = `${game.title} · EduAgent 互动游戏`;
        setState({ status: 'ok', game });
      })
      .catch((err: Error) => {
        if (err.message === 'SHARE_NOT_FOUND') {
          setState({ status: 'not_found' });
        } else if (err.message === 'SHARE_EXPIRED') {
          setState({ status: 'expired' });
        } else {
          setState({ status: 'error', message: err.message });
        }
      });
  }, [code]);

  return (
    <div className={styles.page}>

      {/* ── 极简 Header ── */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={styles.brandIcon}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span className={styles.brandName}>EduAgent</span>
            <span className={styles.brandTag}>互动教学</span>
          </div>

          {state.status === 'ok' && (
            <div className={styles.gameMeta}>
              <span className={styles.gameTitle}>{state.game.title}</span>
            </div>
          )}
        </div>
      </header>

      {/* ── 内容区 ── */}
      <main className={styles.main}>
        {state.status === 'loading' && (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>正在加载游戏...</p>
          </div>
        )}

        {state.status === 'not_found' && (
          <ErrorCard
            emoji="🔍"
            title="链接不存在"
            subtitle="该分享链接可能已失效或从未存在，请联系分享者获取新链接"
          />
        )}

        {state.status === 'expired' && (
          <ErrorCard
            emoji="⏰"
            title="链接已过期"
            subtitle="此分享链接的有效期已结束，请联系分享者重新生成"
          />
        )}

        {state.status === 'error' && (
          <ErrorCard
            emoji="⚠️"
            title="加载失败"
            subtitle={`出现了一点问题（${state.message}），请稍后刷新重试`}
          />
        )}

        {state.status === 'ok' && (
          <div className={styles.gameWrap}>
            <iframe
              srcDoc={state.game.html_content}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              className={styles.gameFrame}
              title={state.game.title}
              allow="fullscreen"
            />
          </div>
        )}
      </main>

      {/* ── 极简 Footer ── */}
      <footer className={styles.footer}>
        <span>由 <strong>EduAgent</strong> 生成 · 互动教学平台</span>
        {state.status === 'ok' && (
          <span className={styles.footerDot}>·</span>
        )}
        {state.status === 'ok' && (
          <span>使用键盘和鼠标与游戏互动</span>
        )}
      </footer>

    </div>
  );
}
