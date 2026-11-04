"""Phone access: other devices on the home Wi-Fi may use Kanaa after entering a PIN shown on this Mac.

Off unless turned on. The Mac itself (loopback) never needs the PIN, and only the Mac can see the PIN, turn access on
or off, or make a new PIN. A phone that enters the right PIN gets a session cookie for 30 days; a new PIN signs every
phone out. Wrong PINs are slowed down per device, and too many in all lock phone access until a new PIN is made.

The Mac app reads this file when it starts: turned on, it lets the server listen on the Wi-Fi as well (KANAA_HOST is
then 0.0.0.0), so turning it on takes a restart; turning it off works at once.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import Optional

from app.core.config import settings

COOKIE = 'kanaa_phone'
SESSION_SECONDS = 30 * 24 * 3600
PIN_DIGITS = 6
TRIES_PER_DEVICE = 5  # Wrong PINs in a row before that device waits.
WAIT_SECONDS = 60
TRIES_IN_ALL = 30  # Wrong PINs, from anywhere, before phone access locks until a new PIN.
LOCAL = {'127.0.0.1', '::1', 'localhost', 'testclient'}
_lock = threading.Lock()
_misses: dict[str, tuple[int, float]] = {}  # Device: wrong tries in a row, and when it may try again.


def path() -> Path:
    return settings.data_dir / 'phone-access.json'


def _read() -> dict:
    try:
        return json.loads(path().read_text())
    except (OSError, ValueError):
        return {}


def _write(state: dict) -> None:
    path().parent.mkdir(parents=True, exist_ok=True)
    temporary = path().with_suffix('.tmp')
    temporary.write_text(json.dumps(state))
    os.chmod(temporary, 0o600)
    temporary.replace(path())


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def is_local(host: Optional[str]) -> bool:
    return (host or '') in LOCAL


def enabled() -> bool:
    return bool(_read().get('enabled'))


def wifi_address() -> Optional[str]:
    """This Mac's address on the local network. Nothing is sent: connecting a UDP socket only picks the route."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(('10.255.255.255', 1))
        address = probe.getsockname()[0]
        return None if address.startswith('127.') else address
    except OSError:
        return None
    finally:
        probe.close()


def listening_on_wifi() -> bool:
    return os.getenv('KANAA_HOST', '127.0.0.1') in ('0.0.0.0', '::')


def status() -> dict:
    state = _read()
    return {'enabled': bool(state.get('enabled')), 'pin': state.get('pin') if state.get('enabled') else None, 'locked': bool(state.get('locked')),
            'address': wifi_address(), 'port': int(os.getenv('KANAA_PORT', '8010')), 'listening': listening_on_wifi(),
            'phones': sum(1 for session in state.get('sessions', []) if session.get('until', 0) > time.time())}


def new_pin(state: Optional[dict] = None) -> dict:
    """A fresh PIN; every phone signed in before has to enter it."""
    state = state if state is not None else _read()
    state.update(pin=''.join(secrets.choice('0123456789') for _ in range(PIN_DIGITS)), sessions=[], locked=False, misses=0)
    _misses.clear()
    return state


def set_enabled(on: bool) -> dict:
    with _lock:
        state = _read()
        if on and not state.get('pin'):
            state = new_pin(state)
        state['enabled'] = on
        _write(state)
    return status()


def renew_pin() -> dict:
    with _lock:
        _write(new_pin())
    return status()


def sign_in(pin: str, device: str) -> tuple[Optional[str], Optional[str]]:
    """A session token for the right PIN, or why not."""
    with _lock:
        state = _read()
        if not state.get('enabled'):
            return None, 'Phone access is off. Turn it on in Kanaa on your Mac.'
        if state.get('locked'):
            return None, 'Too many wrong PINs. Make a new PIN in Kanaa on your Mac.'
        tries, until = _misses.get(device, (0, 0.0))
        if until > time.time():
            return None, f'Too many tries. Wait {int(until - time.time()) + 1} seconds.'
        if not hmac.compare_digest(str(pin).strip().encode(), str(state.get('pin', '')).encode()) or not state.get('pin'):
            tries += 1
            _misses[device] = (0, time.time() + WAIT_SECONDS) if tries >= TRIES_PER_DEVICE else (tries, 0.0)
            state['misses'] = state.get('misses', 0) + 1
            if state['misses'] >= TRIES_IN_ALL:
                state['locked'] = True
            _write(state)
            return None, 'That PIN is not right.'
        _misses.pop(device, None)
        token = secrets.token_urlsafe(32)
        now = time.time()
        state['sessions'] = [session for session in state.get('sessions', []) if session.get('until', 0) > now] + [{'hash': _digest(token), 'until': now + SESSION_SECONDS}]
        state['misses'] = 0
        _write(state)
        return token, None


def signed_in(token: Optional[str]) -> bool:
    if not token:
        return False
    state = _read()
    if not state.get('enabled') or state.get('locked'):
        return False
    wanted = _digest(token)
    return any(hmac.compare_digest(session.get('hash', ''), wanted) and session.get('until', 0) > time.time() for session in state.get('sessions', []))


LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kanaa</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e0c14; color: #f1eff8; font: 16px -apple-system, BlinkMacSystemFont, sans-serif; }
  form { width: min(320px, 86vw); display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
  .mark { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(180deg, #7c5cf0, #5c3ed6); display: grid; place-items: center; }
  .mark svg { width: 26px; height: 26px; margin-left: 4px; }
  h1 { margin: 0; font-size: 26px; } h1 small { display: block; font-size: 14px; color: #b9b4cc; font-weight: 500; margin-top: 4px; }
  p { margin: 0; color: #9a94b0; font-size: 14px; line-height: 1.4; }
  input { width: 100%; box-sizing: border-box; padding: 14px; border-radius: 12px; border: 1px solid #ffffff22; background: #1a1724; color: #fff; font-size: 26px; letter-spacing: .4em; text-align: center; }
  input:focus { outline: 2px solid #7c5cf0; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 12px; background: #7c5cf0; color: #fff; font-size: 16px; font-weight: 600; }
  button:disabled { opacity: .6; }
  #problem { color: #ff8fa3; min-height: 1.2em; }
</style></head>
<body><form id="form">
  <div class="mark"><svg viewBox="0 0 26 26"><path d="M5 3 L5 23 L22 13 Z" fill="#fff"/></svg></div>
  <h1>Kanaa<small lang="ta">கனா</small></h1>
  <p>Enter the PIN shown in Kanaa on your Mac, under Phone access.</p>
  <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-label="PIN" autofocus>
  <button id="go">Open Kanaa</button>
  <p id="problem" role="alert"></p>
</form>
<script>
  const form = document.getElementById('form'), go = document.getElementById('go'), problem = document.getElementById('problem');
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); go.disabled = true; problem.textContent = '';
    try {
      const answer = await fetch('/api/phone/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: document.getElementById('pin').value }) });
      if (answer.ok) { location.reload(); return; }
      problem.textContent = (await answer.json()).detail || 'Could not sign in.';
    } catch { problem.textContent = 'Could not reach Kanaa. Is your Mac awake and on this Wi-Fi?'; }
    go.disabled = false;
  });
</script></body></html>"""
