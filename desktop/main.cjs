// Runs Motion's backend from this project's folder and shows it in its own window.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.MOTION_ROOT ?? require('./root.json').root;
const PORT = process.env.MOTION_PORT ?? '8010';
const ADDRESS = `http://127.0.0.1:${PORT}`;
const START_SECONDS = 40;
const STOP_MS = 4000;
const LOADING = `data:text/html,<body style="background:%230e0c14;color:%23b9b4cc;font:15px -apple-system;display:grid;place-items:center;height:100vh;margin:0">Starting WideAngle Motion…</body>`;
const BUSY = new Set(['queued', 'running', 'cancelling']);

let backend = null;
let window = null;
let confirmedQuit = false;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reach = async (url) => { try { return await fetch(url, { signal: AbortSignal.timeout(1500) }); } catch { return null; } };

function startBackend() {
  const logs = app.getPath('logs');
  fs.mkdirSync(logs, { recursive: true });
  const log = fs.openSync(path.join(logs, 'backend.log'), 'a');
  // Apps opened from the Dock don't get the terminal's PATH, and Motion needs ffmpeg.
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };
  backend = spawn(path.join(ROOT, 'backend/.venv/bin/python'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', PORT, '--timeout-graceful-shutdown', '3'],
    { cwd: path.join(ROOT, 'backend'), env, stdio: ['ignore', log, log] });
  backend.on('exit', () => { backend = null; });
  backend.on('error', () => { backend = null; });
}

async function waitForBackend() {
  for (let tried = 0; tried < START_SECONDS * 2; tried += 1) {
    if (await reach(`${ADDRESS}/api/stems`)) return true;
    if (!backend) return false;
    await pause(500);
  }
  return false;
}

async function open() {
  window = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'WideAngle Motion', backgroundColor: '#0e0c14' });
  window.loadURL(LOADING);
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(ADDRESS)) event.preventDefault(); });
  window.on('close', confirmClose);
  window.on('closed', () => { window = null; });

  if (await reach(`${ADDRESS}/api/stems`)) {
    // Only an older Motion from the terminal answers the API without the built page.
    const page = await reach(`${ADDRESS}/`);
    if (!page?.ok) {
      dialog.showErrorBox('Motion is already running', 'Motion is running in a terminal. Press Ctrl+C there, then open this app again.');
      confirmedQuit = true; app.quit(); return;
    }
  } else {
    startBackend();
    if (!(await waitForBackend())) {
      dialog.showErrorBox('Motion could not start', `Details are in ${path.join(app.getPath('logs'), 'backend.log')}`);
      confirmedQuit = true; app.quit(); return;
    }
  }
  window?.loadURL(ADDRESS);
}

/** Closing stops the backend, and that would stop an export. */
function confirmClose(event) {
  if (confirmedQuit) return;
  event.preventDefault();
  void (async () => {
    const response = await reach(`${ADDRESS}/api/render-jobs`);
    const jobs = response?.ok ? await response.json().catch(() => []) : [];
    const list = Array.isArray(jobs) ? jobs : jobs.jobs ?? [];
    const busy = list.some((job) => BUSY.has(job.status));
    const choice = busy ? await dialog.showMessageBox(window, { type: 'warning', message: 'An export is still running', detail: 'Quitting now will stop it.', buttons: ['Keep working', 'Quit anyway'], defaultId: 0, cancelId: 0 }) : { response: 1 };
    if (choice.response === 1) { confirmedQuit = true; app.quit(); }
  })();
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('before-quit', (event) => {
  if (!confirmedQuit && window) { event.preventDefault(); window.close(); return; }
  if (backend) { const running = backend; running.kill('SIGTERM'); setTimeout(() => running.kill('SIGKILL'), STOP_MS).unref(); }
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(open);
