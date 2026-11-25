"""The AI director ("Make it cinematic"): suggests which cinematic looks a clip should have, and how tuned, and then
checks the result and corrects it. Kanaa does the seeing it can do itself, for free, on this Mac: from the clip's depth
map and a few frames it works out how much sky there is and where the horizon sits, whether there is a sun and where,
whether there are people, how bright, warm and colourful it is, and how much moves. That fact sheet and three small
frames go to the AI provider set in AI settings (any OpenAI-compatible provider, or a model on this Mac), with the
catalogue of looks and each setting's safe range. Its answer is checked against that catalogue and every value kept
within range before anyone sees it, so a model can only suggest what Kanaa can make. Nothing is applied from here: the
editor shows the plan and the person applies it (or doesn't), through the same looks and sliders as by hand.
"""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

import numpy as np

from app.services import ai_settings_service, look_tune, text_ai_service
from app.services.cutout_service import colour
from app.services.depth_mask_service import make_depth_map
from app.services.media_probe import MediaFacts

SMALL = 512  # Width of the frames sent, and looked at here.
MOMENTS = (0.2, 0.5, 0.8)  # Where in the part the frames are taken.
MOST_LOOKS = 4

# What the director may choose from: each look, its presets, and what the editor calls them.
CATALOGUE = {
    'new_sky': {'about': 'Replaces the sky and relights the land to match.', 'choices': {'sky': ['sunset', 'night', 'storm', 'blue']}, 'tune': 'sky'},
    'night': {'about': 'Day for night: turns a daytime shot into a believable night, people kept readable.', 'choices': {'mood': ['moonlit', 'dark']}, 'tune': 'night'},
    'rays': {'about': 'God rays: beams of light from the sun, blocked by trees and people. Needs a visible sun or bright sky.', 'choices': {'preset': ['soft', 'strong', 'dusty']}, 'tune': 'rays'},
    'atmosphere': {'about': 'Mist, dusty sunset haze, rain haze or low fog laid in by distance; people in front stay clear.',
                   'choices': {'preset': ['mist', 'sunset', 'rain', 'low-fog'], 'strength': ['light', 'medium', 'heavy']}, 'tune': 'atmosphere'},
    'lens': {'about': 'Cinematic lens: real depth of field. portrait keeps people sharp; dreamy glows; rack-out / rack-in move the focus.',
             'choices': {'preset': ['portrait', 'dreamy', 'rack-out', 'rack-in'], 'strength': ['soft', 'medium', 'strong']}, 'tune': 'lens'},
}
ORDER = ['new_sky', 'night', 'rays', 'atmosphere', 'lens']

SYSTEM = """You are the cinematographer and colourist inside Kanaa, a video editor. You choose cinematic looks for one
clip, from a fixed catalogue, and tune them, the way a film's director of photography would: with taste and restraint.

Rules:
- Choose only from the catalogue, with its exact names. At most {most} looks; often 1 or 2 is best. An empty list is a
  fine answer when the clip already looks right.
- Looks are applied in this order whatever order you list them: {order}.
- Respect the facts: no god rays without a sun or bright sky; no new sky when there is hardly any sky; keep people's
  faces readable (no heavy haze or night on a close-up of a face); a portrait lens needs people.
- Tune only when the preset needs it, within each setting's range. Leave out settings you would not change.
- If the person wrote what they want, follow it, within these rules.
- Give each look a short reason a non-expert understands (one sentence), and one sentence summing up the whole look.

Answer with only a JSON object, no other text:
{{"looks": [{{"kind": "<look>", <its choices, e.g. "preset": "mist", "strength": "light">, "tune": {{"<setting>": <number>}}, "why": "<one sentence>"}}],
 "summary": "<one sentence>"}}
When reviewing a result, also add "verdict": "good" or "adjust", and give the full corrected list in "looks"."""


def _frames(facts: MediaFacts, start: float, end: float) -> list[np.ndarray]:
    width = SMALL
    height = round((facts.height or 1080) * width / (facts.width or 1920) / 2) * 2
    found = []
    for share in MOMENTS:
        at = start + (end - start) * share
        raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(facts.path), '-frames:v', '1',
                              '-vf', f'{colour(facts)},scale={width}:{height}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True).stdout
        if len(raw) >= width * height * 3:
            found.append(np.frombuffer(raw[:width * height * 3], np.uint8).reshape(height, width, 3).copy())
    if not found:
        raise ValueError('Could not read this clip.')
    return found


def _nearness(depth: Path, at: float, size: tuple[int, int]) -> np.ndarray | None:
    raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{max(0.0, at):.3f}', '-i', str(depth), '-frames:v', '1',
                          '-vf', f'format=gray,scale={size[0]}:{size[1]}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(raw[:size[0] * size[1]], np.uint8).reshape(size[1], size[0]).astype(np.float32) / 255 if len(raw) >= size[0] * size[1] else None


