import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { register, login, getMe, getApiErrorMessage } from '../utils/api';
import { useAppStore } from '../store/useAppStore';
import { useNotificationStore } from '../store/useNotificationStore';
import styles from './Login.module.css';

export default function Register() {
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    name: '',
    department: '',
  });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setUser = useAppStore((state) => state.setUser);
  const pushNotification = useNotificationStore((state) => state.pushNotification);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const { username, password, confirmPassword, name, department } = form;

    if (!username || !password) {
      pushNotification({ tone: 'warning', title: '注册信息不完整', message: '账号和密码为必填项。' });
      return;
    }
    if (password !== confirmPassword) {
      pushNotification({ tone: 'warning', title: '两次密码不一致', message: '请重新确认密码输入。' });
      return;
    }
    if (password.length < 6) {
      pushNotification({ tone: 'warning', title: '密码过短', message: '密码长度至少需要 6 位。' });
      return;
    }

    setLoading(true);
    try {
      await register({ username, password, name: name || undefined, department: department || undefined });
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
      } else {
        pushNotification({ tone: 'error', title: '自动登录失败', message: '注册完成，但未能自动登录，请返回登录页重试。' });
      }
    } catch (err: unknown) {
      pushNotification({ tone: 'error', title: '注册失败', message: getApiErrorMessage(err, '请检查信息后重试。') });
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
          <span className={styles.heroEyebrow}>Account Setup</span>
          <h1 className={styles.heroTitle}>为你的教学协作空间创建一个新账户。</h1>
          <p className={styles.heroDesc}>完成注册后即可立即进入 EduAgent，开始管理资料、生成课件并维护讲义。</p>
          <div className={styles.heroList}>
            <div><Sparkles size={16} /> 教学资料统一沉淀</div>
            <div><Sparkles size={16} /> 课件与讲义协同生成</div>
            <div><Sparkles size={16} /> 移动端与桌面端一致体验</div>
          </div>
        </section>

        <section className={clsx(styles.formPanel, 'app-surface-raised')}>
          <div className={styles.brandWrapper}>
            <div className={styles.logoIcon}><Sparkles size={26} color="white" /></div>
            <h1 className={styles.brandTitle}>创建账户</h1>
            <p className={styles.brandSubtitle}>注册后将自动登录</p>
          </div>

          <form className={styles.loginForm} onSubmit={handleRegister}>
            <div className={styles.inputRow}>
              <div className={styles.inputGroup}>
                <label htmlFor="reg-username">账号</label>
                <input id="reg-username" name="username" type="text" placeholder="请输入唯一账号" value={form.username} onChange={handleChange} className={styles.input} disabled={loading} />
              </div>
              <div className={styles.inputGroup}>
                <label htmlFor="reg-name">姓名</label>
                <input id="reg-name" name="name" type="text" placeholder="可选，用于显示" value={form.name} onChange={handleChange} className={styles.input} disabled={loading} />
              </div>
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="reg-department">院系 / 部门</label>
              <input id="reg-department" name="department" type="text" placeholder="可选，用于团队识别" value={form.department} onChange={handleChange} className={styles.input} disabled={loading} />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="reg-password">密码</label>
              <input id="reg-password" name="password" type="password" placeholder="至少 6 位" value={form.password} onChange={handleChange} className={styles.input} disabled={loading} />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="reg-confirm">确认密码</label>
              <input id="reg-confirm" name="confirmPassword" type="password" placeholder="再次输入密码" value={form.confirmPassword} onChange={handleChange} className={styles.input} disabled={loading} />
            </div>

            <button type="submit" className={clsx('button-primary', styles.loginBtn)} disabled={!form.username || !form.password || !form.confirmPassword || loading}>
              {loading ? (
                <span className={styles.btnContent}><Loader2 className={styles.spinner} size={18} /> 注册中...</span>
              ) : (
                <span className={styles.btnContent}><UserPlus size={16} /> 创建账户并进入工作台 <ArrowRight size={16} /></span>
              )}
              <div className={styles.btnGlow} />
            </button>
          </form>

          <div className={styles.loginFooter}>
            <p>已有账号？<Link to="/login">返回登录</Link></p>
          </div>
        </section>
      </div>
    </div>
  );
}
