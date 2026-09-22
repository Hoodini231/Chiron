from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pathlib import Path
import shutil
import uuid

from backend.decode import normalize_to_mp4, probe_video

MEDIA_DIR = Path("media")
MEDIA_DIR.mkdir(exist_ok=True)

MAX_VIDEO_BYTES = 160 * 1024 * 1024
ACCEPTED_TYPES = ("video/mp4", "video/webm", "video/quicktime")

app = FastAPI(title="Dodgeball Lab", version="0.1.0")


@app.post("/api/v1/media")
async def upload_media(file: UploadFile):
    if file.content_type not in ACCEPTED_TYPES:
        raise HTTPException(400, "Only MP4, WebM, and MOV videos are accepted.")

    media_id = uuid.uuid4().hex
    media_path = MEDIA_DIR / media_id
    media_path.mkdir()

    ext = {
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
    }[file.content_type]
    raw = media_path / f"upload{ext}"

    size = 0
    with open(raw, "wb") as f:
        while chunk := await file.read(64 * 1024):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                shutil.rmtree(media_path)
                raise HTTPException(413, "Video exceeds 160 MB limit.")
            f.write(chunk)

    dest = media_path / "original.mp4"
    try:
        if ext == ".mp4":
            raw.rename(dest)
        else:
            normalize_to_mp4(raw, dest)
            raw.unlink()
    except Exception as e:
        shutil.rmtree(media_path)
        raise HTTPException(422, f"Could not convert video: {e}")

    try:
        probe = probe_video(dest)
    except Exception as e:
        shutil.rmtree(media_path)
        raise HTTPException(422, f"Could not read video: {e}")

    return JSONResponse(
        status_code=201,
        content={
            "media_id": media_id,
            "filename": dest.name,
            "size_bytes": size,
            "probe": probe,
        },
    )


@app.get("/api/v1/media/{media_id}")
async def get_media(media_id: str):
    media_path = MEDIA_DIR / media_id / "original.mp4"
    if not media_path.exists():
        raise HTTPException(404, "Media not found.")
    return probe_video(media_path)
