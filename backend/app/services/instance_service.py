"""Finds each person, or each object, in a video separately, so a title can go behind some of them and in front of others.

A Swift helper finds them in every frame with Apple's Vision framework. Vision numbers them afresh in each frame, so here
each one is followed from frame to frame by how much its outline overlaps where it was, and given a lasting number.
Each one found gets its own steadied mask, made once and kept with the clip's other prepared files, plus a picture of
the clip with everyone numbered, for choosing. A choice of several becomes one mask, and a see-through preview copy.
The same choice can instead stay sharp while everything else is blurred, at one of three strengths, and the focus
can move from them to others part way through, like a film camera's focus pull.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.services import cutout_service
from app.services.asset_service import content_key, folder_for
from app.services.cutout_service import EDGE_SOFTNESS, Steadier, colour, mask_size
from app.services.job_service import JobCancelled, get_job, stop_process_when, update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.reverse_service import lock_for
from app.services.video_edit_service import run_cancellable

logger = logging.getLogger(__name__)
SOURCE = Path(__file__).resolve().parents[2] / 'native' / 'instance_mask.swift'
KINDS = ('people', 'objects')  # Found one by one and numbered.
LAND = 'land'  # Everything but the sky (sky_service): one whole, never numbered.
VERSION = 2  # 2: solid, steady masks (cutout_service.Steadier).
MAX_TRACKS = 6  # The helper sends at most this many a frame, and no more are followed.
SMALL = 8  # Outlines are compared at an eighth of the mask's size.
MATCH = 0.2  # The overlap, as a share of the two outlines together, that makes it the same one.
FORGET = 15  # Frames unseen before a number is retired, so a newcomer in the same spot gets a new one.
MIN_AREA = 0.002  # Of the frame. Anything smaller is noise.
MIN_SHARE = 0.08  # Of the clip's frames. Anything seen less is left out of the choice.
PICTURE_SIDE = 640
COLOURS = [(255, 196, 0), (0, 190, 255), (255, 80, 140), (110, 220, 90), (180, 120, 255), (255, 140, 60)]
_active: dict[str, str] = {}
_guard = threading.Lock()


@dataclass(frozen=True)
class Pick:
    kind: str
    ids: Optional[tuple[int, ...]]  # None is all of them.

    @property
    def token(self) -> str:
        return f"{self.kind}-{'-'.join(str(number) for number in self.ids) if self.ids else 'all'}"


def from_choice(choice) -> Optional[Pick]:
    """A timeline clip's cutout_pick to a pick."""
    return Pick(choice.kind, tuple(choice.ids) if choice.ids else None) if choice is not None else None


def parse(token: str) -> Optional[Pick]:
    """'people-0-2' or 'objects-all' to a pick. None if it isn't one."""
    kind, _, rest = token.partition('-')
    if kind == LAND:
        return Pick(LAND, None) if rest == 'all' else None
    if kind not in KINDS or not rest:
        return None
    if rest == 'all':
        return Pick(kind, None)
    try:
        ids = tuple(sorted({int(part) for part in rest.split('-')}))
    except ValueError:
        return None
    return Pick(kind, ids) if ids and all(0 <= number < MAX_TRACKS for number in ids) else None


@dataclass(frozen=True)
class Pull:
    """The focus moves to `to` (None is everyone), starting `at` seconds into the source and taking `length` seconds.
    Both are kept in milliseconds, so the same pull always names the same file."""
    to: Optional[Pick]
    at_ms: int
    length_ms: int

    @property
    def token(self) -> str:
        return f"{'all' if is_everyone(self.to) else self.to.token}@{self.at_ms}+{self.length_ms}"


MIN_PULL_MS, MAX_PULL_MS = 200, 4000


def parse_pull(token: str) -> Optional[Pull]:
    """'people-1@2500+800' to a pull. None if it isn't one."""
    who, _, rest = token.partition('@')
    at, _, length = rest.partition('+')
    if not (at.isdigit() and length.isdigit()) or not MIN_PULL_MS <= int(length) <= MAX_PULL_MS:
        return None
    to = None if who == 'all' else parse(who)
    if who != 'all' and to is None:
        return None
    return Pull(to, int(at), int(length))


