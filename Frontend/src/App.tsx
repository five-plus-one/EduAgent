import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { getMe } from './utils/api';

const WorkspaceLayout = lazy(() => import('./layouts/WorkspaceLayout'));
const Workspace = lazy(() => import('./pages/Workspace'));
const AssetPage = lazy(() => import('./pages/AssetPage'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const GamePublicPage = lazy(() => import('./pages/GamePublicPage'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));

// Guard: block access to workspace if not logged in
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAppStore((state) => state.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Guard: if already logged in, skip login/register and go straight to workspace
function PublicRoute({ children }: { children: React.ReactNode }) {
  const user = useAppStore((state) => state.user);
  if (user) return <Navigate to="/chat/new" replace />;
  return <>{children}</>;
}

function RouteFallback() {
  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      background: 'var(--bg-primary, #f8fafc)',
    }}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.06))',
        boxShadow: '0 0 0 1px rgba(37,99,235,0.15)',
        animation: 'routeSpinnerPulse 1.8s ease-in-out infinite',
      }}>
        <svg
          width="28" height="28" viewBox="0 0 24 24" fill="none"
          stroke="rgba(37,99,235,0.85)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ animation: 'routeSpinnerRotate 1.2s linear infinite' }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <p style={{ margin: 0, color: 'var(--text-primary, #0f172a)', fontWeight: 700 }}>页面加载中</p>
      <style>{`
        @keyframes routeSpinnerRotate { to { transform: rotate(360deg); } }
        @keyframes routeSpinnerPulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(37,99,235,0.15); }
          50% { box-shadow: 0 0 0 6px rgba(37,99,235,0.06); }
        }
      `}</style>
    </div>
  );
}

function App() {
  const setUser = useAppStore((state) => state.setUser);
  // authChecked: have we finished the token → user restore attempt?
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      // Token exists — try to restore session silently
      getMe()
        .then((profile) => {
          setUser({
            id: profile.user_id ?? profile.id ?? 'u_unknown',
            name: profile.name ?? profile.username ?? '教师',
            department: profile.department ?? '',
          });
        })
        .catch(() => {
          // Token expired or invalid — clear it
          localStorage.removeItem('access_token');
        })
        .finally(() => {
          setAuthChecked(true);
        });
    } else {
      setAuthChecked(true);
    }
  }, [setUser]);

  // Block rendering until auth check completes to prevent flash-to-login
  if (!authChecked) {
    return (
      <div style={{
        width: '100%',           // ← 关键：修复 #root flex-row 导致宽度缩窄
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        background: 'var(--bg-primary, #f8fafc)',
      }}>
        {/* 旋转 Loader */}
        <div style={{
          width: 80, height: 80,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.06))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 1px rgba(37,99,235,0.15)',
          animation: 'appSpinnerPulse 2s ease-in-out infinite',
        }}>
          <svg
            width="34" height="34" viewBox="0 0 24 24" fill="none"
            stroke="rgba(37,99,235,0.85)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: 'appSpinnerRotate 1.4s linear infinite' }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>

        <p style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>
          正在恢复会话
        </p>
        <p style={{ color: 'var(--text-tertiary, #64748b)', fontSize: '0.9rem', margin: '-8px 0 0' }}>
          正在从服务器加载历史对话记录
        </p>

        {/* 骨架条 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4, width: 380 }}>
          {[
            { w: '78%', align: 'flex-end' },
            { w: '62%', align: 'flex-start' },
            { w: '88%', align: 'flex-end' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: s.align as any }}>
              <div style={{
                width: s.w, height: 16, borderRadius: 10,
                background: 'rgba(37,99,235,0.07)',
                animation: `appSkeletonPulse 1.6s ease-in-out ${i * 0.22}s infinite`,
              }} />
            </div>
          ))}
        </div>

        <style>{`
          @keyframes appSpinnerRotate { to { transform: rotate(360deg); } }
          @keyframes appSpinnerPulse  {
            0%, 100% { box-shadow: 0 0 0 1px rgba(37,99,235,0.15); }
            50%       { box-shadow: 0 0 0 6px rgba(37,99,235,0.06); }
          }
          @keyframes appSkeletonPulse {
            0%, 100% { opacity: 0.45; }
            50%       { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <NotificationCenter />
      </Suspense>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        {/* 公开路由（无需登录） */}
        <Route path="/play/:code" element={<GamePublicPage />} />
        <Route path="/s/:code"    element={<GamePublicPage />} />
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

        {/* Protected Routes */}
        <Route path="/" element={<ProtectedRoute><Navigate to="/chat/new" replace /></ProtectedRoute>} />
        <Route element={<ProtectedRoute><WorkspaceLayout /></ProtectedRoute>}>
          <Route path="chat/:sessionId" element={<Workspace />} />
          <Route path="assets" element={<AssetPage />} />
        </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
