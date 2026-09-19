import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import * as api from '../api/client';
import type { ConfigResponse, ResultDetailResponse } from '../types/api';
import type { Manifest, Sample } from '../types/schema';
import {
  extractStats,
  parseAdvice,
  parseCoachingNote,
  type AdvicePhase,
  type AdvicePriority,
  type ParsedAdvice,
} from '../utils/adviceParser';
import { percent } from '../utils/format';
import '../styles/analysis.css';

function badgeFor(status: string) {
  return status === 'good' ? 'Strong' : status === 'improve' ? 'Needs work' : 'Insufficient data';
}

function classFor(status: string) {
  return status === 'good' ? 'green' : status === 'improve' ? 'red' : 'yellow';
}

function dominantHand(samples: Sample[]) {
  let l = 0,
    r = 0;
  for (const s of samples)
    for (const h of s.hands || []) {
      if (h.associated_pose_side === 'left') l++;
      else if (h.associated_pose_side === 'right') r++;
    }
  return l === 0 && r === 0 ? '—' : r >= l ? 'Right' : 'Left';
}

function meanBallScore(samples: Sample[]) {
  let sum = 0,
    n = 0;
  for (const s of samples)
    if (s.ball?.tracking_score != null) {
      sum += s.ball.tracking_score;
      n++;
    }
  return n > 0 ? sum / n : null;
}

function shortMethod(m: string | undefined) {
  return m
    ? m
        .replace(/_/g, ' ')
        .replace('opencv colour segmentation and validated circle edges', 'Colour + circle edges')
    : '—';
}

function formatColour(t: { colour?: string; hue?: number }) {
  if (t.colour && t.colour !== 'sampled')
    return t.colour.charAt(0).toUpperCase() + t.colour.slice(1);
  if (t.hue != null) return 'HSV hue ' + t.hue;
  return '—';
}

