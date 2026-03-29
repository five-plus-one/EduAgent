import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { login, getMe } from '../utils/api';
import { useAppStore } from '../store/useAppStore';
import styles from './Login.module.css';

export default function Login() {
  const [username, setUsername] = useState('teacher_01');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();
  const setUser = useAppStore((state) => state.setUser);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await login(username, password);

      if (res?.access_token) {
        localStorage.setItem('access_token', res.access_token);

        // Fetch real user profile from /auth/me
        const profile = await getMe();
        setUser({
          id: profile.user_id ?? profile.id ?? 'u_unknown',
          name: profile.name ?? profile.username ?? username,
          department: profile.department ?? '',
        });
        navigate('/');
      } else {
        setErrorMsg('登录失败，请检查账号密码');
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setErrorMsg(axiosErr.response?.data?.message ?? '网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      {/* Decorative blurred background shapes */}
      <div className={styles.blob1}></div>
      <div className={styles.blob2}></div>
      
      <div className={clsx(styles.glassBox, 'glass-panel')}>
        <div className={styles.brandWrapper}>
          <div className={styles.logoIcon}>
            <Sparkles size={28} color="white" />
          </div>
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
              <span className={styles.btnContent}><Loader2 className={styles.spinner} size={18} /> 验证中...</span>
            ) : (
              <span className={styles.btnContent}>登录工作台 <ArrowRight size={16} /></span>
            )}
            <div className={styles.btnGlow}></div>
          </button>
          {errorMsg && (
            <p style={{color:'hsl(340,80%,50%)', fontSize:'0.9rem', textAlign:'center', marginTop: '8px'}}>
              ⚠️ {errorMsg}
            </p>
          )}
        </form>
        
        <div className={styles.loginFooter}>
          <p>没有账号？ <a href="#contact">联系系统管理员</a></p>
        </div>
      </div>
    </div>
  );
}
