'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const files  = {};   // path → { content, readonly }
const models = {};   // path → monaco.editor.ITextModel

let activeFile = null;
let editor     = null;
let saveTimer  = null;
let ws         = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

require.config({ paths: { vs: '/vs' } });
require(['vs/editor/editor.main'], () => {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    theme:               'vs-dark',
    fontSize:            14,
    minimap:             { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout:     true,
  });

  editor.onDidChangeModelContent(() => {
    if (!activeFile || files[activeFile]?.readonly) return;
    scheduleSave();
  });

  loadTask();
  connectWS();
});

function lang(filePath) {
  const ext = filePath.split('.').pop();
  return { c: 'c', h: 'c', md: 'markdown', json: 'json', txt: 'plaintext' }[ext] ?? 'plaintext';
}

// ---------------------------------------------------------------------------
// Task loading
// ---------------------------------------------------------------------------

async function loadTask() {
  const { name, files: taskFiles } = await fetch('/api/task').then(r => r.json());

  document.title = name;
  document.getElementById('task-name').textContent = name;

  const editableList = document.getElementById('file-list-editable');
  const readonlyList = document.getElementById('file-list-readonly');
  const roLabel      = document.getElementById('label-readonly');

  const hasReadonly = taskFiles.some(f => f.readonly);
  if (hasReadonly) roLabel.style.display = '';

  for (const f of taskFiles) {
    files[f.path] = { content: f.content, readonly: f.readonly };

    const li       = document.createElement('li');
    li.textContent = f.path;
    li.dataset.path = f.path;
    li.className   = 'file-tab' + (f.readonly ? ' readonly' : '');
    li.addEventListener('click', () => openFile(f.path));
    (f.readonly ? readonlyList : editableList).appendChild(li);
  }

  // Open first editable file by default
  const first = taskFiles.find(f => !f.readonly);
  if (first) openFile(first.path);
}

async function openFile(filePath) {
  if (activeFile === filePath) return;

  // Save current file synchronously before switching
  if (activeFile && !files[activeFile]?.readonly) {
    clearTimeout(saveTimer);
    await saveActive();
  }

  activeFile = filePath;

  document.querySelectorAll('.file-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.path === filePath)
  );

  const file = files[filePath];

  // Create model once per file; reuse on subsequent visits (preserves cursor)
  if (!models[filePath]) {
    models[filePath] = monaco.editor.createModel(
      file.content,
      lang(filePath),
      monaco.Uri.parse(`inmemory://task/${filePath}`)
    );
  }

  editor.setModel(models[filePath]);
  editor.updateOptions({ readOnly: file.readonly });
}

// ---------------------------------------------------------------------------
// Auto-save (1 s debounce)
// ---------------------------------------------------------------------------

function scheduleSave() {
  clearTimeout(saveTimer);
  showSaveStatus('…');
  saveTimer = setTimeout(saveActive, 1000);
}

async function saveActive() {
  if (!activeFile || files[activeFile]?.readonly) return;

  const content = editor.getValue();
  const res = await fetch(`/api/files/${activeFile}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ content }),
  });

  if (res.ok) {
    files[activeFile].content = content;
    showSaveStatus('Saved');
    setTimeout(() => showSaveStatus(''), 1500);
  } else {
    showSaveStatus('Error');
  }
}

function showSaveStatus(msg) {
  document.getElementById('save-status').textContent = msg;
}

// ---------------------------------------------------------------------------
// Run / WebSocket
// ---------------------------------------------------------------------------

function connectWS() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onclose   = () => setTimeout(connectWS, 2000);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'start':
      clearTerminal();
      termAppend(`$ ${msg.cmd}\n\n`, 't-cmd');
      setRunning(true);
      break;
    case 'stdout':
      termAppend(stripAnsi(msg.data));
      break;
    case 'stderr':
      termAppend(stripAnsi(msg.data), 't-stderr');
      break;
    case 'done':
      termAppend(`\n[exited ${msg.code}]\n`, msg.code === 0 ? 't-ok' : 't-err');
      setRunning(false);
      break;
    case 'killed':
      termAppend('[killed]\n', 't-err');
      setRunning(false);
      break;
    case 'error':
      termAppend(`Error: ${msg.message}\n`, 't-err');
      setRunning(false);
      break;
  }
}

document.getElementById('btn-run').addEventListener('click', async () => {
  await saveActive();
  ws.send(JSON.stringify({ type: 'run' }));
});

document.getElementById('btn-kill').addEventListener('click', () =>
  ws.send(JSON.stringify({ type: 'kill' }))
);

document.getElementById('btn-clear').addEventListener('click', clearTerminal);

function setRunning(running) {
  document.getElementById('btn-run').disabled  =  running;
  document.getElementById('btn-kill').disabled = !running;
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

const termEl = document.getElementById('terminal-output');

function clearTerminal() { termEl.innerHTML = ''; }

function termAppend(text, cls) {
  // Highlight [PASS] and [FAIL] tokens within any line
  const html = escHtml(text)
    .replace(/\[PASS\]/g, '<span class="t-pass">[PASS]</span>')
    .replace(/\[FAIL\]/g, '<span class="t-fail">[FAIL]</span>');

  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.innerHTML = html;
  termEl.appendChild(span);
  termEl.scrollTop = termEl.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripAnsi(s) {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}
