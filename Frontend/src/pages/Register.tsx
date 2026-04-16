import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { register, login, getMe, getApiErrorMessage } from '../utils/api';
import { useAppStore } from '../store/useAppStore';
import styles from './Login.module.css'; // Reuse the Login glassmorphism styles

export default function Register() {
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    name: '',
    department: '',
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();
  const setUser = useAppStore((state) => state.setUser);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setErrorMsg('');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const { username, password, confirmPassword, name, department } = form;

    if (!username || !password) {
      setErrorMsg('教工号和密码为必填项');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('密码长度至少需要 6 位');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      // Step 1: Register
      await register({ username, password, name: name || undefined, department: department || undefined });

      // Step 2: Auto-login after successful registration
      const res = await login(username, password);
      if (res?.access_token) {
        localStorage.setItem('access_token', res.access_token);
        const profile = await getMe();
        setUser({
          id: profile.user_id ?? profile.id ?? 'u_unknown',
          name: profile.name ?? name ?? username,
          department: profile.department ?? department ?? '',
        });
        navigate('/');
      }
    } catch (err: unknown) {
      setErrorMsg(getApiErrorMessage(err, '注册失败，请检查信息后重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      <div className={clsx(styles.glassBox, 'glass-panel')}>
        <div className={styles.brandWrapper}>
          <div className={styles.logoIcon}>
            <Sparkles size={28} color="white" />
          </div>
          <h1 className={styles.brandTitle}>EduAgent</h1>
          <p className={styles.brandSubtitle}>创建您的教师账户</p>
        </div>

        <form className={styles.loginForm} onSubmit={handleRegister}>
          {/* Row 1: username + name side-by-side */}
          <div className={styles.inputRow}>
            <div className={styles.inputGroup}>
              <label htmlFor="reg-username">教工号 <span style={{ color: 'var(--accent-primary)' }}>*</span></label>
              <input
                id="reg-username"
                name="username"
                type="text"
                placeholder="唯一登录账号"
                value={form.username}
                onChange={handleChange}
                className={styles.input}
                disabled={loading}
                autoFocus
              />
            </div>
            <div className={styles.inputGroup}>
              <label htmlFor="reg-name">姓名</label>
              <input
                id="reg-name"
                name="name"
                type="text"
                placeholder="王老师（可选）"
                value={form.name}
                onChange={handleChange}
                className={styles.input}
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="reg-department">所在院系</label>
            <input
              id="reg-department"
              name="department"
              type="text"
              placeholder="物理系（可选）"
              value={form.department}
              onChange={handleChange}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="reg-password">密码 <span style={{ color: 'var(--accent-primary)' }}>*</span></label>
            <input
              id="reg-password"
              name="password"
              type="password"
              placeholder="至少 6 位"
              value={form.password}
              onChange={handleChange}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="reg-confirm">确认密码 <span style={{ color: 'var(--accent-primary)' }}>*</span></label>
            <input
              id="reg-confirm"
              name="confirmPassword"
              type="password"
              placeholder="再次输入密码"
              value={form.confirmPassword}
              onChange={handleChange}
              className={styles.input}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className={clsx('button-primary', styles.loginBtn)}
            disabled={!form.username || !form.password || !form.confirmPassword || loading}
          >
            {loading ? (
              <span className={styles.btnContent}><Loader2 className={styles.spinner} size={18} /> 注册中...</span>
            ) : (
              <span className={styles.btnContent}><UserPlus size={16} /> 创建账户并登录 <ArrowRight size={16} /></span>
            )}
            <div className={styles.btnGlow} />
          </button>

          {errorMsg && (
            <p style={{ color: 'hsl(340,80%,50%)', fontSize: '0.9rem', textAlign: 'center', marginTop: '8px' }}>
              ⚠️ {errorMsg}
            </p>
          )}
        </form>

        <div className={styles.loginFooter}>
          <p>已有账号？ <Link to="/login" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>返回登录</Link></p>
        </div>
      </div>
    </div>
  );
}
