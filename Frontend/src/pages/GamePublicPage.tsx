import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicGame, type PublicGameInfo } from '../utils/gamesApi';
import styles from './GamePublicPage.module.css';

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

export default function GamePublicPage() {
  const { code } = useParams<{ code: string }>();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!code) {
      setState({ status: 'not_found' });
      return;
    }

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
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={styles.brandIcon}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span className={styles.brandName}>EduAgent</span>
            <span className={styles.brandTag}>互动游戏</span>
          </div>

          {state.status === 'ok' && (
            <div className={styles.gameMeta}>
              <span className={styles.gameTitle}>{state.game.title}</span>
            </div>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {state.status === 'loading' && (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>正在加载游戏...</p>
          </div>
        )}

        {state.status === 'not_found' && (
          <ErrorCard emoji="📭" title="链接不存在" subtitle="分享链接可能已失效，或对应游戏已经被移除。" />
        )}

        {state.status === 'expired' && (
          <ErrorCard emoji="⏳" title="链接已过期" subtitle="这个分享链接已经超过有效期，请联系分享者重新生成。" />
        )}

        {state.status === 'error' && (
          <ErrorCard emoji="⚠️" title="加载失败" subtitle={`出现了一个问题：${state.message}`} />
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

      <footer className={styles.footer}>
        <span>由 <strong>EduAgent</strong> 生成</span>
        {state.status === 'ok' && <span className={styles.footerDot}>·</span>}
        {state.status === 'ok' && <span>建议使用鼠标或触控进行互动</span>}
      </footer>
    </div>
  );
}
