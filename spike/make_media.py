"""Test footage: busy moving video, with solid marker borders so layer positions can be measured."""
import subprocess, sys
from pathlib import Path
here = Path(__file__).parent; media = here / '.media'; media.mkdir(exist_ok=True)
SECONDS = 300
def run(*args): subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)
def clip(name, size, border):
    w, h = size
    draw = f",drawbox=x=0:y=0:w={w}:h={h}:color={border}:t=24" if border else ''
    run('-f', 'lavfi', '-i', f'testsrc2=size={w}x{h}:rate=30', '-t', str(SECONDS), '-vf', f'format=yuv420p{draw}',
        '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', str(media / f'{name}.mp4'))
    # Proxy: small, short GOP, so seeking stays quick.
    run('-i', str(media / f'{name}.mp4'), '-vf', 'scale=-2:720', '-c:v', 'h264_videotoolbox', '-b:v', '3M', '-g', '15', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-movflags', '+faststart', str(media / f'{name}.proxy.mp4'))
clip('base', (1920, 1080), None)
clip('pip_a', (1920, 1080), 'magenta')
clip('pip_b', (1920, 1080), 'cyan')
song = sys.argv[1]
run('-stream_loop', '-1', '-i', song, '-t', str(SECONDS), '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '160k', str(media / 'song.m4a'))
print(sorted(p.name for p in media.iterdir()))