def from_pull(choice, kind: str) -> Optional[Pull]:
    """A timeline clip's focus_pull to a pull, of the same kind as who it starts on."""
    if choice is None:
        return None
    to = Pick(kind, tuple(choice.to)) if choice.to else (None if kind == 'people' else Pick(kind, None))
    return Pull(to, round(choice.at * 1000), round(choice.length * 1000))


def is_everyone(pick: Optional[Pick]) -> bool:
    """Every person: served by the sharper all-people mask."""
    return pick is None or (pick.kind == 'people' and pick.ids is None)


def parse_cutout(token: str) -> Optional[tuple[str, Optional[Pick], str, Optional[Pull], int]]:
    """A prepared copy's cutout token to (remove or blur, who, blur amount, focus pull). None if it isn't one.
    'remove', 'blur', 'people-0-2' (remove, keeping those), 'blur.people-0-2.strong', 'blur.all.subtle',
    'blur.people-0.strong.people-1@2500+800' (the focus moves to person 1 at 2.5 s, over 0.8 s)."""
    gap = 0
    if '.gap' in token:
        token, raw_gap = token.rsplit('.gap', 1)
        if not raw_gap.isdigit() or not 1 <= int(raw_gap) <= 5:
            return None
        gap = int(raw_gap)
    if token in ('', 'remove', 'blur'):
        return token, None, 'medium', None, gap
    if token.startswith('blur.'):
        parts = token.split('.')
        if len(parts) not in (3, 4) or parts[2] not in cutout_service.BLUR_AMOUNTS:
            return None
        pull = parse_pull(parts[3]) if len(parts) == 4 else None
        if len(parts) == 4 and pull is None:
            return None
        pick = None if parts[1] == 'all' else parse(parts[1])
        if parts[1] != 'all' and pick is None:
            return None
        return ('blur', pick, parts[2], pull, 0) if not gap else None
    pick = parse(token)
    return ('remove', pick, 'medium', None, gap) if pick else None


def summary_path(source: Path, kind: str) -> Path:
    return folder_for(content_key(source)) / f'{kind}-tracks-{VERSION}.json'


def track_path(source: Path, kind: str, number: int) -> Path:
    return folder_for(content_key(source)) / f'{kind}-{VERSION}-{number}.mp4'


def picture_path(source: Path, kind: str) -> Path:
    return folder_for(content_key(source)) / f'{kind}-{VERSION}-picture.jpg'


def portrait_paths(source: Path, pick: Optional[Pick], amount: str, pull: Optional[Pull] = None) -> tuple[Path, Path]:
    """The copy with only the chosen ones sharp, and its proxy. Everyone at the usual strength is the original portrait."""
    if is_everyone(pick) and amount == 'medium' and pull is None:
        paths = cutout_service.files(source)
        return paths[cutout_service.PORTRAIT], paths[cutout_service.PORTRAIT_PROXY]
    folder = folder_for(content_key(source))
    who = 'people-all' if is_everyone(pick) else pick.token
    then = f'-to-{pull.token}' if pull else ''
    return folder / f'portrait-{who}{then}-{amount}-{VERSION}.mp4', folder / f'portrait-{who}{then}-{amount}-{VERSION}-proxy.mp4'


def pick_paths(source: Path, pick: Pick, gap: int = 0) -> tuple[Path, Path]:
    """The chosen ones' mask, for export, and its see-through preview copy."""
    folder = folder_for(content_key(source))
    suffix = f'-space{gap}.{cutout_service.SPACE_VERSION}' if gap else ''
    return folder / f'{pick.token}-{VERSION}-mask.mp4', folder / f'{pick.token}-{VERSION}{suffix}-cut.webm'


def tracks(source: Path, kind: str) -> Optional[list[dict]]:
    """The ones worth choosing, numbered left to right as in the picture. None until found."""
    path = summary_path(source, kind)
    return json.loads(path.read_text())['tracks'] if path.is_file() else None


@dataclass
class Track:
    number: int
    outline: np.ndarray
    last_seen: int
    born: int
    steady: Steadier = field(default_factory=Steadier)
    frames: int = 0
    process: Optional[subprocess.Popen] = None


