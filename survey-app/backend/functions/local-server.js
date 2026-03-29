#!/usr/bin/env node
/**
 * Локальный HTTP-сервер для отладки того же handler, что и в Cloud Function.
 * Запуск из каталога backend: PG_CONNECTION_STRING=... ADMIN_API_KEY=dev node functions/local-server.js
 */
const http = require('http');
const { URL } = require('url');
const { handler } = require('./index');

const PORT = Number(process.env.PORT) || 8787;

function buildEvent(req, bodyBuffer) {
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const headers = { ...req.headers };
  const headerNames = Object.keys(headers);
  const normalized = {};
  for (const k of headerNames) {
    normalized[k.toLowerCase()] = headers[k];
  }
  const ct = String(normalized['content-type'] || '').toLowerCase();
  const binaryBody = ct.includes('multipart/') || ct.includes('application/octet-stream');
  return {
    httpMethod: req.method,
    path: u.pathname,
    headers: normalized,
    body: bodyBuffer.length
      ? binaryBody
        ? bodyBuffer.toString('base64')
        : bodyBuffer.toString('utf8')
      : null,
    isBase64Encoded: Boolean(binaryBody && bodyBuffer.length),
    queryStringParameters: Object.fromEntries(u.searchParams),
  };
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyBuffer = Buffer.concat(chunks);

  try {
    const event = buildEvent(req, bodyBuffer);
    const out = await handler(event, {});
    res.writeHead(out.statusCode, out.headers || {});
    res.end(out.body || '');
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Survey API local: http://127.0.0.1:${PORT}`);
});
