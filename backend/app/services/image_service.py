from pathlib import Path
from PIL import Image, ImageOps


def render_edited_image_to(source: Path, extension: str, edits: dict, target: Path):
    # Imported media belongs to this app; never write back to the source.
    with Image.open(source) as image:
        ImageOps.exif_transpose(image).convert('RGB').save(target, format='PNG')
