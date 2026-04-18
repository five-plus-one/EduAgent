import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { login, getMe, getApiErrorMessage } from '../utils/api';
import { useAppStore } from '../store/useAppStore';
import { useNotificationStore } from '../store/useNotificationStore';
import styles from './Login.module.css';

export default function Login() {
  const [username, setUsername] = useState('teacher_01');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setUser = useAppStore((state) => state.setUser);
  const pushNotification = useNotificationStore((state) => state.pushNotification);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      pushNotification({ tone: 'warning', title: '请补全登录信息', message: '请输入账号和密码后再继续登录。' });
      return;
    }

    setLoading(true);
    try {
      const res = await login(username, password);
      if (res?.access_token) {
        localStorage.setItem('access_token', res.access_token);
        const profile = await getMe();
        setUser({
          id: profile.user_id ?? profile.id ?? 'u_unknown',
          name: profile.name ?? profile.username ?? username,
          department: profile.department ?? '',
        });
        navigate('/');
      } else {
        pushNotification({ tone: 'error', title: '登录失败', message: '系统未返回有效令牌，请稍后再试。' });
      }
    } catch (err: unknown) {
      pushNotification({ tone: 'error', title: '登录失败', message: getApiErrorMessage(err, '网络异常，请稍后重试。') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      <div className={styles.shell}>
        <section className={styles.heroPanel}>
          <span className={styles.heroEyebrow}>AI Teaching Workspace</span>
          <h1 className={styles.heroTitle}>用更统一、更高效的方式完成备课与产出。</h1>
          <p className={styles.heroDesc}>
            在一个工作台中串起会话、资料、课件、讲义和互动游戏，让生成、编辑与导出形成闭环。
          </p>
          <div className={styles.heroList}>
            <div><Sparkles size={16} /> 多端物料一体化</div>
            <div><Sparkles size={16} /> 资料驱动生成</div>
            <div><Sparkles size={16} /> 蓝白统一视觉系统</div>
          </div>
        </section>

        <section className={clsx(styles.formPanel, 'app-surface-raised')}>
          <div className={styles.brandWrapper}>
            <div className={styles.logoIcon}><Sparkles size={26} color="white" /></div>
            <h1 className={styles.brandTitle}>EduAgent</h1>
            <p className={styles.brandSubtitle}>登录教学工作台</p>
          </div>

          <form className={styles.loginForm} onSubmit={handleLogin}>
            <div className={styles.inputGroup}>
              <label htmlFor="username">账号</label>
              <input
                id="username"
                type="text"
                placeholder="请输入教工号或用户名"
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
                placeholder="请输入登录密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={styles.input}
                disabled={loading}
              />
            </div>

            <button type="submit" className={clsx('button-primary', styles.loginBtn)} disabled={!username || !password || loading}>
              {loading ? (
                <span className={styles.btnContent}><Loader2 className={styles.spinner} size={18} /> 登录中...</span>
              ) : (
                <span className={styles.btnContent}>进入工作台 <ArrowRight size={16} /></span>
              )}
              <div className={styles.btnGlow} />
            </button>
          </form>

          <div className={styles.loginFooter}>
            <p>还没有账号？<Link to="/register">立即注册</Link></p>
          </div>
        </section>
      </div>
    </div>
  );
}
