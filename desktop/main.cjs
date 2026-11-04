// Runs Kanaa's backend from this project's folder and shows it in its own window.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.MOTION_ROOT ?? require('./root.json').root;
const PORT = process.env.MOTION_PORT ?? '8010';
const ADDRESS = `http://127.0.0.1:${PORT}`;
const START_SECONDS = 40;
const STOP_MS = 4000;
const SPLASH = path.join(ROOT, 'desktop', 'splash.html');
const SPLASH_MS = 4500; // The welcome animation's length: the editor waits for it only if it starts sooner.
const HOLD_MS = 1000; // Then a moment on "Ready" before the editor.
const SAVE_WAIT_MS = 10000;
const LOADING = `data:text/html,<body style="background:%230e0c14;color:%23b9b4cc;font:15px -apple-system;display:grid;place-items:center;height:100vh;margin:0">Starting Kanaa…</body>`;
const BUSY = new Set(['queued', 'running', 'cancelling']);

let backend = null;
let window = null;
let confirmedQuit = false;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reach = async (url) => { try { return await fetch(url, { signal: AbortSignal.timeout(1500) }); } catch { return null; } };
const waitForRendererSave = async () => {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return true;
  try {
    return await Promise.race([
      window.webContents.executeJavaScript('window.kanaaFlush ? window.kanaaFlush() : true', true),
      pause(SAVE_WAIT_MS).then(() => false),
    ]);
  } catch { return false; }
};

/** Whether phone access is on: backend/.data/phone-access.json, which Kanaa's Phone access setting writes. */
function phoneAccess() {
  try { return Boolean(JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', '.data', 'phone-access.json'), 'utf8')).enabled); } catch { return false; }
}

function startBackend() {
  const logs = app.getPath('logs');
  fs.mkdirSync(logs, { recursive: true });
  const log = fs.openSync(path.join(logs, 'backend.log'), 'a');
  // Apps opened from the Dock don't get the terminal's PATH, and Kanaa needs ffmpeg.
  // Phone access, when turned on in Kanaa, lets devices on the Wi-Fi reach it too; they still need its PIN.
  const host = phoneAccess() ? '0.0.0.0' : '127.0.0.1';
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`, KANAA_HOST: host, KANAA_PORT: PORT };
  backend = spawn(path.join(ROOT, 'backend/.venv/bin/python'), ['-m', 'uvicorn', 'app.main:app', '--host', host, '--port', PORT, '--timeout-graceful-shutdown', '3'],
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
  window = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Kanaa', backgroundColor: '#0e0c14' });
  const shown = Date.now();
  // The animated welcome from the project folder, so it can change without rebuilding; the plain one if it's missing.
  if (fs.existsSync(SPLASH)) window.loadFile(SPLASH); else window.loadURL(LOADING);
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(ADDRESS)) event.preventDefault(); });
  window.on('close', confirmClose);
  window.on('closed', () => { window = null; });

  if (await reach(`${ADDRESS}/api/stems`)) {
    // Only an older Motion from the terminal answers the API without the built page.
    const page = await reach(`${ADDRESS}/`);
    if (!page?.ok) {
      dialog.showErrorBox('Kanaa is already running', 'An older copy of Kanaa is running. Quit it, or press Ctrl+C in its terminal, Press Ctrl+C there, then open this app again.');
      confirmedQuit = true; app.quit(); return;
    }
  } else {
    startBackend();
    if (!(await waitForBackend())) {
      dialog.showErrorBox('Kanaa could not start', `Details are in ${path.join(app.getPath('logs'), 'backend.log')}`);
      confirmedQuit = true; app.quit(); return;
    }
  }
  await pause(Math.max(0, SPLASH_MS - (Date.now() - shown)));
  // A moment on "Ready", then the welcome fades out and the editor shows.
  await window?.webContents.executeJavaScript('window.kanaaReady ? window.kanaaReady() : null').catch(() => {});
  await pause(HOLD_MS);
  await window?.webContents.executeJavaScript('window.kanaaLeave ? window.kanaaLeave() : null').catch(() => {});
  window?.loadURL(ADDRESS);
}

/** Closing stops the backend, and that would stop an export. */
function confirmClose(event) {
  if (confirmedQuit) return;
  event.preventDefault();
  void (async () => {
    if (!(await waitForRendererSave())) {
      const saveChoice = await dialog.showMessageBox(window, { type: 'warning', message: 'Your latest edit could not be saved', detail: 'Keep working and try again, or quit without the latest unsaved change.', buttons: ['Keep working', 'Quit without saving'], defaultId: 0, cancelId: 0 });
      if (saveChoice.response !== 1) return;
    }
    const response = await reach(`${ADDRESS}/api/render-jobs`);
    const jobs = response?.ok ? await response.json().catch(() => []) : [];
    const list = Array.isArray(jobs) ? jobs : jobs.jobs ?? [];
    const busy = list.some((job) => BUSY.has(job.status));
    const choice = busy ? await dialog.showMessageBox(window, { type: 'warning', message: 'An export is still running', detail: 'Quitting now will stop it.', buttons: ['Keep working', 'Quit anyway'], defaultId: 0, cancelId: 0 }) : { response: 1 };
    if (choice.response === 1) { confirmedQuit = true; app.quit(); }
  })();
}

// Keeps the theme and panel layout saved before the app was renamed.
app.setPath('userData', path.join(app.getPath('appData'), 'WideAngle Motion'));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('before-quit', (event) => {
  if (!confirmedQuit && window) { event.preventDefault(); window.close(); return; }
  if (backend) { const running = backend; running.kill('SIGTERM'); setTimeout(() => running.kill('SIGKILL'), STOP_MS).unref(); }
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(open);
