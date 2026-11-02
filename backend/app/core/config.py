import os
from pathlib import Path

class Settings:
    data_dir = Path(os.getenv('WIDEANGLE_MOTION_DATA_DIR', str(Path(__file__).resolve().parents[2] / '.data')))
    thumbnail_dir = data_dir / 'thumbnails'
    edit_workspace_dir = data_dir / 'exports'
    model_cache_dir = Path(os.getenv('WIDEANGLE_MOTION_MODEL_CACHE', str(Path(__file__).resolve().parents[2] / '.models')))
    lyric_sync_model = os.getenv('WIDEANGLE_MOTION_LYRIC_MODEL', 'small')
    thumbnail_size = 480
    thumbnail_quality = 85

settings = Settings()
