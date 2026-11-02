"""Compile spike/timeline.json into one ffmpeg graph (export approach A)."""
import json, subprocess, sys, tempfile, time
from pathlib import Path
here = Path(__file__).parent; media = here / '.media'; out = here / '.out'; out.mkdir(exist_ok=True)
sys.path.insert(0, str(here.parent / 'backend'))
from app.api.schemas import VideoEditRequest
from app.services.video_edit_service import LYRIC_FONTS_DIR, write_lyrics

def ease(name, p):
    return {'linear': p, 'easeOut': f'(1-pow(1-{p},3))',
            'easeInOut': f'if(lt({p},0.5),4*pow({p},3),1-pow(-2*{p}+2,3)/2)'}[name]

def expression(transform, prop):
    """The same piecewise curve as evaluate.js, as an ffmpeg expression of t."""
    keys = transform.get('keyframes', {}).get(prop)
    if not keys:
        return str(transform[prop])
    tail = str(keys[-1]['v'])
    for a, b in reversed(list(zip(keys, keys[1:]))):
        p = f"((t-{a['t']})/{b['t'] - a['t']})"
        tail = f"if(lt(t,{b['t']}),{a['v']}+({b['v'] - a['v']})*{ease(a.get('ease', 'linear'), p)},{tail})"
    return f"if(lte(t,{keys[0]['t']}),{keys[0]['v']},{tail})"

def render_text(layer, fmt):
    """Text goes through the export's libass path once, so preview and export share the same pixels."""
    target = out / f"{layer['id']}.png"
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        edit = VideoEditRequest(canvas='landscape', quality='1080p', lyric_style='band', lyric_size=28, lyric_position='top', lyrics=[{'start': 0, 'end': 1, 'text': layer['text']}])
        write_lyrics(folder / 'lyrics.ass', edit, Path('/dev/null'))
        (folder / 'fonts').symlink_to(LYRIC_FONTS_DIR)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f"color=c=black@0:s={fmt['width']}x{fmt['height']}:r=30:d=0.5,format=rgba",
                        '-vf', 'ass=filename=lyrics.ass:shaping=complex:fontsdir=fonts:alpha=1', '-frames:v', '1', '-update', '1', str(target)], cwd=folder, check=True)
    return target

def compile_timeline(timeline, seconds):
    fmt = timeline['format']; W, H = fmt['width'], fmt['height']
    args, graph = [], []
    index = 0; current = None
    for layer in timeline['layers']:
        tr = layer.get('transform')
        if layer.get('kind') == 'text':
            args += ['-loop', '1', '-framerate', str(fmt['fps']), '-i', str(render_text(layer, fmt))]
            graph.append(f"[{current}][{index}:v]overlay=format=gbrp:shortest=0:eof_action=pass:enable='between(t,{layer['start']},{layer['end']})'[v{index}]")
        else:
            args += ['-i', str(media / f"{layer['media']}.mp4")]
            if current is None:
                graph.append(f"[{index}:v]fps={fmt['fps']},scale={W}:{H},format=gbrp[v{index}]")
            else:
                s, x, y = (expression(tr, key) for key in ('scale', 'x', 'y'))
                graph.append(f"[{index}:v]fps={fmt['fps']},format=gbrap,colorchannelmixer=aa={tr['opacity']},scale=w='{W}*({s})':h='{H}*({s})':eval=frame:flags=bilinear[l{index}]")
                graph.append(f"[{current}][l{index}]overlay=x='{W}*({x})-overlay_w/2':y='{H}*({y})-overlay_h/2':eval=frame:format=gbrp[v{index}]")
        current = f'v{index}'; index += 1
    graph.append(f"[{current}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[final]")
    args += ['-i', str(media / f"{timeline['audio']['media']}.m4a")]
    return args, ';'.join(graph), index

def export(seconds, name, layers=3):
    timeline = json.loads((here / 'timeline.json').read_text())
    for i in range(max(0, layers - 3)):
        timeline['layers'].insert(3, {'id': f'extra{i}', 'media': 'pip_a' if i % 2 else 'pip_b', 'transform': {'x': 0.12 + 0.19 * (i % 5), 'y': 0.15 + 0.3 * (i // 5), 'scale': 0.18, 'opacity': 1}})
    args, graph, audio = compile_timeline(timeline, seconds)
    target = out / name
    started = time.time()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args, '-filter_complex', graph, '-map', '[final]', '-map', f'{audio}:a', '-t', str(seconds),
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                    '-c:a', 'aac', str(target)], check=True)
    took = time.time() - started
    print(f'{seconds}s exported in {took:.1f}s, {took / seconds:.2f}x length, {target.stat().st_size // 1000000} MB')

if __name__ == '__main__':
    export(float(sys.argv[1]) if len(sys.argv) > 1 else 60, 'export.mp4' if len(sys.argv) < 3 else f'export{sys.argv[2]}.mp4', int(sys.argv[2]) if len(sys.argv) > 2 else 3)
