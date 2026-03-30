import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WorkspaceLayout from './layouts/WorkspaceLayout';
import Workspace from './pages/Workspace';
import KnowledgeBase from './pages/KnowledgeBase';
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
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary, #0f0f13)',
        color: 'var(--text-tertiary, #666)',
        fontSize: '0.9rem',
        letterSpacing: '0.05em',
      }}>
        正在恢复会话...
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
          <Route path="knowledge" element={<KnowledgeBase />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
