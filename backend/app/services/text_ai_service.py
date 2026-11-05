"""Ask AI's words: planning edits, translating captions, and writing a post's title and description.

It uses the same AI connection as image generation (AI settings: provider address and API key, from
ai_settings_service.py) with its own text model, through the OpenAI library, so any OpenAI-compatible provider works:
a cloud service with a key, or a model on this Mac (Ollama, LM Studio) without one. Only text is sent: the request,
file names, captions and titles. Never media.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx
import openai

from app.services import ai_settings_service

TIMEOUT = httpx.Timeout(120, connect=10)
# Tests swap this for an httpx.MockTransport; nothing else changes it.
transport: httpx.BaseTransport | None = None


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


def client() -> tuple[openai.OpenAI, str]:
    """An OpenAI client for the configured provider, and the text model to ask."""
    config = ai_settings_service.read_settings()
    if not ai_settings_service.public_settings()['text_configured']:
        raise NotConfigured('Set a text model (and an API key for a cloud provider) in AI settings first.')
    # A provider on this Mac takes no key, but the library needs one to send; any word will do.
    key = config['api_key'] or 'local'
    http = httpx.Client(timeout=TIMEOUT, transport=transport, follow_redirects=False)
    return openai.OpenAI(api_key=key, base_url=config['base_url'], http_client=http, max_retries=1), config['text_model']


def ask_json(system: str, user: str) -> Any:
    """One chat turn that must answer with a JSON object."""
    connection, model = client()
    try:
        reply = connection.chat.completions.create(model=model, temperature=0.2, messages=[
            {'role': 'system', 'content': system + '\nAnswer with one JSON object only.'}, {'role': 'user', 'content': user}])
    except openai.AuthenticationError as exc:
        raise ValueError('The AI provider refused the API key. Check it in AI settings.') from exc
    except openai.NotFoundError as exc:
        raise ValueError(f'The AI provider has no model called "{model}". Check the text model in AI settings.') from exc
    except openai.RateLimitError as exc:
        raise ValueError('The AI provider says too many requests, or no credits left. Try again later.') from exc
    except openai.APIStatusError as exc:
        raise ValueError(f'The AI provider answered {exc.status_code}: {str(exc.message)[:200]}') from exc
    except openai.APIConnectionError as exc:
        raise ValueError('Could not reach the AI provider. Check the address in AI settings, or that it is running.') from exc
    content = reply.choices[0].message.content if reply.choices else None
    if not content:
        raise ValueError('The AI provider sent an empty answer.')
    return first_json(content)