function formatTime(s: number) {
  if (!Number.isFinite(s)) return '0:00.0';
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export default function AnalysisPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [recordings, setRecordings] = useState<Manifest[]>([]);
  const [current, setCurrent] = useState<ResultDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adviceBusy, setAdviceBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const loadTokenRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const available = config?.llm_configured ?? false;

  useEffect(() => {
    Promise.all([api.getConfig(), api.getResults()])
      .then(([cfg, list]) => {
        setConfig(cfg);
        setRecordings(list.results);
        setLoading(false);

        if (!list.results.length || !id) return;
        if (!list.results.find((r) => r.id === id)) {
          navigate(`/analysis/${list.results[0].id}`, { replace: true });
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadResult = useCallback(async (resultId: string) => {
    const token = ++loadTokenRef.current;
    setCurrent(null);
    try {
      const record = await api.getResult(resultId);
      if (token !== loadTokenRef.current) return;
      setCurrent(record);
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (id && recordings.length > 0) {
      loadResult(id);
    }
  }, [id, recordings, loadResult]);

  const handleGenerateAdvice = async () => {
    if (!current || adviceBusy || !available) return;
    const resultId = current.id;
    setAdviceBusy(true);
    try {
      const advice = await api.getAdvice(resultId);
      setCurrent((prev) => (prev?.id === resultId ? { ...prev, advice } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdviceBusy(false);
    }
  };

  const handleSendChat = async () => {
    const input = document.querySelector<HTMLTextAreaElement>('.chat-popup-input textarea');
    if (!input || !current || !available || chatBusy) return;
    const message = input.value.trim();
    if (!message) return;
    const resultId = current.id;
    setChatBusy(true);
    setChatStatus('Coach is replying...');
    try {
      const chat = await api.sendChat(resultId, message);
      setCurrent((prev) => (prev?.id === resultId ? { ...prev, chat } : prev));
      input.value = '';
      setChatStatus('Conversation saved.');
    } catch (err) {
      setChatStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setChatBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ padding: '40px', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="page" style={{ padding: '40px', textAlign: 'center' }}>
        <p>{error}</p>
        <a href="#/results">← Back to results</a>
      </div>
    );
  }

  const m = current?.metrics;
  const advice = current?.advice ? parseAdvice(current.advice.text) : null;

  return (
    <>
      <div className="top-bar">
        <a href="/">← Record a throw</a>
        <select value={id ?? ''} onChange={(e) => navigate(`/analysis/${e.target.value}`)}>
          {recordings.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.created_at).toLocaleString()} · {r.metrics.duration_s.toFixed(1)}s
            </option>
          ))}
        </select>
        {current && (
          <a href={`/results/${current.id}/${current.original}`}>
            Original video ↗
          </a>
        )}
      </div>

      <div className="page">
        {/* Hero section */}
        <div className="hero">
          <div className="video-panel">
            <CroppedVideo record={current} videoRef={videoRef} />
            <div className="video-meta">
              {m &&
                `${m.duration_s.toFixed(1)}s · ${m.processed_frames} frames · ${m.processed_fps?.toFixed(1) ?? '—'} fps`}
            </div>
            <PlaybackControls videoRef={videoRef} recordId={current?.id} />
          </div>

          <div className="hero-divider" />

          <div className="score-column">
            <div className="score-header">
              Coaching Review
              {advice && current?.advice && (
                <span>
                  powered by {current.advice.provider} {current.advice.model}
                </span>
              )}
            </div>

            {!advice ? (
              <div id="no-advice-section">
                <p>
                  {available
                    ? 'Generate coaching advice to see the assessment.'
                    : 'LLM not connected. Add API key to .env and restart.'}
                </p>
                <button
                  className="generate-btn"
                  onClick={handleGenerateAdvice}
                  disabled={!available || adviceBusy}
                >
                  {adviceBusy ? 'Generating...' : 'Get coaching advice'}
                </button>
              </div>
            ) : (
              <>
                <div className="section-title">Throw phases</div>
                <ScorePills phases={advice.phases} />
              </>
            )}
          </div>
        </div>

        {/* Priorities */}
        {advice && advice.priorities.length > 0 && (
          <>
            <hr className="divider" />
            <div className="section-title">Top 3 priorities</div>
            <Priorities priorities={advice.priorities} />
          </>
        )}

        {/* Coaching Breakdown */}
        {advice && (
          <>
            <hr className="divider" />
            <div className="section-title">Coaching breakdown</div>
            <CoachingBreakdown advice={advice} duration={m?.duration_s} />
          </>
        )}

        {/* Limits */}
        {advice && (
          <div className="limits-footer">
            <span className="limits-icon">⚠</span>
            <span>{advice.limits || 'No specific limitations noted.'}</span>
          </div>
        )}

        {/* Pipeline Data Drawer */}
        <div className="divider" />
        <button className="data-toggle" onClick={() => setDrawerOpen(!drawerOpen)}>
          {drawerOpen ? '▾' : '▸'} Pipeline data
        </button>
        <div
          className="data-drawer"
          style={{
            gridTemplateRows: drawerOpen ? '1fr' : '0fr',
          }}
        >
          <div className="data-drawer-inner">{current && <PipelineData record={current} />}</div>
        </div>
      </div>

      {/* Chat FAB + Popup */}
      <button
        className="chat-fab"
        onClick={() => setChatOpen(!chatOpen)}
        aria-label="Toggle coach chat"
      >
        <span className="fab-icon">{chatOpen ? '✕' : '💬'}</span>
        {!chatOpen && <span className="fab-label">Coach chat</span>}
      </button>

      {chatOpen && (
        <div className="chat-popup">
          <div className="chat-popup-header">
            <h3>
              Ask the coach <span className="tag">LLM</span>
            </h3>
            <button onClick={() => setChatOpen(false)}>✕</button>
          </div>
          <div className="chat-messages">
            {(current?.chat?.messages?.length ?? 0) === 0 ? (
              <div className="chat-empty">
                Ask the coach about your throw — technique, drills, or what to focus on next.
              </div>
            ) : (
              current?.chat?.messages.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role === 'user' ? 'user' : 'coach'}`}>
                  <span className="msg-label">{msg.role === 'user' ? 'You' : 'Coach'}</span>
                  {msg.text}
                </div>
              ))
            )}
          </div>
          <div className="chat-popup-input">
            <textarea
              placeholder="Ask about your technique..."
              maxLength={2000}
              disabled={!available || chatBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
            />
            <button onClick={handleSendChat} disabled={!available || chatBusy}>
              {chatBusy ? '...' : 'Send'}
            </button>
          </div>
          <div className="chat-popup-hint">
            {chatStatus && <span>{chatStatus}</span>}
            <span>Videos stay local. Stats and messages are sent to the LLM.</span>
          </div>
        </div>
      )}
    </>
  );
}

// --- Sub-components ---

function CroppedVideo({ record, videoRef }: { record: ResultDetailResponse | null; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  useEffect(() => {
    if (!record || !videoRef.current) return;
    const v = videoRef.current;
    const samples = record.report?.samples || [];

    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0,
      count = 0;
    for (const s of samples) {
      if (!s.pose) continue;
      for (let i = 11; i < s.pose.length; i++) {
        const p = s.pose[i];
        if (p && (p.visibility ?? 0) >= 0.5) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
          count++;
        }
      }
    }

    if (count >= 10) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const pad = 0.15;
      const bw = maxX - minX + pad * 2;
      const bh = maxY - minY + pad * 2;
      const zoom = Math.min(2, Math.max(1.05, 1 / Math.max(bw, bh)));
      const clamp = (val: number) => Math.max(0, Math.min(100, val));

      v.style.objectFit = 'cover';
      v.style.objectPosition = `${clamp(cx * 100)}% ${clamp(cy * 100)}%`;
      v.style.transform = `scale(${zoom.toFixed(2)})`;
      v.style.transformOrigin = `${clamp(cx * 100)}% ${clamp(cy * 100)}%`;
    } else {
      v.style.objectFit = '';
      v.style.objectPosition = '';
      v.style.transform = '';
      v.style.transformOrigin = '';
    }
  }, [record]);

  if (!record) return null;

  return (
    <div className="video-crop">
      <video
        ref={videoRef}
        id="result-video"
        src={`/results/${record.id}/${record.processed}`}
        playsInline
        loop
      />
    </div>
  );
}

function PlaybackControls({ videoRef, recordId }: { videoRef: React.RefObject<HTMLVideoElement | null>; recordId?: string }) {
  const FRAME_DUR = 1 / 30;
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(0.5);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    v.playbackRate = 0.5;
    setSpeed(0.5);

    const sync = () => {
      setPaused(v.paused);
      setCurrentTime(v.currentTime);
    };
    const onMeta = () => {
      setDuration(v.duration);
      sync();
    };

    v.addEventListener('timeupdate', sync);
    v.addEventListener('pause', sync);
    v.addEventListener('play', sync);
    v.addEventListener('loadedmetadata', onMeta);
    if (v.readyState >= 1) onMeta();

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
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
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      v.removeEventListener('timeupdate', sync);
      v.removeEventListener('pause', sync);
      v.removeEventListener('play', sync);
      v.removeEventListener('loadedmetadata', onMeta);
      document.removeEventListener('keydown', onKey);
    };
  }, [videoRef, recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="video-controls-bar">
      <button onClick={() => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = Math.max(0, v.currentTime - FRAME_DUR); } }}>‹</button>
      <button onClick={() => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); }}>{paused ? '▶' : '⏸'}</button>
      <button onClick={() => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = Math.min(v.duration, v.currentTime + FRAME_DUR); } }}>›</button>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: '#9caaba' }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <select
        value={speed}
        onChange={(e) => { const v = videoRef.current; const s = parseFloat(e.target.value); if (v) v.playbackRate = s; setSpeed(s); }}
        style={{ width: 'auto', marginBottom: 0 }}
      >
        {[0.25, 0.5, 1, 1.5, 2].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}

function ScorePills({ phases }: { phases: AdvicePhase[] }) {
  return (
    <div id="score-pills">
      {phases.map((phase, i) => {
        const summary = (phase.subs[0]?.text || phase.coachingNote || '').split(/[.!]\s/)[0] + '.';
        const cueText = phase.coachingNote ? phase.coachingNote.split(/[.!]\s/)[0] + '.' : '';
        return (
          <div key={i} className={`category ${phase.status}`}>
            <div className="indicator" />
            <div className="cat-body">
              <div className="cat-title">
                {phase.title} <span className="badge">{badgeFor(phase.status)}</span>
              </div>
              <div className="cat-detail">{summary}</div>
              {cueText && <div className="cat-cue">{cueText}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Priorities({ priorities }: { priorities: AdvicePriority[] }) {
  return (
    <div className="priorities">
      {priorities.slice(0, 3).map((p, i) => (
        <div key={i} className="priority-card">
          <div className="priority-num">#{i + 1} PRIORITY</div>
          <div className="priority-title">{p.title}</div>
          <div className="priority-drill">{p.detail}</div>
        </div>
      ))}
    </div>
  );
}

function CoachingBreakdown({ advice, duration }: { advice: ParsedAdvice; duration?: number }) {
  return (
    <div className="dashboard" id="coaching-breakdown">
      {advice.overview && (
        <div className="sub-card" style={{ gridColumn: '1/-1' }}>
          <div className="sub-card-title">Overview</div>
          <p>{advice.overview}</p>
        </div>
      )}

      {advice.phases.map((phase, pi) => {
        const cls = classFor(phase.status);
        return <PhaseSection key={pi} phase={phase} cls={cls} />;
      })}

      <Timeline phases={advice.phases} duration={duration} />
    </div>
  );
}

function PhaseSection({ phase, cls }: { phase: AdvicePhase; cls: string }) {
  const tipCls =
    phase.status === 'good'
      ? 'good-tip'
      : phase.status === 'improve'
        ? 'improve-tip'
        : 'limited-tip';
  const parts = phase.coachingNote ? parseCoachingNote(phase.coachingNote) : null;

  return (
    <>
      <div className="phase-group-header">
        <span className="indicator" style={{ background: `var(--${cls})` }} />
        {phase.title}{' '}
        <span
          className="badge"
          style={{
            background: `var(--${cls}-bg)`,
            color: `var(--${cls})`,
            border: `1px solid var(--${cls}-border)`,
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          {badgeFor(phase.status)}
        </span>
      </div>

      {phase.subs.map((sub, si) => {
        const stats = extractStats(sub.text);
        return (
          <div key={si} className="sub-card">
            {sub.label && <div className="sub-card-title">{sub.label}</div>}
            <p>{sub.text}</p>
            {stats.length > 0 && (
              <div className="phase-stats">
                {stats.map((s, j) => (
                  <div key={j}>
                    <span>{s.label}</span>
                    <strong>{s.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {parts?.note && (
        <div className={`coaching-tip-card ${tipCls}`}>
          <div className="tip-label">Coaching note</div>
          {parts.note}
        </div>
      )}
      {parts?.drill && (
        <div className={`coaching-tip-card ${tipCls}`}>
          <div className="tip-label">Drill</div>
          {parts.drill}
        </div>
      )}
      {parts?.cue && (
        <div className={`coaching-tip-card ${tipCls}`}>
          <div className="tip-label">Cue</div>
          {parts.cue}
        </div>
      )}
    </>
  );
}

function Timeline({ phases, duration }: { phases: AdvicePhase[]; duration?: number }) {
  if (!duration || phases.length < 2) return null;

  const timesByPhase: {
    title: string;
    min: number;
    max: number;
    status: string;
  }[] = [];

  for (const phase of phases) {
    const allText = phase.subs.map((s) => s.text).join(' ') + ' ' + phase.coachingNote;
    const times: number[] = [];
    for (const m of allText.matchAll(/(?:at|by|around)\s+(\d+\.?\d*)\s*s/g)) {
      times.push(+m[1]);
    }
    if (times.length) {
      timesByPhase.push({
        title: phase.title,
        min: Math.min(...times),
        max: Math.max(...times),
        status: phase.status,
      });
    }
  }

  if (timesByPhase.length < 2) return null;

  return (
    <div className="card phase-card" style={{ gridColumn: '1/-1' }}>
      <div className="phase-header" style={{ color: 'var(--accent)' }}>
        <span
          className="indicator"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent)',
          }}
        />{' '}
        Release Timeline
      </div>
      <div className="timeline-bar">
        {timesByPhase.map((p, i) => {
          const dur = Math.max(0.1, p.max - p.min);
          const cls = p.title.toLowerCase().includes('load')
            ? 'tl-load'
            : p.title.toLowerCase().includes('release')
              ? 'tl-release'
              : 'tl-follow';
          return (
            <div key={i} className={`tl-phase ${cls}`} style={{ flex: dur.toFixed(1) }}>
              <span className="tl-label">{p.title.replace(' PHASE', '')}</span>
              <span className="tl-time">{dur.toFixed(1)}s</span>
            </div>
          );
        })}
      </div>
      <div className="phase-stats" style={{ marginTop: 8 }}>
        <div>
          <span>Total duration</span>
          <strong>{duration.toFixed(1)}s</strong>
        </div>
        {timesByPhase.map((p, i) => (
          <div key={`dur-${i}`}>
            <span>{p.title.replace(' PHASE', '')}</span>
            <strong>{(p.max - p.min).toFixed(1)}s</strong>
          </div>
        ))}
        {timesByPhase.map((p, i) => (
          <div key={`win-${i}`}>
            <span>{p.title.replace(' PHASE', '')} window</span>
            <strong>
              {p.min.toFixed(1)}–{p.max.toFixed(1)}s
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineData({ record }: { record: ResultDetailResponse }) {
  const m = record.metrics;
  const rpt = record.report;
  const trk = rpt.tracking;
  const cap = rpt.capture;
  const cs = rpt.coordinate_system;
  const samples = rpt.samples || [];

  const bf = m.ball_detection_fraction ?? 0;
  const pf = m.pose_detection_fraction ?? 0;
  const hf = m.hand_detection_fraction ?? 0;
  const frames = m.processed_frames || 0;

  const sep = m.projected_angles_deg?.hip_shoulder_separation_deg;
  const shoulderVel = m.shoulder_rotation_velocity_deg_s;
  const hipVel = m.hip_rotation_velocity_deg_s;
  const shoulderLine = m.projected_angles_deg?.shoulder_line_deg;
  const hipLine = m.projected_angles_deg?.hip_line_deg;

  const ms = meanBallScore(samples);
  const blur = samples.filter((s) => s.ball?.motion_blur_candidate).length;
  const lims = rpt.limitations || [];

  return (
    <>
      <div className="drawer-section-title">Capture</div>
      <div className="dashboard">
        <Card
          label="Duration"
          value={`${m.duration_s?.toFixed(1) ?? '—'}s`}
          sub={`${m.processed_frames} frames`}
        />
        {rpt.throw_detection && (
          <>
            <Card
              label="Throws"
              value={String(rpt.throw_detection.segments.length)}
              sub="Reviewed windows"
            />
            <Card
              label="Original duration"
              value={`${cap.original_duration_s?.toFixed(1)}s`}
              sub="Waiting time removed"
            />
          </>
        )}
        <Card
          label="Processed FPS"
          value={m.processed_fps?.toFixed(1) ?? '—'}
          sub={`Requested ${cap.requested_fps ?? 60} fps`}
        />
        <Card
          label="Source"
          value={cap.source || 'unknown'}
          sub={cs.width ? `${cs.width} × ${cs.height}` : ''}
        />
        <Card
          label="Timestamp"
          value={cap.timestamp_source || 'Unknown'}
          sub={rpt.throw_detection ? 'Joined-video playback time' : 'Recorded sample time'}
        />
      </div>

      <div className="drawer-section-title">Detection rates</div>
      <div className="dashboard">
        <BarCard
          label="Ball visible"
          value={percent(bf)}
          fraction={bf}
          sub={`${Math.round(bf * frames)} of ${frames} frames`}
        />
        <BarCard
          label="Body detected"
          value={percent(pf)}
          fraction={pf}
          sub={`${Math.round(pf * frames)} of ${frames} frames`}
        />
        <BarCard
          label="Hands detected"
          value={percent(hf)}
          fraction={hf}
          sub={`${Math.round(hf * frames)} of ${frames} frames`}
        />
        <Card label="Dominant hand" value={dominantHand(samples)} sub="Ball–wrist association" />
      </div>

      <div className="drawer-section-title">Hip-shoulder separation &amp; rotation</div>
      <div className="dashboard">
        <Card
          label="Hip-shoulder separation"
          value={sep ? `${Math.round(sep.min)}° to ${Math.round(sep.max)}°` : '—'}
          sub={
            sep
              ? `Peak separation ${Math.round(Math.max(Math.abs(sep.min), Math.abs(sep.max)))}° · ${sep.observations} frames`
              : 'No data'
          }
        />
        <Card
          label="Torso rotation velocity"
          value={shoulderVel ? `${Math.round(shoulderVel.peak!)}°/s` : '—'}
          sub={shoulderVel ? `Peak · mean ${Math.round(shoulderVel.mean!)}°/s` : 'No data'}
        />
        <Card
          label="Pelvic rotation velocity"
          value={hipVel ? `${Math.round(hipVel.peak!)}°/s` : '—'}
          sub={hipVel ? `Peak · mean ${Math.round(hipVel.mean!)}°/s` : 'No data'}
        />
        <Card
          label="Shoulder line range"
          value={
            shoulderLine
              ? `${Math.round(shoulderLine.min)}° to ${Math.round(shoulderLine.max)}°`
              : '—'
          }
          sub={shoulderLine ? `${shoulderLine.observations} frames` : 'No data'}
        />
        <Card
          label="Hip line range"
          value={hipLine ? `${Math.round(hipLine.min)}° to ${Math.round(hipLine.max)}°` : '—'}
          sub={hipLine ? `${hipLine.observations} frames` : 'No data'}
        />
        {hipVel && shoulderVel && (
          <Card
            label="Rotation sequence"
            value={hipVel.peak! > shoulderVel.peak! ? 'Pelvis leads' : 'Torso leads'}
            sub={`Pelvis peak ${Math.round(hipVel.peak!)}°/s · Torso peak ${Math.round(shoulderVel.peak!)}°/s`}
          />
        )}
      </div>

      <div className="drawer-section-title">Ball tracking</div>
      <div className="dashboard">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="card-label">Ball trajectory</div>
          <TrajectoryCanvas samples={samples} cs={cs} />
        </div>
        <Card
          label="Method"
          value={shortMethod(trk.method)}
          sub={`Hue ${trk.hue ?? '—'} · tol ${trk.tolerance ?? '—'}`}
        />
        <Card
          label="Ball colour"
          value={formatColour(trk)}
          sub="Core + broad + shape + saturated"
        />
        <Card label="Mean score" value={ms !== null ? ms.toFixed(2) : '—'} sub="Heuristic" />
        <Card label="Motion blur" value={`${blur} frames`} sub="Near release" />
      </div>

      <div className="drawer-section-title">Not yet measured</div>
      <div className="dashboard">
        {['Ball speed', 'Time to load', 'Time to release', 'Ball spin'].map((label) => (
          <div key={label} className="card placeholder-card">
            <div className="card-label">{label}</div>
            <div className="card-value placeholder-value">—</div>
          </div>
        ))}
      </div>

      {lims.length > 0 && (
        <>
          <div className="drawer-section-title">Limitations</div>
          <div className="dashboard">
            <div className="card" style={{ gridColumn: 'span 3' }}>
              <ul className="limits-list">
                {lims.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      <div className="drawer-section-title">Downloads</div>
      <div className="downloads-row">
        <a className="download-link" href={`/results/${record.id}/data.json`} download>
          Pipeline JSON
        </a>
        <a className="download-link" href={`/results/${record.id}/${record.original}`}>
          Original video
        </a>
        <a className="download-link" href={`/results/${record.id}/${record.processed}`}>
          Processed video
        </a>
      </div>
    </>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

function BarCard({
  label,
  value,
  fraction,
  sub,
}: {
  label: string;
  value: string;
  fraction: number;
  sub?: string;
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color: 'var(--accent)' }}>
        {value}
      </div>
      <div className="stat-bar">
        <div className="fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

function TrajectoryCanvas({
  samples,
  cs,
}: {
  samples: Sample[];
  cs: { width: number; height: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cs.width || !cs.height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c5f36b';
    ctx.lineWidth = 2;

    const scale = Math.min((canvas.width - 20) / cs.width, (canvas.height - 20) / cs.height);
    const ox = (canvas.width - cs.width * scale) / 2;
    const oy = (canvas.height - cs.height * scale) / 2;

    let prev: {
      x: number;
      y: number;
      t: number;
      tid: number;
      throw_id?: number;
    } | null = null;

    for (const s of samples) {
      if (!s.ball) {
        prev = null;
        continue;
      }
      const x = ox + s.ball.x_px * scale;
      const y = oy + s.ball.y_px * scale;
      ctx.beginPath();
      if (
        prev &&
        s.t_s - prev.t < 0.12 &&
        prev.tid === s.ball.track_id &&
        prev.throw_id === s.throw_id
      ) {
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#c5f36b';
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      prev = {
        x,
        y,
        t: s.t_s,
        tid: s.ball.track_id,
        throw_id: s.throw_id,
      };
    }
  }, [samples, cs]);

  return <canvas ref={canvasRef} className="path-canvas" width={500} height={80} />;
}
