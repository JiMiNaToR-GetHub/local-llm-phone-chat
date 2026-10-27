const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

let config = {
  port: 8080,
  apiHost: '127.0.0.1',
  apiPort: 1235,
  workspaceRoot: 'G:\\Local_LLM_Storage',
  certPath: './cert',
  bionicInternalPath: 'C:\\Users\\grigo\\.lmstudio\\apps\\bionic\\.internal'
};
try {
  const userConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  Object.assign(config, userConfig);
} catch (e) {
  console.warn('No config.json found, using defaults.');
}

const API_HOST = config.apiHost;
const API_PORT = config.apiPort;
const LMS_EXE = 'C:\\Users\\grigo\\.lmstudio\\bin\\lms.exe';
const LOG = path.join(ROOT, 'server.log');

function log(msg) {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // never let logging kill the server
  }
}

function getAllowedRoots() {
  const roots = [config.workspaceRoot];
  const registryPath = path.join(config.bionicInternalPath, 'projects-registry.json');
  if (fs.existsSync(registryPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      for (const [id, meta] of data.json.projects) {
        if (meta.projectWorkingDirectoryPath) {
          roots.push(path.resolve(meta.projectWorkingDirectoryPath));
        }
      }
    } catch (e) { /* ignore */ }
  }
  return roots;
}

function validateRoot(reqRoot) {
  const root = path.resolve(reqRoot || config.workspaceRoot);
  const allowed = getAllowedRoots();
  const ok = allowed.some(r => root === r || root.startsWith(r + path.sep));
  if (!ok) throw new Error('Root not allowed');
  return root;
}

function fail(res, message) {
  try {
    if (!res.writableEnded && !res.destroyed && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: { message } }));
    }
  } catch (e) {
    log('fail() write error: ' + e.message);
  }
}

let lastStartAttempt = 0;

function startApi(done) {
  const now = Date.now();
  if (now - lastStartAttempt < 30000) return done();
  lastStartAttempt = now;
  log('API unreachable - starting lms server');
  try {
    const child = spawn(LMS_EXE, ['server', 'start'], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (e) => log('spawn lms failed: ' + e.message));
    child.unref();
  } catch (e) {
    log('spawn threw: ' + e.message);
  }
  setTimeout(done, 4000);
}

function proxy(req, res, body, attempt) {
  let answered = false;
  let pingInterval = null;

  if (req.url && req.url.includes('/v1/chat/completions')) {
    pingInterval = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try { res.write(': keep-alive\n\n'); } catch {}
      }
    }, 15000);
  }

  const cleanup = () => {
    if (pingInterval) clearInterval(pingInterval);
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);

  const upstream = http.request(
    {
      host: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
    },
    (upRes) => {
      answered = true;
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
      }
      upRes.pipe(res);
      upRes.on('error', (e) => log('upstream response error: ' + e.message));
    }
  );

  upstream.on('error', (e) => {
    cleanup();
    if (answered) return;
    answered = true;
    const retryable = e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ECONNABORTED';
    if (attempt === 0 && retryable) {
      return startApi(() => proxy(req, res, body, 1));
    }
    log(`proxy error after ${attempt + 1} attempt(s): ${e.code} ${e.message}`);
    fail(res, `LM Studio API unreachable on ${API_HOST}:${API_PORT}: ${e.message}`);
  });

  // Client went away mid-flight: drop quietly.
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
  res.on('error', (e) => log('response error: ' + e.message));

  try {
    upstream.end(body);
  } catch (e) {
    log('upstream.end error: ' + e.message);
    fail(res, 'upstream write failed');
  }
}

module.exports = {
  ROOT,
  config,
  API_HOST,
  API_PORT,
  log,
  getAllowedRoots,
  validateRoot,
  fail,
  startApi,
  proxy
};
