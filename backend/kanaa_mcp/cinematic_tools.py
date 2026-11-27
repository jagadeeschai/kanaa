"""The MCP tools for Kanaa's cinematic and music features, as the editor has them: cinematic looks (and film stocks,
the look preview, the AI director), the song's beats (velocity edit, beat pulse, shake on the beat), lyric sync,
auto-ducking, the project's finish, and pictures in other forms (sketch, painting, 3D glide, a person cut out).

Every change to a project goes through the server's save(), so it is checked against Kanaa's timeline rules and
`undo` takes it back, like every other tool. The rules themselves are kanaa_mcp/looks.py (the editor's own, ported)."""
from __future__ import annotations

import base64
import copy
import tempfile
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import Image
from mcp.server.mcpserver.exceptions import ToolError

from kanaa_mcp import looks as rules

LookList = list[dict]


def register(server, api, media, timeline_of, save, find, look_up, list_media, READ_ONLY, CHANGES) -> None:

    def main_clip(timeline: dict, clip_id: str) -> dict:
        layer, clip = find(timeline, clip_id)
        if 'media_id' not in clip or layer['kind'] != 'video':
            raise ToolError(f'{clip_id} is not a video clip.')
        return clip

    def made_id(started: dict, timeout: float = 3600) -> int:
        if started.get('output_photo_id') is not None:
            return int(started['output_photo_id'])
        return int(look_up(api.wait(started['job_id'], timeout=timeout), 'output_photo_id'))

    def song_of(timeline: dict) -> dict | None:
        """The song the beats come from: the longest sound with a song file on an audible track (beats.ts beatSound)."""
        sounds = [sound for layer in timeline['layers'] if layer['kind'] == 'audio' and not layer.get('muted')
                  for sound in layer['items'] if not sound.get('muted') and sound.get('asset_id')]
        return max(sounds, key=lambda sound: (sound['out'] - sound['in']) / sound.get('speed', 1), default=None)

    def beats_of(timeline: dict) -> list[float]:
        song = song_of(timeline)
        if not song:
            raise ToolError('This project has no song on an audio track: add_music or a lyric video first.')
        heard = api.get(f"/video-audio/{song['asset_id']}/beats").get('beats') or []
        speed = song.get('speed', 1)
        return [round(song['start'] + (beat - song['in']) / speed, 3) for beat in heard if song['in'] <= beat <= song['out']]

    def make_looks(clip: dict, wanted: LookList) -> dict:
        """Makes the looks one after another from the clip's original part (as the editor's restyle); the new clip."""
        part = rules.original_part(clip)
        source, seconds, made = dict(part), part['end'] - part['start'], None
        for look in wanted:
            settings = {key: value for key, value in look.items() if key != 'kind'}
            if look['kind'] in ('shake', 'weave'):  # Each cut wobbles its own way, the same whatever looks come before.
                settings.update(original_media_id=part['media'], original_in=part['start'], original_out=part['end'])
            made = made_id(api.post(f"/photos/{source['media']}/{rules.ROUTE[look['kind']]}", {'start': source['start'], 'end': source['end'], **settings}))
            seconds = rules.length_after(seconds, look)
            source = {'media': made, 'start': 0, 'end': round(seconds, 3)}
        return rules.set_looks(clip, part, wanted, None if made is None else {'media': made, 'seconds': round(seconds, 3)})

    def planned(clip: dict, looks: LookList | None, film_stock: str | None, beats) -> LookList:
        """The looks a clip gets; `beats()` gives the song's beats, only asked for when a shake is on the beat."""
        wanted = rules.by_order([rules.checked(look) for look in looks]) if looks is not None else rules.looks_of(clip)
        if film_stock is not None:
            wanted = rules.with_stock(wanted, None if film_stock == 'none' else film_stock)
        for look in wanted:
            reason = rules.cannot_look(clip, look['kind'])
            if reason:
                raise ToolError(f"{clip['id']}: {reason}")
            if look['kind'] == 'shake' and look['preset'] == 'beat' and not look.get('hits'):
                look['hits'] = rules.hits_for(clip, beats())
                if not look['hits']:
                    raise ToolError(f"{clip['id']}: no beats of the song fall in this clip, so there is nothing to shake on.")
        return wanted

    @server.tool(annotations=READ_ONLY)
    def look_options() -> dict:
        """What cinematic looks Kanaa makes and their choices (the first is the default), the film stocks, the
        velocity edits, auto-duck presets, and each look's fine-tuning settings with their safe ranges and preset values."""
        tuning = api.get('/look-tuning')
        return {'order': rules.ORDER, 'choices': rules.CHOICES, 'film_stocks': rules.FILM_STOCKS, 'velocity': list(rules.VELOCITY),
                'auto_duck': {'light': 'dips 6 dB', 'medium': 'dips 12 dB', 'strong': 'dips 18 dB'}, 'tuning': tuning,
                'notes': ['Looks are made copies of a video clip (not photos), stacked in `order`; each can take "tune": {setting: value}.',
                          'colour match needs "reference": {"media", "start", "end"} (the shot to match).',
                          'shake preset "beat" jolts on each beat of the project\'s song (found for you).',
                          'Moving looks (shake, weave, breathing, slow motion, blur) do not show in preview_looks; look after applying.']}

    @server.tool(annotations=CHANGES)
    def set_cinematic_looks(project_id: int, clip_ids: list[str], looks: LookList | None = None, film_stock: Literal['classic', 'retro', 'docu', 'dream', 'action', 'none'] | None = None) -> list[dict]:
        """Gives video clips exactly these cinematic looks (as the editor's Cinematic tab): `looks` [{"kind", choices...,
        "tune"?}] replaces the clip's looks ([] takes them all off); without it the clip keeps its own. `film_stock` then
        sets the camera and film looks (lens, halation, shake, weave, breathing, blur) to that bundle, keeping the
        scene's own (match, sky, night, rays, atmosphere, slow motion); "none" takes the bundle off. Each look is made on
        this Mac's GPU (the first time can take a minute a look); all clips change as one undo step. See look_options."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        heard: list = []
        beats = lambda: heard or heard.extend(beats_of(after)) or heard
        done = []
        for clip_id in clip_ids:
            clip = main_clip(after, clip_id)
            wanted = planned(clip, looks, film_stock, beats)
            if wanted == rules.looks_of(clip):
                done.append({'clip_id': clip_id, 'looks': [look['kind'] for look in wanted], 'changed': False})
                continue
            changed = make_looks(clip, wanted)
            clip.clear(); clip.update(changed)
            done.append({'clip_id': clip_id, 'looks': [look['kind'] for look in wanted], 'changed': True, 'media_id': clip['media_id']})
        if any(item['changed'] for item in done):
            save(project_id, before, after, f"Cinematic looks on {len(clip_ids)} clip{'s' if len(clip_ids) != 1 else ''}")
        return done

    @server.tool(annotations=READ_ONLY)
    def preview_looks(project_id: int, clip_id: str, looks: LookList, at: float | None = None) -> list[Image]:
        """A still of a clip before and after `looks` (not applied), at `at` seconds into the clip (default its middle),
        as the Cinematic tab's preview: quick, to try looks and fine-tuning before set_cinematic_looks. Moving looks
        (shake, weave, breathing, slow motion, blur) are left out of the still."""
        clip = main_clip(timeline_of(project_id), clip_id)
        part = rules.original_part(clip)
        local = (rules.clip_length(clip) / 2) if at is None else max(0.0, min(at, rules.clip_length(clip)))
        status = api.wait(api.post('/look-preview', {'media': part['media'], 'start': part['start'], 'end': part['end'], 'at': local,
                                                     'looks': rules.by_order([rules.checked(look) for look in looks])})['job_id'])
        found = status if status.get('before') else (status.get('result') or {})
        pictures = []
        for key in ('before', 'after'):
            data = str(found.get(key) or '')
            if ',' in data:
                pictures.append(Image(data=base64.b64decode(data.split(',', 1)[1]), format='jpeg'))
        if not pictures:
            raise ToolError('Kanaa made no preview for that clip.')
        return pictures

    @server.tool(annotations=READ_ONLY)
    def make_it_cinematic(project_id: int, clip_id: str, wish: str = '') -> dict:
        """The AI director: looks the clip over and suggests cinematic looks, tuned, with a reason for each (uses the AI
        provider in Kanaa's AI settings; costs a little). Nothing changes: give its `looks` to set_cinematic_looks."""
        clip = main_clip(timeline_of(project_id), clip_id)
        part = rules.original_part(clip)
        status = api.wait(api.post('/director', {'media_id': part['media'], 'start': part['start'], 'end': part['end'], 'wish': wish[:300]})['job_id'], timeout=900)
        return {'looks': look_up(status, 'looks') or [], 'summary': look_up(status, 'summary')}

    @server.tool(annotations=READ_ONLY)
    def song_beats(project_id: int) -> dict:
        """The beats of the project's song, in timeline seconds, and its tempo (BPM): for cutting and moving on the beat."""
        beats = beats_of(timeline_of(project_id))
        return {'bpm': rules.song_tempo(beats), 'beats': beats}

    @server.tool(annotations=CHANGES)
    def velocity_edit(project_id: int, preset: Literal['smooth', 'punchy', 'dramatic', 'off'], clip_ids: list[str] | None = None) -> dict:
        """Velocity on the beat: each clip races between the song's beats and slows into each hit (a speed ramp that
        keeps the clip's length, so cuts stay on the beat). Every main-track clip, or `clip_ids`; "off" takes the ramp
        away. Clips with fewer than two beats, reversed or frozen ones are left alone. Ramped clips play without sound."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        beats = beats_of(after) if preset != 'off' else []
        main = next(layer for layer in after['layers'] if layer['kind'] == 'video')
        changed, skipped = [], []
        for clip in main['items']:
            if clip_ids is not None and clip['id'] not in clip_ids or 'media_id' not in clip:
                continue
            if preset == 'off':
                if clip.get('ramp'):
                    clip['ramp'] = None; changed.append(clip['id'])
                continue
            ramp = None if clip.get('reverse') or clip.get('freeze') is not None or clip.get('freeze3d') else rules.velocity_ramp(clip, beats, preset)
            if ramp is None:
                skipped.append(clip['id']); continue
            clip['ramp'] = ramp; changed.append(clip['id'])
        if changed:
            save(project_id, before, after, f'Velocity edit ({preset})')
        return {'changed': changed, 'left_alone': skipped}

    @server.tool(annotations=CHANGES)
    def beat_pulse(project_id: int, clip_ids: list[str] | None = None, strength: float = 0.5, size: float = 0.035, off: bool = False) -> dict:
        """Pushes the picture gently on every beat of the song, the pulse matched to the song's tempo and each clip's
        first beat. Every main-track clip, or `clip_ids` (any layer); strength 0..1, size 0.005..0.15; off takes it away."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        beats = [] if off else beats_of(after)
        wanted = clip_ids or [clip['id'] for clip in next(layer for layer in after['layers'] if layer['kind'] == 'video')['items'] if 'media_id' in clip]
        changed = []
        for clip_id in wanted:
            _, clip = find(after, clip_id)
            pulse = None if off else rules.pulse_for(clip, beats, {'strength': max(0.0, min(1.0, strength)), 'size': max(0.005, min(0.15, size)), 'bpm': 120, 'offset': 0})
            if off or pulse:
                clip['beat_pulse'] = pulse; changed.append(clip_id)
        if changed:
            save(project_id, before, after, 'Beat pulse' if not off else 'Beat pulse off')
        return {'changed': changed, 'bpm': rules.song_tempo(beats) if beats else None}

    @server.tool(annotations=CHANGES)
    def auto_duck(project_id: int, sound_id: str, preset: Literal['light', 'medium', 'strong', 'off'] = 'medium', threshold_db: float | None = None,
                  depth_db: float | None = None, fade_s: float | None = None) -> dict:
        """Auto-ducking on a music sound: it dips under the timeline's other sound (speech, vocals, clips) by the preset's
        amount (light 6 dB, medium 12, strong 18), the same in preview and export; fine-tune threshold (-60..0 dB),
        depth (0..30 dB) and fade (0.01..3 s). "off" stops it dipping."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        layer, sound = find(after, sound_id)
        if layer['kind'] != 'audio':
            raise ToolError(f'{sound_id} is not a sound on an audio track.')
        if preset == 'off':
            sound.update(duck=False)
        else:
            sound.update(duck=True, duck_preset=preset, duck_threshold=threshold_db, duck_depth=depth_db, duck_fade=fade_s)
        save(project_id, before, after, f'Auto-duck {preset}')
        return {key: sound.get(key) for key in ('duck', 'duck_preset', 'duck_threshold', 'duck_depth', 'duck_fade')}

    @server.tool(annotations=CHANGES)
    def set_finish(project_id: int, grade: float = 0.5, glow: float = 0.3, vignette: float = 0.4, grain: float = 0.2, letterbox: bool = False, off: bool = False) -> dict:
        """A cinematic finish over the whole video, under the captions: grade (teal shadows, orange highlights), glow,
        vignette and film grain, each 0 (off) to 1; letterbox adds bars. off takes the finish away."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        clamp = lambda value: round(max(0.0, min(1.0, float(value))), 3)
        after['finish'] = None if off else {'letterbox': bool(letterbox), 'grade': clamp(grade), 'glow': clamp(glow), 'vignette': clamp(vignette), 'grain': clamp(grain)}
        save(project_id, before, after, 'Finish' if not off else 'Finish off')
        return {'finish': after['finish']}

    @server.tool(annotations=READ_ONLY)
    def sync_lyrics(song_asset_id: str, lines: list[str] | None = None, lrc_path: str | None = None, language: str = 'ta') -> dict:
        """Listens to the song and finds when each lyric line is sung: [{"start", "end", "text", "heard"}]. Give the
        lines, or an LRC file (its own times are only a guess: songs are often re-rendered, so check against these).
        Lines it could not hear clearly ("heard": false) are estimates: when most heard lines are off from the LRC by
        the same amount, shift the rest by it. Takes a minute or two."""
        from kanaa_mcp.lyrics import read_lrc
        if lrc_path:
            path = Path(lrc_path).expanduser()
            if not path.is_file():
                raise ToolError(f'There is no file at {lrc_path}.')
            lines = [cue['text'] for cue in read_lrc(path.read_text(encoding='utf-8', errors='replace'))]
        if not lines:
            raise ToolError('Give the lyric lines or an LRC file.')
        status = api.wait(api.post('/lyric-sync', {'lyrics': '\n'.join(lines), 'audio_asset_id': song_asset_id, 'language': language})['job_id'], timeout=1800)
        cues = look_up(status, 'lyric_cues') or []
        return {'cues': [{'start': cue['start'], 'end': cue['end'], 'text': cue.get('text', ''), 'heard': not cue.get('review')} for cue in cues],
                'warning': look_up(status, 'warning')}

    @server.tool(annotations=CHANGES)
    def picture_forms(media_id: int, sketch: bool = True, paint: Literal['watercolour', 'oil', 'dream', 'none'] = 'watercolour',
                      glide: Literal['push', 'pull', 'drift', 'drift-left', 'rise', 'sink', 'sweep', 'crane', 'glide-back', 'none'] = 'push', glide_seconds: float = 8.0) -> dict:
        """The same picture in other forms, so it can come back later in a video without repeating: a pencil `sketch`, a
        `paint`ing (both made on this Mac, no AI) and a 3D camera `glide` through it (from its depth, a video of
        `glide_seconds`). Returns each one's media id (made once; asking again finds them)."""
        from kanaa_mcp.lyric_builder import painting
        item = media(media_id)
        if item.get('media_type') != 'image':
            raise ToolError('Give a photo or picture (not a video).')
        picture, title = Path(item['absolute_path']), Path(item['filename']).stem
        out: dict = {}
        if sketch:
            out['sketch'] = painting(api, list_media, picture, title, 'pencil')
        if paint != 'none':
            out['paint'] = painting(api, list_media, picture, title, paint)
        if glide != 'none':
            out['glide'] = made_id(api.post(f'/photos/{media_id}/depth-motion', {'seconds': round(max(0.5, min(120.0, glide_seconds)), 2), 'move': glide}), timeout=1800)
        return out

    @server.tool(annotations=CHANGES)
    def cut_out_person(media_id: int, rim_colour: str | None = None) -> dict:
        """The main person in a photo, cut out (Apple Vision, on this Mac) as a transparent picture in the library: for
        hero cards, pop-outs and titles behind people. `rim_colour` (#rrggbb) adds a glowing edge. Returns its media id."""
        import cv2
        import numpy as np
        from app.services.time_freeze_service import find_people
        item = media(media_id)
        if item.get('media_type') != 'image':
            raise ToolError('Give a photo (not a video).')
        photo = cv2.imread(item['absolute_path'])
        mask = find_people(photo)
        hard = (mask > 0.5).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(hard)
        if count < 2:
            raise ToolError('Kanaa found no person in that photo.')
        mask = cv2.GaussianBlur((mask * (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])))).astype(np.float32), (0, 0), 1.2)
        ys, xs = np.where(mask > 0.3)
        crop, alpha = photo[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.float32), mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        if rim_colour:
            colour = np.array([int(rim_colour[i:i + 2], 16) for i in (5, 3, 1)], np.float32)
            edge = cv2.GaussianBlur(np.clip(alpha - cv2.erode(alpha, np.ones((9, 9), np.uint8)), 0, 1), (0, 0), 4)[..., None]
            crop = np.clip(crop + edge * colour * 1.6, 0, 255)
        side = np.clip(np.minimum(np.arange(alpha.shape[1]), np.arange(alpha.shape[1])[::-1]) / 40.0, 0, 1)  # Soft where the photo itself ended.
        out = np.dstack([crop.astype(np.uint8), (alpha * side[None, :] * 255).astype(np.uint8)])
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / f"{Path(item['filename']).stem} (cut-out).png"
            cv2.imwrite(str(target), out)
            made = api.upload('/media', target)
        return {'media_id': int(made['id']), 'width': int(out.shape[1]), 'height': int(out.shape[0])}
