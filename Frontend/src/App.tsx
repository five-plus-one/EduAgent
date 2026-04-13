import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WorkspaceLayout from './layouts/WorkspaceLayout';
import Workspace from './pages/Workspace';
import AssetPage from './pages/AssetPage';
import Login from './pages/Login';
import Register from './pages/Register';
import { useAppStore } from './store/useAppStore';
import { getMe } from './utils/api';

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
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        background: 'var(--bg-primary, #0f0f13)',
      }}>
        {/* 旋转 Loader — 和 Workspace isLoadingHistory 一致 */}
        <div style={{
          width: 64, height: 64,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.08))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 1px rgba(99,102,241,0.18)',
          animation: 'appSpinnerPulse 2s ease-in-out infinite',
        }}>
          <svg
            width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="rgba(99,102,241,0.9)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: 'appSpinnerRotate 1.4s linear infinite' }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>

        <p style={{ color: 'var(--text-primary, #e2e8f0)', fontWeight: 600, fontSize: '1rem', margin: 0 }}>
          正在恢复会话
        </p>
        <p style={{ color: 'var(--text-tertiary, #64748b)', fontSize: '0.85rem', margin: 0 }}>
          正在从服务器加载历史对话记录
        </p>

        {/* 骨架条 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, width: 320 }}>
          {[{ w: '80%', align: 'flex-end' }, { w: '65%', align: 'flex-start' }, { w: '90%', align: 'flex-end' }].map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: s.align as any }}>
              <div style={{
                width: s.w, height: 14, borderRadius: 8,
                background: 'rgba(99,102,241,0.08)',
                animation: `appSkeletonPulse 1.6s ease-in-out ${i * 0.2}s infinite`,
              }} />
            </div>
          ))}
        </div>

        <style>{`
          @keyframes appSpinnerRotate { to { transform: rotate(360deg); } }
          @keyframes appSpinnerPulse  {
            0%, 100% { box-shadow: 0 0 0 1px rgba(99,102,241,0.18); }
            50%       { box-shadow: 0 0 0 4px rgba(99,102,241,0.12); }
          }
          @keyframes appSkeletonPulse {
            0%, 100% { opacity: 0.5; }
            50%       { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

        {/* Protected Routes */}
        <Route path="/" element={<ProtectedRoute><Navigate to="/chat/new" replace /></ProtectedRoute>} />
        <Route element={<ProtectedRoute><WorkspaceLayout /></ProtectedRoute>}>
          <Route path="chat/:sessionId" element={<Workspace />} />
          <Route path="assets" element={<AssetPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