def study(facts: MediaFacts, start: float, end: float, on_progress: Callable[[int], None] = lambda _: None,
          should_cancel: Callable[[], bool] = lambda: False) -> tuple[dict, list[np.ndarray]]:
    """What Kanaa sees in the clip by itself (no AI): a fact sheet, and the frames it looked at."""
    import cv2
    from app.services import rays_service, sky_swap_service, time_freeze_service
    frames = _frames(facts, start, end)
    middle = frames[len(frames) // 2]
    height, width = middle.shape[:2]
    depth = make_depth_map(facts, lambda value: on_progress(value * 8 // 10), should_cancel)
    near = _nearness(depth, start + (end - start) * 0.5, (width, height))
    found: dict[str, Any] = {'seconds': round(end - start, 1), 'width': facts.width, 'height': facts.height}
    if near is not None:
        sky = sky_swap_service.sky_mask(middle, near)
        found['sky_share'] = round(float(sky.mean()), 2)
        horizon = sky_swap_service.horizon_of(sky)
        found['horizon_from_top'] = None if horizon is None else round(horizon, 2)
        light = rays_service.find_light(cv2.resize(middle, (320, round(320 * height / width))), cv2.resize(near, (320, round(320 * height / width))))
        found['sun_or_bright_spot'] = None if light is None else {'x': round(light[0], 2), 'y': round(light[1], 2)}
        found['near_share'] = round(float((near > 0.6).mean()), 2)
    people = time_freeze_service.find_people(middle)
    found['people_share'] = round(float((people > 0.5).mean()), 3)
    hsv = cv2.cvtColor(middle, cv2.COLOR_BGR2HSV).astype(np.float32)
    found['brightness'] = round(float(hsv[..., 2].mean() / 255), 2)
    found['colourfulness'] = round(float(hsv[..., 1].mean() / 255), 2)
    found['warmth'] = round(float((middle[..., 2].astype(np.float32) - middle[..., 0]).mean() / 255), 2)  # Red over blue.
    greys = [cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32) for frame in frames]
    found['movement'] = round(float(np.mean([np.abs(a - b).mean() for a, b in zip(greys, greys[1:])]) / 255), 3) if len(greys) > 1 else 0.0
    on_progress(90)
    return found, frames


def catalogue() -> dict:
    """The catalogue as the model sees it: each look's choices, and each setting's range and preset values."""
    from app.api.timeline_routes import look_tuning
    tuning = look_tuning()
    return {kind: {'about': entry['about'], 'choices': entry['choices'], 'settings_range': look_tune.KNOBS[entry['tune']],
                   'preset_values': tuning['defaults'][entry['tune']]} for kind, entry in CATALOGUE.items()}


def checked(answer: Any) -> dict:
    """The model's answer kept to what Kanaa can make: known looks, known choices, settings within range, in order."""
    if not isinstance(answer, dict):
        raise ValueError('The AI did not answer in the expected form. Try again, or try another model.')
    looks, seen = [], set()
    for item in answer.get('looks') or []:
        if not isinstance(item, dict) or item.get('kind') not in CATALOGUE or item['kind'] in seen:
            continue
        entry = CATALOGUE[item['kind']]
        look: dict[str, Any] = {'kind': item['kind']}
        for name, options in entry['choices'].items():
            look[name] = item.get(name) if item.get(name) in options else options[0] if name != 'strength' else 'medium' if 'medium' in options else options[0]
        tune = look_tune.parse(item.get('tune'), entry['tune'])
        if tune:
            look['tune'] = tune
        look['why'] = str(item.get('why') or '')[:240]
        looks.append(look)
        seen.add(item['kind'])
    looks.sort(key=lambda each: ORDER.index(each['kind']))
    verdict = answer.get('verdict')
    return {'looks': looks[:MOST_LOOKS], 'summary': str(answer.get('summary') or '')[:300], **({'verdict': verdict} if verdict in ('good', 'adjust') else {})}


def _picture(frame: np.ndarray) -> dict:
    import cv2
    ok, data = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(data.tobytes()).decode()}}


def ask(found: dict, frames: list[np.ndarray], wish: str = '', current: list[dict] | None = None, results: list[np.ndarray] | None = None) -> dict:
    """One turn with the vision model: a plan (or, given `results`, a review of the plan's result). Checked."""
    connection, model = vision_client()
    text = {'clip_facts': found, 'catalogue': catalogue()}
    if wish.strip():
        text['what_the_person_wants'] = wish.strip()[:300]
    content: list[dict] = []
    if results:
        text['looks_applied'] = current or []
        content.append({'type': 'text', 'text': 'Review this result. The first pictures are the clip before, the last ones after the looks were applied.\n' + json.dumps(text)})
        content += [_picture(frame) for frame in frames] + [_picture(frame) for frame in results]
    else:
        content.append({'type': 'text', 'text': 'Choose the looks for this clip.\n' + json.dumps(text)})
        content += [_picture(frame) for frame in frames]
    try:
        reply = connection.chat.completions.create(model=model, messages=[{'role': 'system', 'content': SYSTEM.format(most=MOST_LOOKS, order=' -> '.join(ORDER))},
                                                                         {'role': 'user', 'content': content}])
    except Exception as exc:  # The provider's own message is the most useful one.
        raise ValueError(text_ai_service.explain(exc, model)) from exc
    return checked(text_ai_service.first_json(reply.choices[0].message.content or ''))


def vision_client():
    """The configured provider, and the model that sees pictures (the vision model, else the text model)."""
    config = ai_settings_service.read_settings()
    if not ai_settings_service.public_settings().get('vision_configured'):
        raise text_ai_service.NotConfigured('Set a vision model (or a text model that can see pictures) and an API key in AI settings first.')
    connection, _ = text_ai_service.client(require_text=False)
    return connection, config['vision_model'] or config['text_model']
