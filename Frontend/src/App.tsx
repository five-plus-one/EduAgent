import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WorkspaceLayout from './layouts/WorkspaceLayout';
import Workspace from './pages/Workspace';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/chat/new" replace />} />
        <Route path="/chat/:sessionId" element={<WorkspaceLayout />}>
          <Route index element={<Workspace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
