"""A long final export in slices rendered side by side, then joined without encoding again.

One graph for a whole song has hundreds of inputs and overlays; macOS's thread limit then holds it to a couple of
cores and every frame works through the whole graph. Cut into slices (render_window.cut_exact), each slice has only
what shows in it, uses the machine's cores fully, and several run at once.

Nothing is lost at a join:
- Cuts land on frame boundaries, and only where nothing is changing in a way a slice could not carry on exactly: not
  inside a transition, a fade or an entrance, and not across a clip whose effect depends on frames before it (echo
  trails, raindrops, film damage, a reversed or speed-ramped clip, a tracked or pinned title). A cut that finds no
  such moment nearby is dropped, and when no cut is possible the export runs as one graph, as before.
- Sound is mixed once for the whole timeline (and its loudness evened once), then laid under the joined picture, so
  it has no seams.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from app.services import render_window
from app.services.job_service import JobCancelled
from app.services.timeline_schema import Timeline

SLICE_SECONDS = 40  # About how long each slice is.
LEAST_SECONDS = 75  # Shorter exports are quick as one graph.
MOST_SLICES = 12
SEARCH_SECONDS = 8  # How far from an even split a cut may move to find a quiet moment.
# A clip with one of these looks at frames before the cut, or moves in a way a later start cannot repeat.
CARRIES_ON = ('echo', 'lens_surface', 'old_film', 'signal_damage', 'reverse', *render_window.UNSAFE)


def workers() -> int:
    """Slices rendered at once: half the cores (each slice's graph uses several), at most 4 for memory."""
    return max(1, min(4, (os.cpu_count() or 4) // 2))


def _quiet(timeline: Timeline, at: float, frame: float) -> bool:
    """Whether a slice can start at `at` and look exactly as the whole would."""
    for layer in timeline.layers:
        if layer.kind == 'audio':
            continue
        for item in layer.items:
            data = item.model_dump(by_alias=True)
            begin = data['start']
            finish = begin + render_window._length(data)
            transition = data.get('transition_in')
            if transition and abs(at - begin) < transition['duration'] + frame:
                return False  # Inside a transition, which blends the clips either side of the join.
            if not begin < at < finish:
                continue
            if any(data.get(key) for key in CARRIES_ON):
                return False
            into = at - begin
            enter = data.get('enter')
            leaving = data.get('exit')
            if into < max(data.get('fade_in') or 0, enter['duration'] if enter else 0) + frame:
                return False  # Still coming in.
            if leaving and finish - at < leaving['duration'] + frame:
                return False  # Already going out.
            if 'in' in data and finish - at < frame:
                return False
    return True


def plan(timeline: Timeline) -> list[float]:
    """The times to cut at (frame-exact, ascending); empty when one graph is the better way."""
    duration = timeline.duration
    if duration < LEAST_SECONDS:
        return []
    fps = timeline.format.fps
    frame = 1 / fps
    parts = max(2, min(MOST_SLICES, round(duration / SLICE_SECONDS)))
    cuts: list[float] = []
    for k in range(1, parts):
        aim = round(duration * k / parts * fps)
        for step in range(0, SEARCH_SECONDS * fps * 2 + 1):
            offset = (step + 1) // 2 * (1 if step % 2 else -1)  # 0, +1, -1, +2, -2 … frames
            at = (aim + offset) / fps
            if (cuts and at - cuts[-1] < 5) or not 5 <= at <= duration - 5:
                continue
            if _quiet(timeline, at, frame):
                cuts.append(round(at, 6))
                break
    return cuts


def slices(timeline: Timeline, cuts: list[float]) -> list[tuple[float, float, Timeline]] | None:
    """Each slice's span and its own timeline, or None when any slice cannot be cut exactly."""
    edges = [0.0, *cuts, timeline.duration]
    out = []
    for start, end in zip(edges, edges[1:]):
        part = render_window.cut_exact(timeline, start, end)
        if part is None:
            return None
        out.append((start, end, part))
    return out


def render(timeline: Timeline, parts: list[tuple[float, float, Timeline]], render_one: Callable[..., None], mix: Callable[[Path], Path | None],
           ffmpeg: str, target: Path, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], run: Callable[..., Any]) -> None:
    """Render `parts` side by side with `render_one(part_timeline, length, target, on_progress, should_cancel)`, lay the
    whole timeline's sound (`mix(folder)`, or None for silence) under them, and publish `target`."""
    total = timeline.duration
    done = [0.0] * len(parts)
    lock = threading.Lock()
    failed = threading.Event()
    stop = lambda: failed.is_set() or should_cancel()

    def report(index: int, length: float, percent: int) -> None:
        with lock:
            done[index] = length * percent / 100
            on_progress(min(97, 3 + int(sum(done) / total * 94)))

    with tempfile.TemporaryDirectory(prefix='.video-slices-', dir=target.parent) as folder:
        folder = Path(folder)
        sound = mix(folder)
        on_progress(3)

        def one(index: int) -> Path:
            start, end, part = parts[index]
            path = folder / f'slice-{index:03d}.mp4'
            try:
                render_one(part, end - start, path, lambda percent: report(index, end - start, percent), stop)
            except BaseException:
                failed.set()
                raise
            return path

        with ThreadPoolExecutor(max_workers=workers()) as pool:
            futures = [pool.submit(one, index) for index in range(len(parts))]
            paths = []
            for future in futures:
                paths.append(future.result())  # The first failure is raised; the rest stop at their next check.
        if should_cancel():
            raise JobCancelled()
        listing = folder / 'slices.txt'
        listing.write_text(''.join(f"file '{path.name}'\n" for path in paths), encoding='utf-8')
        output = folder / 'output.mp4'
        audio_in = ['-i', str(sound)] if sound else []
        audio = ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] if sound else ['-an']
        result = run([ffmpeg, '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing), *audio_in, '-map', '0:v', *audio,
                      '-c:v', 'copy', '-t', f'{total:.6f}', '-map_metadata', '-1', '-movflags', '+faststart', '-n', str(output)], should_cancel)
        if should_cancel():
            raise JobCancelled()
        if result.returncode or not output.exists() or output.stat().st_size == 0:
            raise RuntimeError('Export failed. The video slices could not be joined; see the server log for details.')
        if target.exists():
            raise RuntimeError('The export destination already exists. Please export again.')
        target.hardlink_to(output)
        on_progress(99)
