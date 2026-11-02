"""Serves the spike page and media with range support, and accepts preview captures."""
import json, sys
from pathlib import Path
here = Path(__file__).parent
sys.path.insert(0, str(here.parent / 'backend'))
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse
from app.services.video_service import serve_file_with_ranges
app = FastAPI()
@app.get('/')
def page(): return FileResponse(here / 'index.html')
@app.get('/media/{name}')
def media(name: str, request: Request):
    path = here / '.media' / name
    if path.parent != here / '.media' or not path.is_file(): raise HTTPException(404)
    return serve_file_with_ranges(path, 'video/mp4' if name.endswith('.mp4') else 'audio/mp4', request)
@app.get('/out/{name}')
def output(name: str): return FileResponse(here / '.out' / Path(name).name)
@app.get('/file/{name}')
def spike_file(name: str): return FileResponse(here / Path(name).name, media_type='text/javascript' if name.endswith('.js') else None)
@app.post('/capture/{name}')
async def capture(name: str, request: Request):
    (here / '.out' / Path(name).name).write_bytes(await request.body()); return {'ok': True}
@app.post('/report/{name}')
async def report(name: str, request: Request):
    (here / '.out' / Path(name).name).write_text(json.dumps(await request.json(), indent=1)); return {'ok': True}
