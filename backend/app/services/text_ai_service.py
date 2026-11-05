"""The AI connection for words: planning edits, translating captions, and writing a post's title and description.

It talks to any OpenAI-compatible chat API: a cloud provider (OpenAI, or Claude through Anthropic's compatible
endpoint) or a model running on this Mac (Ollama, LM Studio), which needs no key and sends nothing away.
Only text goes out: the request, file names, captions and titles. Never media. Keys stay in this file on this Mac
and never appear in GET responses or projects.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import settings

FILE_NAME = 'ai-text-settings.json'
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
TIMEOUT = httpx.Timeout(120, connect=10)
# Tests swap this for an httpx.MockTransport; nothing else changes it.
transport: httpx.BaseTransport | None = None


def _path():
    return settings.data_dir / FILE_NAME


def read_settings() -> dict[str, str]:
    stored = json.loads(_path().read_text()) if _path().exists() else {}
    return {'api_key': stored.get('api_key', ''), 'base_url': stored.get('base_url', ''), 'model': stored.get('model', '')}


def is_local(base_url: str) -> bool:
    return urlsplit(base_url).hostname in LOCAL_HOSTS


def public_settings() -> dict[str, Any]:
    config = read_settings()
    ready = bool(config['base_url'] and config['model'] and (config['api_key'] or is_local(config['base_url'])))
    return {'configured': ready, 'base_url': config['base_url'], 'model': config['model'], 'has_key': bool(config['api_key']),
            'local': bool(config['base_url']) and is_local(config['base_url'])}


def save_settings(base_url: str, model: str, api_key: str | None = None, clear_key: bool = False) -> dict[str, Any]:
    base = base_url.strip().rstrip('/')
    url = urlsplit(base)
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in LOCAL_HOSTS)) or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Use an HTTPS API URL, or a local one (http://localhost…) for a model on this Mac.')
    if not model.strip():
        raise ValueError('Enter the model to use.')
    current = read_settings()
    key = '' if clear_key else api_key.strip() if api_key else current['api_key']
    config = {'api_key': key, 'base_url': base, 'model': model.strip()}
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.ai-text-', dir=settings.data_dir)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(config, output)
        os.replace(temporary, _path())
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return public_settings()


class NotConfigured(Exception):
    pass


def first_json(text: str) -> Any:
    """The first JSON object in a reply. Models sometimes wrap it in a code fence or a sentence."""
    fenced = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.S)
    candidates = [fenced.group(1)] if fenced else []
    start = text.find('{')
    if start >= 0:
        depth = 0
        for index in range(start, len(text)):
            depth += {'{': 1, '}': -1}.get(text[index], 0)
            if depth == 0:
                candidates.append(text[start:index + 1])
                break
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    raise ValueError('The AI did not answer in the expected form. Try again, or try another model.')


def ask_json(system: str, user: str) -> Any:
    """One chat turn that must answer with a JSON object."""
    config = read_settings()
    if not public_settings()['configured']:
        raise NotConfigured('Connect an AI in Ask AI → AI connection first.')
    headers = {'Content-Type': 'application/json'}
    if config['api_key']:
        headers['Authorization'] = f"Bearer {config['api_key']}"
    body = {'model': config['model'], 'temperature': 0.2,
            'messages': [{'role': 'system', 'content': system + '\nAnswer with one JSON object only.'}, {'role': 'user', 'content': user}]}
    with httpx.Client(timeout=TIMEOUT, transport=transport, follow_redirects=False) as client:
        response = client.post(config['base_url'] + '/chat/completions', headers=headers, json=body)
    if response.status_code in (401, 403):
        raise ValueError('The AI provider refused the key. Check it in AI connection.')
    if response.status_code >= 400:
        detail = ''
        try:
            detail = response.json().get('error', {}).get('message', '')
        except (ValueError, AttributeError):
            pass
        raise ValueError(f'The AI provider answered {response.status_code}{": " + detail[:200] if detail else ""}.')
    try:
        content = response.json()['choices'][0]['message']['content']
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ValueError('The AI provider sent an answer Kanaa could not read.') from exc
    return first_json(content if isinstance(content, str) else json.dumps(content))
