from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from app.services import phone_service
from app.db.database import init_db
from app.services.render_queue_service import recover_after_restart
from app.api.routes import router
from app.api.ai_routes import router as ai_router
from app.api.lights_routes import router as lights_router
from app.api.timeline_routes import router as timeline_router
from app.services.lyric_image_service import recover_scene_jobs

@asynccontextmanager
async def lifespan(app):
    init_db()
    recover_after_restart()
    recover_scene_jobs()
    yield

app = FastAPI(title='Kanaa', lifespan=lifespan)


@app.middleware('http')
async def phone_gate(request: Request, call_next):
    """The Mac itself always gets in. Another device needs phone access turned on and its PIN entered once."""
    device = request.client.host if request.client else ''
    if phone_service.is_local(device):
        return await call_next(request)
    path = request.url.path
    if not phone_service.enabled():
        return JSONResponse({'detail': 'Phone access is off. Turn it on in Kanaa on your Mac.'}, status_code=403)
    if path == '/api/phone/login' and request.method == 'POST':
        return await call_next(request)
    if phone_service.signed_in(request.cookies.get(phone_service.COOKIE)):
        if path.startswith('/api/phone') and path != '/api/phone/login':
            return JSONResponse({'detail': 'Phone access is managed on your Mac.'}, status_code=403)
        return await call_next(request)
    if path.startswith('/api/'):
        return JSONResponse({'detail': 'Enter the PIN first.'}, status_code=401)
    return HTMLResponse(phone_service.LOGIN_PAGE, headers={'Cache-Control': 'no-store'})


class PhoneLogin(BaseModel):
    pin: str


class PhoneSwitch(BaseModel):
    enabled: bool


def mac_only(request: Request) -> None:
    if not phone_service.is_local(request.client.host if request.client else ''):
        raise HTTPException(403, 'Phone access is managed on your Mac.')


@app.get('/api/phone')
def phone_status(request: Request):
    mac_only(request)
    return phone_service.status()


@app.post('/api/phone')
def phone_switch(body: PhoneSwitch, request: Request):
    mac_only(request)
    return phone_service.set_enabled(body.enabled)


@app.post('/api/phone/new-pin')
def phone_new_pin(request: Request):
    mac_only(request)
    return phone_service.renew_pin()


@app.post('/api/phone/login')
def phone_login(body: PhoneLogin, request: Request):
    token, problem = phone_service.sign_in(body.pin, request.client.host if request.client else '')
    if not token:
        raise HTTPException(403 if problem and 'off' in problem else 401, problem)
    response = JSONResponse({'ok': True})
    response.set_cookie(phone_service.COOKIE, token, max_age=phone_service.SESSION_SECONDS, httponly=True, samesite='strict', path='/')
    return response

app.include_router(router, prefix='/api')

app.include_router(ai_router, prefix="/api")
app.include_router(timeline_router, prefix='/api')
app.include_router(lights_router, prefix='/api')


FRONTEND = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'


@app.get('/{path:path}', include_in_schema=False)
def frontend(path: str):
    """The built page, for the Mac app. In development Vite serves it instead."""
    if path.startswith('api/') or not FRONTEND.is_dir():
        raise HTTPException(404, 'Not Found')
    root = FRONTEND.resolve()
    file = (root / path).resolve()
    return FileResponse(file if file.is_file() and root in file.parents else root / 'index.html')
