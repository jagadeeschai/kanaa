from contextlib import asynccontextmanager
from fastapi import FastAPI
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
