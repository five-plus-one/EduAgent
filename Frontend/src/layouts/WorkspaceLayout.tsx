import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import styles from './WorkspaceLayout.module.css';

export default function WorkspaceLayout() {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.mainContent}>
        <Outlet />
      </main>
    </div>
  );
}
