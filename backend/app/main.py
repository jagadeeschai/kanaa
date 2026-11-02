from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from app.db.database import init_db
from app.services.render_queue_service import recover_after_restart
from app.api.routes import router
from app.api.ai_routes import router as ai_router
from app.api.timeline_routes import router as timeline_router
from app.services.lyric_image_service import recover_scene_jobs

@asynccontextmanager
async def lifespan(app):
    init_db()
    recover_after_restart()
    recover_scene_jobs()
    yield

app = FastAPI(title='WideAngle Motion', lifespan=lifespan)
app.include_router(router, prefix='/api')

app.include_router(ai_router, prefix="/api")
app.include_router(timeline_router, prefix='/api')


FRONTEND = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'


@app.get('/{path:path}', include_in_schema=False)
def frontend(path: str):
    """The built page, for the Mac app. In development Vite serves it instead."""
    if path.startswith('api/') or not FRONTEND.is_dir():
        raise HTTPException(404, 'Not Found')
    root = FRONTEND.resolve()
    file = (root / path).resolve()
    return FileResponse(file if file.is_file() and root in file.parents else root / 'index.html')