def outline(mask: np.ndarray) -> np.ndarray:
    return mask[SMALL // 2::SMALL, SMALL // 2::SMALL] > 127


def overlap(a: np.ndarray, b: np.ndarray) -> float:
    union = np.count_nonzero(a | b)
    return np.count_nonzero(a & b) / union if union else 0.0


def match(live: list[Track], found: list[np.ndarray], index: int) -> list[tuple[Optional[Track], np.ndarray]]:
    """Pairs each mask found in this frame with the one it continues, best overlaps first. Unpaired masks pair with None."""
    shapes = [outline(mask) for mask in found]
    candidates = sorted(((overlap(track.outline, shape), t, f) for t, track in enumerate(live) if index - track.last_seen <= FORGET
                         for f, shape in enumerate(shapes)), reverse=True)
    taken_tracks, taken_found, pairs = set(), set(), []
    for score, t, f in candidates:
        if score < MATCH or t in taken_tracks or f in taken_found:
            continue
        taken_tracks.add(t)
        taken_found.add(f)
        live[t].outline = shapes[f]
        live[t].last_seen = index
        pairs.append((live[t], found[f]))
    pairs += [(None, found[f]) for f in range(len(found)) if f not in taken_found]
    return pairs


def make_tracks(facts: MediaFacts, kind: str, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], finder: list[str] | None = None) -> None:
    width, height = mask_size(facts)
    fps = facts.fps or 30
    total = max(1, round((facts.duration or 1) * fps))
    ffmpeg = shutil.which('ffmpeg')
    summary = summary_path(facts.path, kind)
    summary.parent.mkdir(parents=True, exist_ok=True)
    decode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}', '-fps_mode', 'passthrough',
                               '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    find = subprocess.Popen([*(finder or [str(cutout_service.helper(SOURCE))]), str(width), str(height), kind], stdin=decode.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    decode.stdout.close()
    for process in (decode, find):
        stop_process_when(process, should_cancel)
    size = width * height
    empty = np.zeros((height, width), np.uint8)
    live: list[Track] = []
    seen_per_frame: list[list[tuple[int, int]]] = []  # Per frame: (number, area) of each one seen.

    def encoder(number: int) -> subprocess.Popen:
        process = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                                    '-vf', f'gblur=sigma={EDGE_SOFTNESS}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p',
                                    str(track_path(facts.path, kind, number).with_suffix('.tmp.mp4'))], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        stop_process_when(process, should_cancel)
        return process

    try:
        index = 0
        while (head := find.stdout.read(1)):
            count = head[0]
            found = []
            for _ in range(count):
                chunk = find.stdout.read(size)
                if len(chunk) < size:
                    raise RuntimeError('The finder stopped part way through a frame.')
                mask = np.frombuffer(chunk, np.uint8).reshape(height, width)
                if np.count_nonzero(mask > 127) >= MIN_AREA * size:
                    found.append(mask)
            seen, shown = [], set()
            for track, mask in match(live, found, index):
                if track is None:
                    if len(live) >= MAX_TRACKS:
                        continue
                    track = Track(number=len(live), outline=outline(mask), last_seen=index, born=index, steady=Steadier(fps=fps))
                    track.process = encoder(track.number)
                    # Empty frames up to now, so every mask runs the whole clip.
                    for _ in range(index):
                        track.process.stdin.write(empty.tobytes())
                    live.append(track)
                track.frames += 1
                shown.add(track.number)
                seen.append((track.number, int(np.count_nonzero(mask > 127))))
                for ready in track.steady.push(mask):
                    track.process.stdin.write(ready.tobytes())
            for track in live:
                if track.number not in shown:
                    for ready in track.steady.push(empty):
                        track.process.stdin.write(ready.tobytes())
            seen_per_frame.append(seen)
            index += 1
            if index % 10 == 0:
                on_progress(min(90, index * 90 // total))
        for track in live:
            for ready in track.steady.finish():
                track.process.stdin.write(ready.tobytes())
            track.process.stdin.close()
        codes = [process.wait() for process in (decode, find, *(track.process for track in live))]
        if should_cancel():
            raise JobCancelled()
        if any(codes) or index == 0:
            logger.error('Finding %s failed for %s: %s', kind, facts.path, find.stderr.read()[-800:])
            raise RuntimeError(f'Could not find the {kind} in this clip.')
        for track in live:
            track_path(facts.path, kind, track.number).with_suffix('.tmp.mp4').replace(track_path(facts.path, kind, track.number))
        kept = {track.number for track in live if track.frames >= max(3, MIN_SHARE * index)}
        listed = describe(facts, kind, kept, seen_per_frame, (width, height), should_cancel)
        temporary = summary.with_suffix('.tmp')
        temporary.write_text(json.dumps({'frames': index, 'tracks': listed}))
        temporary.replace(summary)
    finally:
        for process in (decode, find, *(track.process for track in live if track.process)):
            if process.poll() is None:
                process.kill()
                process.wait()
        for track in live:
            track_path(facts.path, kind, track.number).with_suffix('.tmp.mp4').unlink(missing_ok=True)


def read_frame(path: Path, seconds: float, size: tuple[int, int], gray: bool, extra: str = '') -> np.ndarray:
    width, height = size
    result = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{seconds:.6f}', '-i', str(path), '-frames:v', '1', '-vf', f'{extra}scale={width}:{height}',
                             '-f', 'rawvideo', '-pix_fmt', 'gray' if gray else 'rgb24', '-'], capture_output=True, timeout=120)
    planes = 1 if gray else 3
    if len(result.stdout) < width * height * planes:
        return np.zeros((height, width) if gray else (height, width, 3), np.uint8)
    frame = np.frombuffer(result.stdout[:width * height * planes], np.uint8)
    return frame.reshape(height, width) if gray else frame.reshape(height, width, 3)


