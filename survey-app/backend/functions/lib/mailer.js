const nodemailer = require('nodemailer');

function smtpConfigFromEnv() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const from = (process.env.SMTP_FROM || user || '').trim();
  const secureRaw = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureRaw === '1' || secureRaw === 'true' || secureRaw === 'yes';

  if (!host || !Number.isFinite(port) || !from) return null;
  const auth = user ? { user, pass } : undefined;
  return { host, port, secure, auth, from };
}

function makeTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
  });
}

async function sendInviteEmail({ to, subject, html }) {
  const cfg = smtpConfigFromEnv();
  if (!cfg) {
    const err = new Error('SMTP is not configured');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const transport = makeTransport(cfg);
  const info = await transport.sendMail({
    from: cfg.from,
    to,
    subject,
    html,
  });
  return info;
}

module.exports = { smtpConfigFromEnv, sendInviteEmail };

