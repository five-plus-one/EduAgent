import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { login } from '../utils/api';
import styles from './Login.module.css';

export default function Login() {
  const [username, setUsername] = useState('teacher_01');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    // Call 0.1 Login interface
    const res = await login(username, password);
    
    if (res && res.access_token) {
      localStorage.setItem('access_token', res.access_token);
      // Simulate fetch `/auth/me` and storing in global state etc here in future
      
      setTimeout(() => {
        setLoading(false);
        navigate('/'); // Redirect to Workspace (starts new session)
      }, 800);
    } else {
      setLoading(false);
      alert('登录失败，请检查账号密码');
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={clsx(styles.glassBox, 'glass-panel')}>
        <div className={styles.brandWrapper}>
          <div className={styles.logoIcon}></div>
          <h1 className={styles.brandTitle}>EduAgent</h1>
          <p className={styles.brandSubtitle}>多模态AI互动式教学智能体</p>
        </div>

        <form className={styles.loginForm} onSubmit={handleLogin}>
          <div className={styles.inputGroup}>
            <label htmlFor="username">教工号</label>
            <input 
              id="username"
              type="text" 
              placeholder="请输入您的教工号..."
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="password">密码</label>
            <input 
              id="password"
              type="password" 
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <button 
            type="submit" 
            className={clsx('button-primary', styles.loginBtn)} 
            disabled={!username || !password || loading}
          >
            {loading ? (
              <Loader2 className={styles.spinner} size={18} />
            ) : (
              <>登录工作台 <ArrowRight size={16} /></>
            )}
          </button>
        </form>
        
        <div className={styles.loginFooter}>
          <p>
            没有账号？ <a href="#">联系系统管理员</a>
          </p>
        </div>
      </div>
    </div>
  );
}
