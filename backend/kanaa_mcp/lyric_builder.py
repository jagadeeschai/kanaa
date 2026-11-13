"""The lyric video builder, shared by the MCP tool (an agent) and Kanaa's lyric screen (a person), so both make the
same finished video. `api` is a KanaaApi; media, list_media, timeline_of and save are the MCP server's helpers."""
from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver.exceptions import ToolError

from kanaa_mcp.server import validate


def build_lyric_video(api, media, list_media, timeline_of, save, look_up, intro_for, *, name: str, song_asset_id: str, song_seconds: float, cues: list[dict], scenes: list[dict],
                      look: Literal['energetic', 'romantic', 'calm'] = 'romantic', lyric_motion: Literal['into_clear', 'plain', 'in_scene'] = 'into_clear', three_d: bool = False, lights: bool = True,
                      lyric_font: Literal['standard', 'elegant', 'modern', 'playful', 'handwritten'] = 'elegant', lyric_colour: str = '#ffffff', lyric_size: int = 50,
                      canvas: Literal['landscape', 'portrait', 'square'] = 'landscape', presents: str | None = None, song_by: str | None = None,
                      music: str | None = None, presented_by: str | None = None, footer: str | None = None, accent: str = '#e8b04a',
                      logo_media_id: int | None = None, brand_intro: bool = True, project_id: int | None = None, house_style: bool = False,
                      shots: bool = True, painted: bool = True, gentle: bool = True, karaoke: bool = False,
                      night_sky: bool = True, lamp_glow: bool = True,
                      arranged_by: str | None = None, singers: str | None = None, song_details: bool = True,
                      signature: str | None = None) -> dict:
    """Builds a finished lyric video as an editor project, ready for the person to review (it is not exported):
    - scenes [{"media_id", "start"}]: pictures in order, each from `start` seconds of the song (the first from 0).
    - lyric_motion: into_clear (default): each line starts behind the person nearest the clear space and glides into
      it within 1.6 s, then nothing covers it; long lines split onto two. People are found with Apple Vision in each
      picture, and the pictures fill the frame and hold still so the space stays where it was measured.
      plain: lines simply fade in and out. in_scene: what stands up in a 3D picture covers the lyrics the whole time
      (the owner found this hides the words; use only if asked).
    - three_d: each picture becomes a 3D camera glide (push, pull, drift, sweep, crane and more, never the same twice in a row). Not with into_clear.
    - look: lyric entrances and light overlays. energetic (blast, prism, chromatic...; sun rays, flares), romantic
      (lines rising from behind the people, magic form...; fireflies, bokeh, lanterns), calm (soft reveals; dust, fog).
      Every line keeps solid 3D letters; each scene adds a slow pan or zoom.
    - Credits, film style: an 8 s opening (`presents`, "A SONG BY" `song_by`, then the title `name` with `footer`) and a
      closing card (LYRICS `song_by`, MUSIC `music`, PRESENTED BY `presented_by`, `footer`); `accent` colours the roles.
      Leave out what you do not know rather than guess.
    - logo_media_id: a picture with transparency, small in the bottom-right corner and large on the closing card.
    - brand_intro: open with the animated brand intro made from that logo (a leaf falls among music notes and
      becomes it, with வழங்கும் and PRESENTS); it replaces the `presents` card.
    - shots: a long scene (7 s or more) becomes a wide, a medium and a close shot of the same picture, closing in on
      the face (found on this Mac), each with its own slow move. Not with into_clear or three_d.
    - painted: every other scene's middle shot shows the picture painted (watercolour, pencil, oil or dream), made
      on this Mac with filters, no AI and no cost. Needs shots.
    - night_sky: a picture with a night sky gets twinkling stars in its sky and a glow round its moon.
    - lamp_glow: a dusk or night picture's oil lamps and lanterns flicker with a warm halo.
      Both move with each shot; pictures without them are left alone. Made on this Mac.
    - song_details: credits as music labels present them: an opening card over the intro, a slow ticker three times,
      an end card clear of YouTube's end-screen buttons (lyrics `song_by`, `music`, `arranged_by`, `singers`,
      produced by `presented_by`). Only names given are shown.
    - signature: the name of a saved signature (e.g. the lyricist's): the song opens, in silence, with that white
      title card (their line portrait and the song's details) instead of an opening card over the intro.
    - karaoke: every lyric line lights its words, gold, as they are sung (word times from each line's timing).
    - gentle: with into_clear, each picture breathes or drifts a few per cent instead of holding still.
    Camera moves come from twelve slow moves (pans, tilts, diagonal drifts, slow turns, reveals), none repeated within
    three scenes, the bigger ones on the chorus.
    - project_id: update that editor project instead of making a new one (do this when redoing a video).
    Takes a few minutes the first time (3D pictures). Returns the project id; look at it, then the person exports."""
    from kanaa_mcp import lyric_touches, lyrics
    if not scenes:
        raise ToolError('Give at least one scene picture.')
    scenes = sorted(scenes, key=lambda scene: float(scene.get('start', 0)))
    starts = [0.0] + [round(float(scene['start']), 3) for scene in scenes[1:]]
    depth: dict[int, int] = {}
    clear = lyric_motion == 'into_clear'
    three_d = three_d and not clear
    spaces: dict[str, dict] = {}
    stills: dict[str, int] = {}
    if clear:
        import cv2
        from app.services import cutout_service
        for index, scene in enumerate(scenes):
            seconds = (starts[index + 1] if index + 1 < len(scenes) else song_seconds) - starts[index]
            picture = media(int(scene['media_id']))
            name = f"{Path(picture['filename']).stem} still.mp4"
            # A still clip made before for this picture, long enough, is used again rather than made twice.
            video = next((item for item in list_media(kind='video', query=name, limit=20) if item.get('filename') == name and float(item.get('duration') or 0) >= seconds + 0.3), None)
            with tempfile.TemporaryDirectory() as folder:
                clip = Path(folder) / name
                made = None if video else subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-loop', '1', '-i', picture['absolute_path'], '-t', f'{seconds + 0.5:.2f}', '-r', '30',
                                       '-vf', 'scale=1920:-2,format=yuv420p', '-c:v', 'libx264', '-crf', '16', str(clip)], capture_output=True, text=True)
                if made and made.returncode:
                    raise ToolError(f"Could not make a clip of {picture['filename']}: {made.stderr[-300:]}")
                video = video or api.upload('/media', clip)
            video = media(int(video['id']))  # With its file's place, which the media list leaves out.
            deadline = time.monotonic() + 1800
            while True:
                ready = api.post(f"/photos/{video['id']}/prepared?steady=false&backwards=false&cutout=remove&echo=")
                if ready.get('status') == 'ready':
                    break
                if time.monotonic() > deadline:
                    raise ToolError('Finding the people is taking too long; try again later.')
                time.sleep(3)
            mask_file = cutout_service.files(Path(video['absolute_path']))[cutout_service.MASK]
            frame = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', '0.5', '-i', str(mask_file), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
            import numpy as np
            mask = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_GRAYSCALE) > 128
            clip_id = f'lyric-scene-{index + 1}'
            spaces[clip_id] = {**lyrics.spaces(mask), 'size': [float(picture['width']), float(picture['height'])]}
            stills[clip_id] = int(video['id'])
            depth[int(scene['media_id'])] = int(video['id'])  # The scene plays its still clip, the same picture the people were found in.
    if three_d:
        depth_moves = pick_depth(len(scenes))
        for index, scene in enumerate(scenes):
            seconds = (starts[index + 1] if index + 1 < len(scenes) else song_seconds) - starts[index]
            made = api.post(f"/photos/{int(scene['media_id'])}/depth-motion", {'seconds': round(min(120, max(0.5, seconds + 0.2)), 2), 'move': depth_moves[index]})
            video = made.get('output_photo_id') if made.get('status') == 'ready' else look_up(api.wait(made['job_id'], timeout=1800), 'output_photo_id')
            depth[int(scene['media_id'])] = int(video)
    handoff = {'name': name, 'backgrounds': [{'id': int(scene['media_id']), 'media_type': 'image'} for scene in scenes], 'backgroundType': 'image', 'duration': song_seconds,
               'slideStarts': starts, 'song': {'id': song_asset_id, 'duration': song_seconds, 'name': name}, 'cues': [{**cue, 'position': 'bottom'} for cue in cues],
               'canvas': canvas, 'color': lyric_colour, 'fontSize': lyric_size, 'placement': 'bottom', 'lyricStyle': 'shadow', 'lyricFont': lyric_font, 'lyricAlign': 'center',
               'lyricBandColor': '#000000', 'lyricAnimation': 'fade' if lyric_motion != 'in_scene' else 'cinematic', 'crossfade': not clear, 'imageAnimation': '3d' if depth else 'ken-burns',
               'depthVideos': depth or None, 'inScene': bool(three_d and lyric_motion == 'in_scene')}
    timeline = lyrics.base_timeline(handoff)
    lyrics.lay_out(timeline)
    light_media: dict[str, int] = {}
    if lights:
        for effect in lyrics.LOOKS[look]['light']:
            made = api.post(f'/effects/{effect}', {'width': timeline['format']['width'], 'height': timeline['format']['height']})
            light_media[effect] = made['media']['id'] if made.get('media') else int(look_up(api.wait(made['job_id']), 'media_id'))
    made_paintings: list[int] = []
    if shots and not clear and not three_d:
        from kanaa_mcp import scene_motion
        focus, versions = {}, {}
        for turn, scene in enumerate(scenes):
            item = media(int(scene['media_id']))
            picture = Path(item['absolute_path'])
            focus[int(scene['media_id'])] = scene_motion.focus_points(picture)
            if painted and turn % 2 == 0:
                style = scene_motion.PAINTS[(turn // 2) % len(scene_motion.PAINTS)]
                versions[int(scene['media_id'])] = [painting(api, list_media, picture, Path(item['filename']).stem, style)]
                made_paintings += versions[int(scene['media_id'])]
        song = next(item for layer in timeline['layers'] if layer['kind'] == 'audio' for item in layer['items'])
        try:
            heard = api.get(f'/video-audio/{song_asset_id}/beats').get('beats') or []
        except Exception:  # No beats found (a quiet song): cuts keep their own rhythm.
            heard = []
        beats = [round(song['start'] + beat - song.get('in', 0), 3) for beat in heard]
        sung = [item for layer in timeline['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'].startswith('lyric-line')]
        chorus = scene_motion.chorus_spans(sung)
        scene_motion.shots(timeline, focus, versions, beats=beats, chorus=chorus)
        scene_motion.chorus_looks(timeline, chorus)
    lyrics.dress(timeline, look, light_media, camera_moves=not clear)
    if clear:
        lyrics.into_clear(timeline, spaces, stills)
        if gentle:
            lyrics.gentle_moves(timeline)
    elif lyric_motion == 'plain':
        for layer in timeline['layers']:
            for item in layer['items'] if layer['kind'] == 'text' else []:
                if item['id'].startswith('lyric-line'):
                    item.update(enter={'preset': 'fade', 'duration': 0.4}, exit={'preset': 'fade', 'duration': 0.3}); item.pop('depth', None)
    logo = None
    if logo_media_id is not None:
        item = media(logo_media_id)
        logo = {'media_id': logo_media_id, 'width': float(item['width']), 'height': float(item['height'])}
    lyrics.credits(timeline, name, presents, song_by, music, presented_by, footer, accent, logo)
    if logo and brand_intro:
        lyrics.prepend_intro(timeline, intro_for(logo_media_id, timeline['format']))
    # Last, so the credit cards' own moves are kept: every picture covers the frame (into_clear filled its scenes already).
    sizes = {}
    for clip in timeline['layers'][0]['items']:
        if clip['media_id'] not in sizes and not clip['id'].startswith('brand-intro'):
            item = media(int(clip['media_id']))
            if item.get('width') and item.get('height'):
                sizes[clip['media_id']] = (float(item['width']), float(item['height']))
    if house_style:
        lyrics.house_style(timeline, name, song_by)
        made = api.post('/effects/shine', {'width': timeline['format']['width'], 'height': timeline['format']['height']})
        shine = made['media']['id'] if made.get('media') else int(look_up(api.wait(made['job_id']), 'media_id'))
        lyric_touches.shine_over(timeline, shine, 'house-title')
    if song_details:
        # Credits as labels present them: an opening card, a slow ticker, an end card (credit_package.py). They
        # replace the film-style credit cards.
        from kanaa_mcp import credit_package
        roles = [(tamil, english, who) for tamil, english, who in (('பாடல் வரிகள்', 'Lyrics', song_by), ('இசை', 'Music', music), ('இசை வடிவமைப்பு', 'Arrangement & Style', arranged_by),
                                                                  ('பாடியவர்', 'Singers', singers), ('தயாரிப்பு', 'Produced by', presented_by)) if (who or '').strip()]
        if roles:
            timeline['layers'] = [layer for layer in timeline['layers'] if not any(item['id'].startswith(('opening-', 'closing-')) for item in layer['items'] if layer['kind'] == 'text')]
            ticker = '   •   '.join([name] + [f'{tamil}: {who}' for tamil, _, who in roles[:2]] + ([presented_by] if presented_by else []) + ([footer.split('·')[0].strip()] if footer else []))
            credit_package.add(timeline, name, name, roles, ticker, rights=f'℗ {time.strftime("%Y")} {presented_by}' if presented_by else None)
    if signature:
        from app.core.config import settings
        from kanaa_mcp import signature as signatures
        saved = signatures.load(settings.data_dir, signature)
        if saved is None:
            raise ToolError(f'No signature called {signature} is saved yet.')
        roles = [[tamil, english, who] for tamil, english, who in (('பாடல் வரிகள்', 'Lyrics', song_by or saved.get('lyricist')), ('இசை', 'Music', music),
                                                                ('இசை வடிவமைப்பு', 'Arrangement & Style', arranged_by), ('தயாரிப்பு', 'Produced by', presented_by or saved.get('presented_by'))) if (who or '').strip()]
        timeline['layers'] = [layer for layer in timeline['layers'] if layer.get('id') != 'credits-opening']  # The white card says it instead.
        for layer in timeline['layers']:
            if layer.get('id') == 'credits-portraits':
                layer['items'] = [clip for clip in layer['items'] if clip['start'] > 60]
        signatures.add_card(timeline, name, saved.get('english') or name, saved, roles)
    if karaoke:
        lyric_touches.karaoke(timeline)
    lyrics.fill_frame(timeline, sizes, {'credit-opening-bg', 'credit-closing-bg'} if clear else None)
    made_skies: list[int] = []
    if (night_sky or lamp_glow) and not three_d:  # A 3D picture moves within itself; a flat sky would slide off it.
        from kanaa_mcp import picture_lights
        picture_of = {video: picture for picture, video in depth.items()}  # into_clear plays each picture as a still video.

        def sky_video_for(shown: int, seconds: float):
            made = api.post(f'/photos/{picture_of.get(shown, shown)}/lights', {'seconds': min(600, seconds), 'sky': night_sky, 'lamps': 'auto' if lamp_glow else 'off'})
            if made.get('status') == 'none':
                return None
            return int(made['output_photo_id'] if made.get('status') == 'ready' else look_up(api.wait(made['job_id'], timeout=1800), 'output_photo_id'))
        made_skies = picture_lights.add(timeline, sky_video_for)
    validate(timeline)
    if project_id is None:
        project_id = api.post('/projects', {'name': name, 'kind': 'edit', 'media_ids': [int(scenes[0]['media_id'])]})['id']
        api.put(f'/projects/{project_id}/recipe', {'recipe': timeline})
    else:
        save(project_id, timeline_of(project_id), timeline, 'Rebuilt the lyric video')
    # The song's own media (its pictures and the clips made from them) goes into a library folder named after the song.
    from app.services.media_service import song_folder
    own = sorted({int(scene['media_id']) for scene in scenes} | set(stills.values()) | set(depth.values()) | set(made_paintings) | set(made_skies))
    folder = song_folder(name)
    if folder and own:
        api.patch('/photos/folder', {'ids': own, 'folder': folder})
    return {'project_id': project_id, 'folder': folder, 'seconds': round(max(clip['start'] + lyrics.length_of(clip) for clip in timeline['layers'][0]['items']), 2),
            'scenes': len(scenes), 'lines': len(cues), 'pictures': picture_advice(len({int(scene['media_id']) for scene in scenes}), song_seconds), 'lyric_motion': lyric_motion, 'note': 'Not exported. Use look to check moments; the person reviews and exports.',
            'check_timing': lyrics.crowded(cues)}



def pick_depth(count: int) -> list[str]:
    """3D moves for `count` scenes, none repeated within three."""
    from app.services.depth_motion_service import MOVES
    from kanaa_mcp import scene_motion
    return scene_motion.pick(count, moves=MOVES)


def painting(api, list_media, picture: Path, title: str, style: str) -> int:
    """The media id of `picture` painted in `style`, made once and then found again by its name."""
    import cv2
    from kanaa_mcp import scene_motion
    name = f'{title} {style}.jpg'
    found = next((item for item in list_media(kind='image', query=name, limit=20) if item.get('filename') == name), None)
    if found:
        return int(found['id'])
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / name
        cv2.imwrite(str(target), scene_motion.paint(picture, style), [cv2.IMWRITE_JPEG_QUALITY, 92])
        return int(api.upload('/media', target)['id'])


PICTURE_SECONDS = 22.0  # About this much of the song per picture keeps a viewer watching; more on one picture feels long.


def picture_advice(have: int, song_seconds: float) -> dict:
    """How many pictures a song wants, and a plain sentence when there are too few."""
    want = max(3, round(song_seconds / PICTURE_SECONDS))
    minutes = f'{int(song_seconds // 60)}:{int(song_seconds % 60):02d}'
    note = None if have >= want * 0.8 else f'This {minutes} song wants about {want} pictures; it has {have}. Each one stays on screen a long time.'
    return {'have': have, 'suggest': want, 'note': note}
