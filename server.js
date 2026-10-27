const https = require('https');
const fs = require('fs');
const path = require('path');
const { ROOT, config, API_HOST, API_PORT, log, fail, proxy } = require('./lib/utils');
const { handleApi } = require('./routes/api');

const PORT = config.port;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

process.on('uncaughtException', (e) => log('uncaughtException: ' + (e && e.stack ? e.stack : e)));
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + (e && e.stack ? e.stack : e)));

const options = {
  key: fs.readFileSync(path.join(ROOT, config.certPath + '.key')),
  cert: fs.readFileSync(path.join(ROOT, config.certPath + '.crt'))
};

const server = https.createServer(options, (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0] || '/');

    req.on('error', (e) => log('request error: ' + e.message));

    if (urlPath === '/v1' || urlPath.startsWith('/v1/')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => proxy(req, res, Buffer.concat(chunks), 0));
      req.on('aborted', () => log('request aborted by client'));
      return;
    }

    if (handleApi(req, res, urlPath)) return;

    if (urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden');
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        if (!res.writableEnded) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
        }
        return;
      }
      if (res.writableEnded) return;
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  } catch (e) {
    log('handler threw: ' + (e && e.stack ? e.stack : e));
    fail(res, 'internal error');
  }
});

server.on('clientError', (err, socket) => {
  log('clientError: ' + err.message);
  try { socket.destroy(); } catch { }
});

server.listen(PORT, '0.0.0.0', () => {
  log(`listening on ${PORT}, proxying to ${API_HOST}:${API_PORT}`);
  console.log(`Serving ${ROOT} on https://0.0.0.0:${PORT}`);
});
