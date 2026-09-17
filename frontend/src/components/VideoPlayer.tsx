import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../utils/format';

const FRAME_DUR = 1 / 30;
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

interface Props {
  src: string | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export default function VideoPlayer({ src, videoRef: externalRef }: Props) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoEl = externalRef ?? internalRef;
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const sync = useCallback(() => {
    const v = videoEl.current;
    if (!v) return;
    setPaused(v.paused);
    setCurrentTime(v.currentTime);
  }, [videoEl]);

  useEffect(() => {
    const v = videoEl.current;
    if (!v) return;
    const onMeta = () => {
      setDuration(v.duration);
      sync();
    };
    v.addEventListener('timeupdate', sync);
    v.addEventListener('pause', sync);
    v.addEventListener('play', sync);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('timeupdate', sync);
      v.removeEventListener('pause', sync);
      v.removeEventListener('play', sync);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [videoEl, sync]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const v = videoEl.current;
      if (!v) return;

      if (e.code === 'Space') {
        e.preventDefault();
        v.paused ? v.play() : v.pause();
      } else if (e.code === 'ArrowLeft' && e.shiftKey) {
        v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (e.code === 'ArrowRight' && e.shiftKey) {
        v.currentTime = Math.min(v.duration, v.currentTime + 5);
      } else if (e.code === 'ArrowLeft') {
        v.pause();
        v.currentTime = Math.max(0, v.currentTime - FRAME_DUR);
      } else if (e.code === 'ArrowRight') {
        v.pause();
        v.currentTime = Math.min(v.duration, v.currentTime + FRAME_DUR);
      } else if (e.code === 'Comma') {
        const i = SPEEDS.indexOf(v.playbackRate);
        if (i > 0) {
          v.playbackRate = SPEEDS[i - 1];
          setSpeed(SPEEDS[i - 1]);
        }
      } else if (e.code === 'Period') {
        const i = SPEEDS.indexOf(v.playbackRate);
        if (i >= 0 && i < SPEEDS.length - 1) {
          v.playbackRate = SPEEDS[i + 1];
          setSpeed(SPEEDS[i + 1]);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [videoEl]);

  const togglePlay = () => {
    const v = videoEl.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  const skip = (delta: number) => {
    const v = videoEl.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  };

  const frameStep = (dir: number) => {
    const v = videoEl.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(
      0,
      Math.min(v.duration, v.currentTime + dir * FRAME_DUR),
    );
  };

  const changeSpeed = (newSpeed: number) => {
    const v = videoEl.current;
    if (!v) return;
    v.playbackRate = newSpeed;
    setSpeed(newSpeed);
  };

  return (
    <div className="video-player">
      <video ref={videoEl} src={src ?? undefined} playsInline />
      <div className="playback-controls">
        <div className="playback-row">
          <button onClick={() => frameStep(-1)} title="Previous frame (←)">
            ‹ Frame
          </button>
          <button onClick={() => skip(-5)} title="Back 5s (Shift+←)">
            ⏪ 5s
          </button>
          <button onClick={togglePlay} title="Play/Pause (Space)">
            {paused ? '▶' : '⏸'}
          </button>
          <button onClick={() => skip(5)} title="Forward 5s (Shift+→)">
            5s ⏩
          </button>
          <button onClick={() => frameStep(1)} title="Next frame (→)">
            Frame ›
          </button>
          <select
            value={speed}
            onChange={(e) => changeSpeed(parseFloat(e.target.value))}
            title="Playback speed (,/.)"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <div className="playback-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
    </div>
  );
}
