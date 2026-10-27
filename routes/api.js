const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { exec } = require('child_process');
const { ROOT, config, log, validateRoot } = require('../lib/utils');

function handleApi(req, res, urlPath) {
  if (!urlPath.startsWith('/api/')) return false;

  try {
    if (urlPath === '/api/hibernate' && req.method === 'POST') {
      exec('shutdown /h', (error) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });
      return true;
    }

    if (urlPath === '/api/files') {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      const dir = params.get('dir') || '';
      const fullPath = path.resolve(config.workspaceRoot, dir);
      if (!fullPath.startsWith(config.workspaceRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('forbidden');
      }
      fs.readdir(fullPath, { withFileTypes: true }, (err, files) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
        const list = files.map(f => ({ name: f.name, isDir: f.isDirectory() })).filter(f => !f.name.startsWith('.') && f.name !== 'node_modules');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
      });
      return true;
    }

    if (urlPath === '/api/file') {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      const file = params.get('path');
      if (!file) {
        res.writeHead(400); return res.end('path required');
      }
      const fullPath = path.resolve(config.workspaceRoot, file);
      if (!fullPath.startsWith(config.workspaceRoot)) {
        res.writeHead(403); return res.end('forbidden');
      }
      fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(data);
      });
      return true;
    }

    if (urlPath === '/api/cloud-models') {
      try {
        const realPath = path.join(config.bionicInternalPath, 'ng-cloud-models.json');
        if (!fs.existsSync(realPath)) throw new Error('Cloud models file not found');
        const data = JSON.parse(fs.readFileSync(realPath, 'utf8'));
        const models = data.payload.map(m => ({ id: m.modelIdentifier, name: m.label, vision: m.vision }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(models));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    if (urlPath === '/api/save-attachment' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { name, data } = JSON.parse(Buffer.concat(chunks).toString());
          const dir = path.join(config.workspaceRoot, 'attachments');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const filename = Date.now() + '-' + name.replace(/[^a-zA-Z0-9\._-]/g, '_');
          const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(path.join(dir, filename), Buffer.from(base64Data, 'base64'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, filename }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/projects') {
      try {
        const projects = [];
        const registryPath = path.join(config.bionicInternalPath, 'projects-registry.json');
        if (fs.existsSync(registryPath)) {
          const raw = fs.readFileSync(registryPath, 'utf8');
          const data = JSON.parse(raw);
          for (const [id, meta] of data.json.projects) {
            if (id === 'default-project-identifier') continue;
            const pjPath = path.join(meta.path, 'project.json');
            let name = id;
            if (fs.existsSync(pjPath)) {
              const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
              name = pj.name || id;
            }
            if (name === 'Orchestration') continue;
            projects.push({ id, name, workingDir: meta.projectWorkingDirectoryPath });
          }
        }
        const localProjDir = path.join(config.workspaceRoot, 'projects');
        if (fs.existsSync(localProjDir)) {
          const dirs = fs.readdirSync(localProjDir, { withFileTypes: true }).filter(d => d.isDirectory());
          for (const d of dirs) {
            projects.push({ id: 'local-' + d.name, name: d.name, workingDir: path.join(localProjDir, d.name) });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    if (urlPath === '/api/projects/create' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { name } = JSON.parse(Buffer.concat(chunks).toString());
          if (!name || /[^a-zA-Z0-9_-]/.test(name)) throw new Error('Invalid name. Use only letters, numbers, hyphens, and underscores.');
          const dir = path.join(config.workspaceRoot, 'projects', name);
          fs.mkdirSync(dir, { recursive: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: dir }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/read' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { path: filePath, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const fullPath = path.resolve(root, filePath);
          if (!fullPath.startsWith(root)) throw new Error('Access denied');
          const data = fs.readFileSync(fullPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: data }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/write' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { path: filePath, content, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const fullPath = path.resolve(root, filePath);
          if (!fullPath.startsWith(root)) throw new Error('Access denied');

          if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 5000) {
            throw new Error('File is too large to rewrite. You MUST use the edit_file tool for small changes to large files.');
          }

          if (fullPath.endsWith('.js')) {
            try { new vm.Script(content); } catch (e) {
              throw new Error(`SyntaxError: ${e.message}. File was NOT saved. Please fix the syntax and try again.`);
            }
          } else if (fullPath.endsWith('.json')) {
            try { JSON.parse(content); } catch (e) {
              throw new Error(`JSONError: ${e.message}. File was NOT saved.`);
            }
          }

          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          const tempPath = fullPath + '.tmp';
          fs.writeFileSync(tempPath, content);
          if (fs.existsSync(fullPath)) {
            fs.copyFileSync(fullPath, fullPath + '.bak');
          }
          fs.renameSync(tempPath, fullPath);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/edit' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { path: filePath, old_string, new_string, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const fullPath = path.resolve(root, filePath);
          if (!fullPath.startsWith(root)) throw new Error('Access denied');

          let content = fs.readFileSync(fullPath, 'utf8');

          const normalizedContent = content.replace(/\r\n/g, '\n');
          const normalizedOld = old_string.replace(/\r\n/g, '\n');
          const normalizedNew = new_string.replace(/\r\n/g, '\n');

          if (!normalizedContent.includes(normalizedOld)) {
            throw new Error('old_string not found in file. Please read the file to get the exact string.');
          }

          let newContent = normalizedContent.replace(normalizedOld, normalizedNew);
          if (content.includes('\r\n')) {
            newContent = newContent.replace(/\n/g, '\r\n');
          }

          if (fullPath.endsWith('.js')) {
            try { new vm.Script(newContent); } catch (e) { throw new Error(`SyntaxError: ${e.message}. Edit rejected.`); }
          } else if (fullPath.endsWith('.json')) {
            try { JSON.parse(newContent); } catch (e) { throw new Error(`JSONError: ${e.message}. Edit rejected.`); }
          }

          fs.writeFileSync(fullPath + '.tmp', newContent);
          fs.copyFileSync(fullPath, fullPath + '.bak');
          fs.renameSync(fullPath + '.tmp', fullPath);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/run' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { command, cwd, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const workDir = path.resolve(root, cwd || '');
          if (!workDir.startsWith(root)) throw new Error('Access denied');

          exec(command, { cwd: workDir, timeout: 30000 }, (err, stdout, stderr) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ stdout, stderr, error: err ? err.message : null }));
          });
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/list' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { path: dirPath, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const fullPath = path.resolve(root, dirPath || '');
          if (!fullPath.startsWith(root)) throw new Error('Access denied');
          const files = fs.readdirSync(fullPath, { withFileTypes: true }).map(f => ({ name: f.name, isDir: f.isDirectory() }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ files }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/save-chat' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (!data.chatId) throw new Error('chatId required');
          const safeChatId = data.chatId.replace(/[^a-zA-Z0-9_-]/g, '');
          if (!safeChatId) throw new Error('invalid chatId');
          const dir = path.join(config.workspaceRoot, 'transcripts');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const filename = safeChatId;
          const jsonPath = path.join(dir, `${filename}.json`);
          const mdPath = path.join(dir, `${filename}.md`);

          fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

          let md = `# Phone Chat - ${new Date(data.timestamp || Date.now()).toLocaleString()}\n\n`;
          for (const msg of data.messages) {
            md += `### ${msg.role === 'user' ? 'User' : 'Assistant'}\n\n`;
            if (msg.reasoning) md += `> **Thinking:**\n> ${msg.reasoning.replace(/\n/g, '\n> ')}\n\n`;
            if (Array.isArray(msg.content)) {
              msg.content.forEach(p => {
                if (p.type === 'text') md += `${p.text}\n\n`;
                else if (p.type === 'image_url') md += `![Image](${p.image_url.url.substring(0, 50)}...)\n\n`;
              });
            } else {
              md += `${msg.content}\n\n`;
            }
          }
          fs.writeFileSync(mdPath, md);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/metrics' && req.method === 'GET') {
      exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + path.join(ROOT, 'metrics.ps1') + '"', (error, stdout, stderr) => {
        if (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(stdout);
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/search' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { query, dir, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const startDir = path.resolve(root, dir || '');
          if (!startDir.startsWith(root)) throw new Error('Access denied');
          const results = [];
          const walk = (d) => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
              if (f.name === 'node_modules' || f.name === '.git') continue;
              const full = path.join(d, f.name);
              if (f.isDirectory()) walk(full);
              else if (f.isFile()) {
                try {
                  const content = fs.readFileSync(full, 'utf8');
                  if (content.includes(query)) {
                    const lines = content.split('\n');
                    lines.forEach((line, i) => {
                      if (line.includes(query)) results.push(`${path.relative(root, full)}:${i + 1}: ${line.trim()}`);
                    });
                  }
                } catch (e) { /* ignore binary */ }
              }
            }
          };
          walk(startDir);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ results: results.slice(0, 50) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/delete' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { path: filePath, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const fullPath = path.resolve(root, filePath);
          if (!fullPath.startsWith(root)) throw new Error('Access denied');
          fs.rmSync(fullPath, { recursive: true, force: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/mkdir' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { path: dirPath, root: reqRoot } = JSON.parse(Buffer.concat(chunks).toString());
          const root = validateRoot(reqRoot);
          const fullPath = path.resolve(root, dirPath);
          if (!fullPath.startsWith(root)) throw new Error('Access denied');
          fs.mkdirSync(fullPath, { recursive: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/fetch' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const { url } = JSON.parse(Buffer.concat(chunks).toString());
          const resp = await fetch(url);
          const html = await resp.text();
          const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: text.substring(0, 10000) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    if (urlPath === '/api/tools/search_web' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const { query } = JSON.parse(Buffer.concat(chunks).toString());
          const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          const html = await resp.text();
          const matches = [...html.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/g)];
          const results = matches.slice(0, 5).map(m => ({ url: m[1], title: m[2] }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ results }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    // Fallback for any /api/ path that wasn't matched
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API route not found' }));
    return true;
  } finally {
    return true;
  }
}

module.exports = { handleApi };
