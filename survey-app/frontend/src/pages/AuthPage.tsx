import { motion, MotionConfig } from 'framer-motion';
import { useMemo, useState } from 'react';
import { authLogin, authRegister } from '../api/client';
import { fadeIn } from '../motion/resultsMotion';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(() => (mode === 'login' ? 'Вход' : 'Регистрация'), [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'register') {
        await authRegister({ email, password });
        setMode('login');
        setErr('Аккаунт создан. Теперь войдите.');
        return;
      }
      const res = await authLogin({ email, password });
      localStorage.setItem('auth_token', res.token);
      window.location.href = '/';
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="page" {...fadeIn} style={{ maxWidth: 720 }}>
        <div className="card glass-surface">
          <p className="admin-dash-kicker">Пульс · кабинет</p>
          <h1 className="admin-dash-title">{title}</h1>
          <p className="muted admin-dash-lead">
            Доступ только для сотрудников. Если регистрация закрыта по домену, используйте корпоративную почту.
          </p>

          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <button type="button" className={`btn${mode === 'login' ? ' primary' : ''}`} onClick={() => setMode('login')}>
              Вход
            </button>
            <button
              type="button"
              className={`btn${mode === 'register' ? ' primary' : ''}`}
              onClick={() => setMode('register')}
            >
              Регистрация
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('admin_api_key');
                window.location.reload();
              }}
            >
              Сбросить ключи
            </button>
          </div>

          <form onSubmit={submit} style={{ marginTop: '0.75rem' }}>
            <div className="auth-form-grid">
              <label style={{ fontWeight: 800 }}>Почта</label>
              <input className="auth-form-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@corp.ru" />
              <label style={{ fontWeight: 800 }}>Пароль</label>
              <input
                className="auth-form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
              />
            </div>
            <div className="row" style={{ marginTop: '0.8rem' }}>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
              </button>
            </div>
          </form>
          {err && <p className={err.includes('Аккаунт создан') ? 'muted' : 'err'} style={{ marginTop: '0.6rem' }}>{err}</p>}
        </div>
      </motion.div>
    </MotionConfig>
  );
}

