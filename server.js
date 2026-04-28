'use strict';

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const fs         = require('fs');
const path       = require('path');
const { spawn }  = require('child_process');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TASK_DIR = path.resolve(process.env.TASK_DIR || process.argv[2] || '.');
const PORT     = process.env.PORT || 3000;

const manifestPath = path.join(TASK_DIR, 'task.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Error: no task.json found in ${TASK_DIR}`);
  console.error('Usage: TASK_DIR=/path/to/task npm start');
  process.exit(1);
}

const manifest    = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const editableSet = new Set(manifest.editable || []);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const app    = express();
const server = http.createServer(app);

// API routes registered before static middleware so they are never shadowed
app.use(express.json({ limit: '1mb' }));

// GET /api/task — task metadata and all file contents
app.get('/api/task', (req, res) => {
  const allPaths = [
    ...(manifest.editable || []),
    ...(manifest.show     || []),
  ];

  const files = allPaths.flatMap(entry => {
    const full = path.join(TASK_DIR, entry);
    if (!fs.existsSync(full)) return [];

    if (fs.statSync(full).isDirectory()) {
      return walkDir(full).map(abs => ({
        path:     path.relative(TASK_DIR, abs),
        content:  fs.readFileSync(abs, 'utf8'),
        readonly: true,
      }));
    }

    return [{
      path:     entry,
      content:  fs.readFileSync(full, 'utf8'),
      readonly: !editableSet.has(entry),
    }];
  });

  res.json({ name: manifest.name || 'Coding Task', files });
});

// PUT /api/files/:path — save an editable file
app.put('/api/files/*', (req, res) => {
  const filePath = req.params[0];

  if (!editableSet.has(filePath)) {
    return res.status(403).json({ error: 'File is read-only' });
  }

  // Guard against path traversal
  const resolved = path.resolve(path.join(TASK_DIR, filePath));
  if (!resolved.startsWith(path.resolve(TASK_DIR) + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  fs.writeFileSync(resolved, req.body.content, 'utf8');
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vs', express.static(
  path.join(__dirname, 'node_modules', 'monaco-editor', 'min', 'vs')
));

// ---------------------------------------------------------------------------
// WebSocket — run output streaming
// ---------------------------------------------------------------------------

const wss = new WebSocket.Server({ server, path: '/ws' });

let activeProc = null;

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'run') {
      killActive();
      runTask(ws);
    } else if (msg.type === 'kill') {
      killActive();
      send(ws, { type: 'killed' });
    }
  });

  ws.on('close', killActive);
});

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function killActive() {
  if (activeProc) { activeProc.kill('SIGTERM'); activeProc = null; }
}

function runTask(ws) {
  send(ws, { type: 'start', cmd: manifest.run });

  const proc = spawn('sh', ['-c', manifest.run], { cwd: TASK_DIR });
  activeProc  = proc;

  proc.stdout.on('data', d => send(ws, { type: 'stdout', data: d.toString() }));
  proc.stderr.on('data', d => send(ws, { type: 'stderr', data: d.toString() }));
  proc.on('close', code => {
    activeProc = null;
    send(ws, { type: 'done', code });
  });
  proc.on('error', err => {
    activeProc = null;
    send(ws, { type: 'error', message: err.message });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walkDir(full) : [full];
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Interview platform → http://localhost:${PORT}`);
  console.log(`Task: "${manifest.name || '(unnamed)'}" in ${TASK_DIR}`);
});
