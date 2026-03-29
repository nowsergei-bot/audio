const Busboy = require('busboy');

function getHeader(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(h[key]) : '';
}

/**
 * Достаёт тело запроса как Buffer (для multipart с бинарным телом важен base64 от шлюза).
 */
function rawBodyBuffer(event) {
  if (!event.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64');
  }
  if (Buffer.isBuffer(event.body)) {
    return event.body;
  }
  return Buffer.from(String(event.body), 'utf8');
}

/**
 * @param {object} event — событие HTTP-триггера (body, isBase64Encoded, headers)
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
function parseMultipartFileField(event, fieldName = 'file') {
  const contentType = getHeader(event, 'content-type');
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return Promise.reject(new Error('NOT_MULTIPART'));
  }

  const buffer = rawBodyBuffer(event);
  if (!buffer.length) {
    return Promise.reject(new Error('EMPTY_BODY'));
  }

  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fileSize: 25 * 1024 * 1024 },
    });
    const files = [];

    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (d) => chunks.push(d));
      stream.on('error', reject);
      stream.on('end', () => {
        files.push({
          name,
          buffer: Buffer.concat(chunks),
          filename: (info && info.filename) || '',
        });
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => {
      const f = files.find((x) => x.name === fieldName);
      if (!f || !f.buffer.length) {
        reject(new Error('NO_FILE_FIELD'));
        return;
      }
      resolve({ buffer: f.buffer, filename: f.filename || 'таблица.xlsx' });
    });

    bb.write(buffer);
    bb.end();
  });
}

module.exports = { parseMultipartFileField, getHeader, rawBodyBuffer };
