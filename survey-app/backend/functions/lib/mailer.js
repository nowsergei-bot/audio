const nodemailer = require('nodemailer');

/**
 * @returns {null | {
 *   host: string,
 *   port: number,
 *   secure: boolean,
 *   auth?: { user: string, pass: string },
 *   from: string,
 *   requireTLS: boolean,
 *   tls?: { rejectUnauthorized: boolean },
 *   connectionTimeout: number,
 * }}
 */
function smtpConfigFromEnv() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const from = (process.env.SMTP_FROM || user || '').trim();
  const secureRaw = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  let secure = secureRaw === '1' || secureRaw === 'true' || secureRaw === 'yes';
  if (secureRaw === '' && port === 465) {
    secure = true;
  }

  if (!host || !Number.isFinite(port) || !from) return null;
  const auth = user ? { user, pass } : undefined;

  const requireTlsRaw = String(process.env.SMTP_REQUIRE_TLS || '').trim().toLowerCase();
  const requireTLS =
    !secure &&
    port === 587 &&
    requireTlsRaw !== '0' &&
    requireTlsRaw !== 'false' &&
    requireTlsRaw !== 'no';

  const tlsRejectRaw = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? '1').trim().toLowerCase();
  const tls =
    tlsRejectRaw === '0' || tlsRejectRaw === 'false' || tlsRejectRaw === 'no'
      ? { rejectUnauthorized: false }
      : undefined;

  const connectionTimeout = Math.min(
    Math.max(Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 20000) || 20000, 5000),
    120000,
  );

  return { host, port, secure, auth, from, requireTLS, tls, connectionTimeout };
}

function makeTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
    requireTLS: cfg.requireTLS,
    tls: cfg.tls,
    connectionTimeout: cfg.connectionTimeout,
  });
}

function isSmtpConfigured() {
  return smtpConfigFromEnv() != null;
}

async function sendHtmlEmail({ to, subject, html, text }) {
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
    text: text || undefined,
  });
  return info;
}

async function sendInviteEmail({ to, subject, html }) {
  return sendHtmlEmail({ to, subject, html });
}

module.exports = { smtpConfigFromEnv, isSmtpConfigured, sendHtmlEmail, sendInviteEmail };

