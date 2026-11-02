"""Server-side credentials. API keys never appear in GET responses or project recipes."""
import json
import os
import tempfile
from urllib.parse import urlsplit
from app.core.config import settings

DEFAULT_MODEL = 'gpt-image-2.5-flare'
DEFAULT_URL = 'https://api.openai.com/v1'


def read_settings():
    path = settings.data_dir / 'ai-settings.json'
    stored = json.loads(path.read_text()) if path.exists() else {}
    return {'api_key': os.getenv('OPENAI_API_KEY') or stored.get('api_key', ''),
            'base_url': stored.get('base_url', DEFAULT_URL), 'model': stored.get('model', DEFAULT_MODEL)}


def public_settings():
    config = read_settings()
    return {'configured': bool(config['api_key']), 'base_url': config['base_url'], 'model': config['model'],
            'key_source': 'environment' if os.getenv('OPENAI_API_KEY') else 'local' if config['api_key'] else None}


def save_settings(api_key, base_url, model, clear_key=False):
    url = urlsplit(base_url.strip().rstrip('/'))
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in {'localhost', '127.0.0.1', '::1'})) or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Use an HTTPS API URL, or a local HTTP provider.')
    path = settings.data_dir / 'ai-settings.json'
    current = json.loads(path.read_text()) if path.exists() else {}
    key = '' if clear_key else api_key.strip() if api_key is not None else current.get('api_key', '')
    if not model.strip():
        raise ValueError('Enter an image model.')
    config = {'api_key': key, 'base_url': base_url.strip().rstrip('/'), 'model': model.strip()}
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.ai-settings-', dir=settings.data_dir)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(config, output)
        os.replace(temporary, settings.data_dir / 'ai-settings.json')
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return public_settings()
