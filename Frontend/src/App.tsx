import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WorkspaceLayout from './layouts/WorkspaceLayout';
import Workspace from './pages/Workspace';
import KnowledgeBase from './pages/KnowledgeBase';
import Login from './pages/Login';
import Register from './pages/Register';
import { useAppStore } from './store/useAppStore';

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
