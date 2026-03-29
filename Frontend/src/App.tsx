import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WorkspaceLayout from './layouts/WorkspaceLayout';
import Workspace from './pages/Workspace';
import KnowledgeBase from './pages/KnowledgeBase';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/chat/new" replace />} />
        <Route element={<WorkspaceLayout />}>
          <Route path="chat/:sessionId" element={<Workspace />} />
          <Route path="knowledge" element={<KnowledgeBase />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
