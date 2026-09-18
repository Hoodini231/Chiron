import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import * as api from '../api/client';
import ChatPanel from '../components/ChatPanel';
import ResizablePanel from '../components/ResizablePanel';
import VideoPlayer from '../components/VideoPlayer';
import type { ConfigResponse, ResultDetailResponse } from '../types/api';
import type { Manifest } from '../types/schema';
import { angleRange, percent } from '../utils/format';

function stat(label: string, value: string) {
  return (
    <div key={label}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ResultsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [recordings, setRecordings] = useState<Manifest[]>([]);
  const [current, setCurrent] = useState<ResultDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adviceBusy, setAdviceBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const loadTokenRef = useRef(0);

  const layoutRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [colSplit, setColSplit] = useState(65);
  const [rowSplit, setRowSplit] = useState(35);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getResults()])
      .then(([cfg, list]) => {
        setConfig(cfg);
        setRecordings(list.results);
        setLoading(false);

        if (!list.results.length) return;

        const requestedId = id;
        const validId = list.results.find((r) => r.id === requestedId)?.id ?? list.results[0].id;

        if (!requestedId || requestedId !== validId) {
          navigate(`/results/${validId}`, { replace: true });
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
    setChatStatus('');
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

  const handleRecordingChange = (newId: string) => {
    navigate(`/results/${newId}`, { replace: true });
  };

  const handleGenerateAdvice = async () => {
    if (!current || adviceBusy || !config?.llm_configured) return;
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

  const handleSendChat = async (message: string) => {
    if (!current || !config?.llm_configured) return;
    const resultId = current.id;
    setChatStatus('Coach is replying...');
    try {
      const chat = await api.sendChat(resultId, message);
      setCurrent((prev) => (prev?.id === resultId ? { ...prev, chat } : prev));
      setChatStatus('Conversation saved.');
    } catch (err) {
      setChatStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const available = config?.llm_configured ?? false;

  if (loading) {
    return (
      <main className="layout">
        <section className="video-pane results-pane">
          <div className="empty-library">
            <h1>Saved results</h1>
            <p>Loading recordings...</p>
          </div>
        </section>
      </main>
    );
  }

  if (error && !recordings.length) {
    return (
      <main className="layout">
        <section className="video-pane results-pane">
          <div className="empty-library">
            <h1>Saved results</h1>
            <p>Could not load local results: {error}</p>
            <a href="#/capture">Record a throw</a>
          </div>
        </section>
      </main>
    );
  }

  const m = current?.metrics;

  return (
    <main
      className="layout"
      ref={layoutRef}
      style={{ gridTemplateColumns: `${colSplit}% 6px 1fr` }}
    >
      <section className="video-pane results-pane">
        {current ? (
          <>
            <VideoPlayer src={`/results/${current.id}/${current.processed}`} />
            <div className="result-nav">
              <a href="#/capture">← Record a throw</a>
              <a href={`/results/${current.id}/${current.original}`}>Original video ↗</a>
              <a href={`#/analysis/${current.id}`}>Analysis view ↗</a>
            </div>
          </>
        ) : recordings.length === 0 ? (
          <div className="empty-library">
            <h1>Saved results</h1>
            <p>Recordings will appear here after you press Stop.</p>
            <a href="#/capture">Record a throw</a>
          </div>
        ) : null}
      </section>

      <ResizablePanel
        axis="col"
        min={40}
        max={80}
        containerRef={layoutRef}
        onResize={setColSplit}
      />

      <aside
        className="sidebar"
        ref={sidebarRef}
        style={{ gridTemplateRows: `${rowSplit}% 6px 1fr` }}
      >
        <section className="half">
          <h2>
            Stats <span className="tag">RESULT</span>
          </h2>
          <label htmlFor="recording-list" className="hint">
            Recording
          </label>
          <select
            id="recording-list"
            value={id ?? ''}
            onChange={(e) => handleRecordingChange(e.target.value)}
            disabled={!recordings.length}
          >
            {recordings.length === 0 && <option>No recordings yet</option>}
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.created_at).toLocaleString()} · {r.metrics.duration_s.toFixed(1)}s
              </option>
            ))}
          </select>

          {m && (
            <div className="stats">
              {current?.report.throw_detection &&
                stat('Throws', String(current.report.throw_detection.segments.length))}
              {current?.report.capture.original_duration_s != null &&
                current.report.throw_detection &&
                stat(
                  'Original duration',
                  `${current.report.capture.original_duration_s.toFixed(1)} s`,
                )}
              {stat('Duration', `${m.duration_s.toFixed(1)} s`)}
              {stat('Processed FPS', m.processed_fps?.toFixed(1) ?? '—')}
              {stat('Ball visible', percent(m.ball_detection_fraction))}
              {stat('Body detected', percent(m.pose_detection_fraction))}
              {stat('Hands detected', percent(m.hand_detection_fraction))}
              {stat('Left elbow · 2D', angleRange(m.projected_angles_deg?.left_elbow_deg))}
              {stat('Right elbow · 2D', angleRange(m.projected_angles_deg?.right_elbow_deg))}
            </div>
          )}

          {current && (
            <div>
              <span className="chart-label">Observed ball path · image plane</span>
              <TrajectoryChart record={current} />
              <p className="metric-note">
                Joint-angle ranges cover the whole clip. Speed and load/release timing are not yet
                measured.
              </p>
              <a
                href={`/results/${current.id}/data.json`}
                download={`throw-${current.id}.json`}
                className="hint"
              >
                Download pipeline JSON
              </a>
            </div>
          )}
        </section>

        <ResizablePanel
          axis="row"
          min={15}
          max={70}
          containerRef={sidebarRef}
          onResize={setRowSplit}
        />

        <section className="half advice-panel chat-panel">
          <h2>
            Advice <span className="tag">LLM</span>
          </h2>
          <button
            className="primary"
            id="generate-advice"
            disabled={!available || !current || !!current.advice || adviceBusy}
            onClick={handleGenerateAdvice}
          >
            {adviceBusy
              ? 'Reviewing the measured movement...'
              : current?.advice
                ? 'Advice saved'
                : 'Get coaching advice'}
          </button>
          <div className="conversation-scroll">
            <div
              id="advice"
              role="status"
              aria-live="polite"
              style={{
                fontSize: '15px',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
              }}
            >
              {current?.advice?.text ??
                (available
                  ? 'Ready to review this recording.'
                  : 'LLM not connected. Add a GEMINI_API_KEY or OPENAI_API_KEY to .env and restart the server.')}
            </div>
            <ChatPanel
              messages={current?.chat?.messages ?? []}
              onSend={handleSendChat}
              disabled={!current || !available}
              status={chatStatus}
            />
          </div>
          <p className="hint bottom-note">
            {available
              ? `Advice and chat send your messages, derived stats and sampled landmarks to ${config?.provider}. Videos stay local.`
              : 'LLM not connected. Configure GEMINI_API_KEY or OPENAI_API_KEY in .env and restart the local server.'}
          </p>
        </section>
      </aside>
    </main>
  );
}

function TrajectoryChart({ record }: { record: ResultDetailResponse }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dim = record.report.coordinate_system;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c5f36b';
    ctx.lineWidth = 2;

    const scale = Math.min((canvas.width - 20) / dim.width, (canvas.height - 20) / dim.height);
    const ox = (canvas.width - dim.width * scale) / 2;
    const oy = (canvas.height - dim.height * scale) / 2;

    let previous: {
      x: number;
      y: number;
      t: number;
      track_id: number;
      throw_id?: number;
    } | null = null;

    for (const s of record.report.samples) {
      if (!s.ball) {
        previous = null;
        continue;
      }
      const x = ox + s.ball.x_px * scale;
      const y = oy + s.ball.y_px * scale;
      ctx.beginPath();
      if (
        previous &&
        s.t_s - previous.t < 0.12 &&
        previous.track_id === s.ball.track_id &&
        previous.throw_id === s.throw_id
      ) {
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#c5f36b';
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      previous = {
        x,
        y,
        t: s.t_s,
        track_id: s.ball.track_id,
        throw_id: s.throw_id,
      };
    }
  }, [record]);

  return <canvas ref={canvasRef} className="chart" width={500} height={160} />;
}
