import { useEffect } from 'react';
import { Bell, CheckCircle2, CircleAlert, Info, X, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useNotificationStore, type NotificationItem } from '../store/useNotificationStore';
import styles from './NotificationCenter.module.css';

const ICON_MAP: Record<NotificationItem['tone'], typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  error: XCircle,
};

const TITLE_MAP: Record<NotificationItem['tone'], string> = {
  info: '提示',
  success: '操作成功',
  warning: '请注意',
  error: '操作失败',
};

function NotificationCard({ item }: { item: NotificationItem }) {
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const Icon = ICON_MAP[item.tone] ?? Bell;

  useEffect(() => {
    if (item.duration <= 0) return undefined;
    const timer = window.setTimeout(() => dismissNotification(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [dismissNotification, item.duration, item.id]);

  return (
    <article className={clsx(styles.card, styles[item.tone])} role="status" aria-live="polite">
      <div className={styles.iconWrap}>
        <Icon size={20} strokeWidth={2.1} />
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{item.title || TITLE_MAP[item.tone]}</div>
        <div className={styles.message}>{item.message}</div>
      </div>
      <button
        type="button"
        className={styles.closeBtn}
        onClick={() => dismissNotification(item.id)}
        aria-label="关闭通知"
      >
        <X size={16} />
      </button>
    </article>
  );
}

export default function NotificationCenter() {
  const notifications = useNotificationStore((state) => state.notifications);

  if (!notifications.length) return null;

  return (
    <div className={styles.viewport} aria-live="polite" aria-atomic="false">
      {notifications.map((item) => (
        <NotificationCard key={item.id} item={item} />
      ))}
    </div>
  );
}