def describe(facts: MediaFacts, kind: str, kept: set[int], seen_per_frame: list[list[tuple[int, int]]], size: tuple[int, int], should_cancel: Callable[[], bool]) -> list[dict]:
    """Picks the frame that shows most of them, numbers them left to right there, and draws the picture to choose from."""
    if not kept:
        Image.new('RGB', (PICTURE_SIDE, round(PICTURE_SIDE * size[1] / size[0])), (20, 20, 20)).save(picture_path(facts.path, kind), quality=85)
        return []
    best = max(range(len(seen_per_frame)), key=lambda frame: (len([1 for number, _ in seen_per_frame[frame] if number in kept]),
                                                                sum(area for number, area in seen_per_frame[frame] if number in kept)))
    fps = facts.fps or 30
    seconds = (best + 0.5) / fps
    shrink = PICTURE_SIDE / max(size)
    small = (max(2, round(size[0] * shrink)), max(2, round(size[1] * shrink)))
    picture = read_frame(facts.path, seconds, small, gray=False, extra=f'{colour(facts)},').astype(np.float32)
    places = []
    for number in sorted(kept):
        if should_cancel():
            raise JobCancelled()
        mask = read_frame(track_path(facts.path, kind, number), seconds, small, gray=True).astype(np.float32) / 255
        ys, xs = np.nonzero(mask > 0.5)
        places.append((number, mask, (float(xs.mean()), float(ys.mean())) if len(xs) else None, (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) else None))
    # Those not in the best frame go last, so the numbers on the picture still read left to right.
    places.sort(key=lambda place: (place[2] is None, place[2][0] if place[2] else 0))
    listed = []
    for label, (number, mask, centre, box) in enumerate(places, start=1):
        tint = np.array(COLOURS[(label - 1) % len(COLOURS)], np.float32)
        picture = picture * (1 - 0.45 * mask[..., None]) + tint * 0.45 * mask[..., None]
        listed.append({'id': number, 'label': label, 'colour': '#%02x%02x%02x' % COLOURS[(label - 1) % len(COLOURS)],
                       'centre': [round(centre[0] / small[0], 4), round(centre[1] / small[1], 4)] if centre else None})
    image = Image.fromarray(np.clip(picture, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=max(14, small[1] // 14))
    for item, (_, _, centre, box) in zip(listed, places):
        if not centre:
            continue
        x, y = centre[0], (box[1] + centre[1]) / 2  # Upper middle: over a person's chest rather than their feet.
        radius = max(11, small[1] // 22)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=item['colour'], outline=(0, 0, 0), width=2)
        draw.text((x, y), str(item['label']), fill=(0, 0, 0), font=font, anchor='mm')
    target = picture_path(facts.path, kind)
    image.save(target.with_suffix('.tmp.jpg'), quality=85)
    target.with_suffix('.tmp.jpg').replace(target)
    return listed


def make_pick(facts: MediaFacts, pick: Pick, should_cancel: Callable[[], bool]) -> None:
    """The chosen ones together: the brightest of their masks at each pixel."""
    found = tracks(facts.path, pick.kind) or []
    numbers = [item['id'] for item in found if pick.ids is None or item['id'] in pick.ids]
    mask = pick_paths(facts.path, pick)[0]
    temporary = mask.with_suffix('.tmp.mp4')
    ffmpeg = shutil.which('ffmpeg')
    if not numbers:
        # Nobody chosen is there: an empty mask, so the copy shows nothing rather than failing.
        width, height = mask_size(facts)
        command = [ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black:s={width}x{height}:r={facts.fps or 30}:d={facts.duration or 1}']
    else:
        inputs = [argument for number in numbers for argument in ('-i', str(track_path(facts.path, pick.kind, number)))]
        graph = ''.join(f'[{n}:v]format=gray[g{n}];' for n in range(len(numbers)))
        last = 'g0'
        for n in range(1, len(numbers)):
            graph += f'[{last}][g{n}]blend=all_mode=lighten[m{n}];'
            last = f'm{n}'
        command = [ffmpeg, '-nostdin', '-v', 'error', '-y', *inputs, '-filter_complex', graph + f'[{last}]null', '-fps_mode', 'passthrough']
    result = run_cancellable([*command, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Joining masks failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not prepare the chosen cut-out.')
    temporary.replace(mask)


def is_ready(source: Path, pick: Pick, gap: int = 0) -> bool:
    return all(path.is_file() for path in pick_paths(source, pick, gap))


def prepare(facts: MediaFacts, pick: Pick, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], finder: list[str] | None = None, joined: bool = True, see_through: bool = True, gap: int = 0) -> None:
    """Finds them all, then joins the chosen ones' masks, then makes the see-through preview copy, each once."""
    if pick.kind == LAND:
        from app.services import sky_service
        with lock_for(f'{content_key(facts.path)}:{LAND}'):
            mask, cut = pick_paths(facts.path, pick, gap)
            if not mask.is_file():
                sky_service.make_land_mask(facts, mask, on_progress, should_cancel)
            if see_through and not cut.is_file():
                cutout_service.make_see_through(facts, should_cancel, mask=mask, target=cut, gap=gap)
        return
    with lock_for(f'{content_key(facts.path)}:{pick.kind}'):
        if not summary_path(facts.path, pick.kind).is_file():
            make_tracks(facts, pick.kind, on_progress, should_cancel, finder)
        mask, cut = pick_paths(facts.path, pick, gap)
        if joined and not mask.is_file():
            make_pick(facts, pick, should_cancel)
        if joined and see_through and not cut.is_file():
            cutout_service.make_see_through(facts, should_cancel, mask=mask, target=cut, gap=gap)


def sharp_mask(facts: MediaFacts, who: Optional[Pick], on_progress: Callable[[int], None], should_cancel: Callable[[], bool], finder: list[str] | None = None) -> Path:
    """The mask of who stays sharp: the all-people mask for everyone, else the chosen ones' joined mask."""
    if is_everyone(who):
        with lock_for(content_key(facts.path)):
            if not cutout_service.files(facts.path)[cutout_service.MASK].is_file():
                cutout_service.make_mask(facts, on_progress, should_cancel, finder)
        return cutout_service.files(facts.path)[cutout_service.MASK]
    prepare(facts, who, on_progress, should_cancel, finder, see_through=False)
    return pick_paths(facts.path, who)[0]


def make_pull(facts: MediaFacts, first: Path, then: Path, pull: Pull, target: Path, should_cancel: Callable[[], bool]) -> None:
    """One mask that is `first` until the pull starts, then eases into `then`: the focus moving from one to the other."""
    at, length = pull.at_ms / 1000, pull.length_ms / 1000
    share = f'clip((T-{at:.3f})/{length:.3f},0,1)'
    graph = f"[0:v]format=gray[a];[1:v]format=gray[b];[b][a]scale2ref[later][earlier];[earlier][later]blend=all_expr='st(0,{share});A+(B-A)*ld(0)*ld(0)*(3-2*ld(0))'"
    temporary = target.with_suffix('.tmp.mp4')
    result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(first), '-i', str(then), '-filter_complex', graph, '-fps_mode', 'passthrough',
                              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Focus pull failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not prepare the focus pull.')
    temporary.replace(target)


def prepare_portrait(facts: MediaFacts, pick: Optional[Pick], amount: str, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], finder: list[str] | None = None, pull: Optional[Pull] = None) -> None:
    """The chosen ones sharp, everything else blurred; with a pull, the sharp ones change part way through."""
    target, proxy = portrait_paths(facts.path, pick, amount, pull)
    if target.is_file() and proxy.is_file():
        return
    mask = sharp_mask(facts, pick, on_progress, should_cancel, finder)
    if pull:
        later = sharp_mask(facts, pull.to, on_progress, should_cancel, finder)
        moving = target.with_name(target.stem + '-mask.mp4')
        with lock_for(f'{content_key(facts.path)}:{moving.name}'):
            if not moving.is_file():
                make_pull(facts, mask, later, pull, moving, should_cancel)
        mask = moving
    with lock_for(f'{content_key(facts.path)}:{target.name}'):
        if not (target.is_file() and proxy.is_file()):
            cutout_service.make_portrait(facts, should_cancel, mask=mask, target=target, proxy=proxy, amount=amount)


def ensure_portrait(facts: MediaFacts, pick: Optional[Pick], amount: str, should_cancel: Callable[[], bool] = lambda: False, pull: Optional[Pull] = None) -> MediaFacts:
    """For export: the blurred copy, used like a steadied one."""
    prepare_portrait(facts, pick, amount, lambda _: None, should_cancel, pull=pull)
    portrait = probe_video(portrait_paths(facts.path, pick, amount, pull)[0])
    if portrait is None:
        raise RuntimeError('The blurred copy of this clip could not be read.')
    return portrait


def ensure_mask(facts: MediaFacts, pick: Optional[Pick], should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """For export: the mask of the chosen ones, or of every person when nobody in particular was chosen."""
    if pick is None or (pick.kind == 'people' and pick.ids is None):
        return cutout_service.ensure_mask(facts, should_cancel)
    prepare(facts, pick, lambda _: None, should_cancel)
    return pick_paths(facts.path, pick)[0]


def request(facts: MediaFacts, pick: Pick, label: str, joined: bool = True, gap: int = 0) -> dict:
    """Ready, or being made in the background. Without `joined`, only finds them, for choosing."""
    ready = is_ready(facts.path, pick, gap) if joined else summary_path(facts.path, pick.kind).is_file()
    what = {'people': 'the people', 'objects': 'the objects', LAND: 'the sky'}[pick.kind]
    return in_background(facts, f'{pick.token if joined else pick.kind}-gap{gap}', ready, f'Finding {what} in {label}',
                         lambda progress, should_cancel: prepare(facts, pick, progress, should_cancel, joined=joined, gap=gap))


def request_portrait(facts: MediaFacts, pick: Optional[Pick], amount: str, label: str, pull: Optional[Pull] = None) -> dict:
    target, proxy = portrait_paths(facts.path, pick, amount, pull)
    return in_background(facts, target.name, target.is_file() and proxy.is_file(), f'Blurring the background of {label}',
                         lambda progress, should_cancel: prepare_portrait(facts, pick, amount, progress, should_cancel, pull=pull))


def in_background(facts: MediaFacts, name: str, ready: bool, title: str, work: Callable[[Callable[[int], None], Callable[[], bool]], None]) -> dict:
    """Ready, or one background job making it, however often it is asked for."""
    if ready:
        return {'status': 'ready'}
    key = f'{content_key(facts.path)}:{name}'
    with _guard:
        active = _active.get(key)
        job = get_job(active) if active else None
        if job and not job.get('done'):
            return {'status': 'preparing', 'job_id': active, 'progress': job.get('progress', 0)}

        def run(should_cancel: Callable[[], bool]) -> dict:
            try:
                work(lambda value: update_job(_active.get(key, ''), progress=value), should_cancel)
            finally:
                _active.pop(key, None)
            return {'progress': 100}

        job_id = enqueue_render('cutout', title, run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'job_id': job_id, 'progress': 0}
