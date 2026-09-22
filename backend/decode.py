from pathlib import Path
import av
import subprocess


def probe_video(path: Path) -> dict:
    """Read container metadata only — no frame decoding."""
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        time_base = stream.time_base
        native_fps = float(stream.average_rate) if stream.average_rate else None
        width = stream.codec_context.width
        height = stream.codec_context.height
        duration_s = float(stream.duration * time_base) if stream.duration else None

    return {
        "native_fps": native_fps,
        "width": width,
        "height": height,
        "duration_s": duration_s,
    }


def normalize_to_mp4(src: Path, dst: Path) -> None:
    """Convert any supported video to MP4 (H.264 + AAC). Handles VFR → CFR."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-fps_mode", "cfr",
        "-c:a", "aac",
        "-movflags", "+faststart",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-500:] if result.stderr else "ffmpeg failed")


def iter_frames(path: Path, analysis_fps: float):
    """Yield (index, pts_seconds, numpy_bgr_array) at the chosen analysis FPS."""
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        time_base = stream.time_base
        native_fps = float(stream.average_rate) if stream.average_rate else 30.0
        step = max(1, round(native_fps / analysis_fps))

        frame_index = 0
        output_index = 0
        for frame in container.decode(video=0):
            if frame_index % step == 0:
                pts_s = float(frame.pts * time_base) if frame.pts is not None else None
                bgr = frame.to_ndarray(format="bgr24")
                yield output_index, pts_s, bgr
                output_index += 1
            frame_index += 1
