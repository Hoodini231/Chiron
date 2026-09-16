const $ = (id) => document.getElementById(id);
let current = null,
  available = false,
  busy = false,
  loadToken = 0,
  chatBusy = false;
const FRAME_DUR = 1 / 30;
function formatTime(s) {
  if (!Number.isFinite(s)) return '0:00.0';
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
function initPlaybackControls() {
  const v = $('result-video'),
    panel = $('playback-controls');
  function sync() {
    $('pb-current').textContent = formatTime(v.currentTime);
    $('pb-play').textContent = v.paused ? '▶' : '⏸';
  }
  v.addEventListener('timeupdate', sync);
  v.addEventListener('pause', sync);
  v.addEventListener('play', sync);
  v.addEventListener('loadedmetadata', () => {
    $('pb-duration').textContent = formatTime(v.duration);
    sync();
  });
  $('pb-play').onclick = () => {
    v.paused ? v.play() : v.pause();
  };
  $('pb-skip-back').onclick = () => {
    v.currentTime = Math.max(0, v.currentTime - 5);
  };
  $('pb-skip-fwd').onclick = () => {
    v.currentTime = Math.min(v.duration, v.currentTime + 5);
  };
  $('pb-frame-back').onclick = () => {
    v.pause();
    v.currentTime = Math.max(0, v.currentTime - FRAME_DUR);
  };
  $('pb-frame-fwd').onclick = () => {
    v.pause();
    v.currentTime = Math.min(v.duration, v.currentTime + FRAME_DUR);
  };
  $('pb-speed').onchange = () => {
    v.playbackRate = parseFloat($('pb-speed').value);
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
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
      const i = $('pb-speed').selectedIndex;
      if (i > 0) {
        $('pb-speed').selectedIndex = i - 1;
        v.playbackRate = parseFloat($('pb-speed').value);
      }
    } else if (e.code === 'Period') {
      const i = $('pb-speed').selectedIndex;
      if (i < $('pb-speed').options.length - 1) {
        $('pb-speed').selectedIndex = i + 1;
        v.playbackRate = parseFloat($('pb-speed').value);
      }
    }
  });
}
initPlaybackControls();
const drafts = new Map();
function chatControls() {
  const disabled = !current || !available || chatBusy;
  $('chat-input').disabled = disabled;
  $('chat-send').disabled = disabled;
}
function renderChat() {
  $('chat-messages').replaceChildren();
  for (const message of current?.chat?.messages ?? []) {
    const item = document.createElement('div'),
      label = document.createElement('strong'),
      body = document.createElement('p');
    item.className = 'chat-message ' + message.role;
    label.textContent = message.role === 'user' ? 'You' : 'Coach';
    body.textContent = message.text;
    item.append(label, body);
    $('chat-messages').append(item);
  }
  const scroller = document.querySelector('.conversation-scroll');
  scroller.scrollTop = scroller.scrollHeight;
}
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function stat(label, value) {
  const row = document.createElement('div'),
    name = document.createElement('span'),
    number = document.createElement('strong');
  name.textContent = label;
  number.textContent = value;
  row.append(name, number);
  $('result-stats').append(row);
}
const percent = (n) => `${Math.round((n ?? 0) * 100)}%`;
function range(value) {
  return value ? `${Math.round(value.min)}–${Math.round(value.max)}°` : 'Unavailable';
}
async function show(id) {
  if (current) drafts.set(current.id, $('chat-input').value);
  const token = ++loadToken;
  current = null;
  chatControls();
  $('chat-messages').replaceChildren();
  $('chat-input').value = '';
  $('chat-status').textContent = '';
  $('generate-advice').disabled = true;
  try {
    const record = await api('/api/results/' + encodeURIComponent(id));
    if (token !== loadToken) return;
    current = record;
    renderChat();
    $('chat-input').value = drafts.get(id) || '';
    chatControls();
    history.replaceState(null, '', 'results.html?id=' + id);
    $('empty-library').hidden = true;
    $('result-video').hidden = false;
    $('playback-controls').hidden = false;
    $('result-video').src = `/results/${id}/${record.processed}`;
    $('original-link').href = `/results/${id}/${record.original}`;
    $('analysis-link').href = `results-v1.html?id=${id}`;
    $('analysis-link').hidden = false;
    $('original-link').hidden = false;
    $('json-link').href = `/results/${id}/data.json`;
    $('json-link').download = `throw-${id}.json`;
    $('trajectory').hidden = false;
    $('result-stats').replaceChildren();
    const m = record.metrics;
    stat('Duration', `${m.duration_s.toFixed(1)} s`);
    stat('Processed FPS', m.processed_fps?.toFixed(1) ?? '—');
    stat('Ball visible', percent(m.ball_detection_fraction));
    stat('Body detected', percent(m.pose_detection_fraction));
    stat('Hands detected', percent(m.hand_detection_fraction));
    stat('Left elbow · 2D', range(m.projected_angles_deg?.left_elbow_deg));
    stat('Right elbow · 2D', range(m.projected_angles_deg?.right_elbow_deg));
    const canvas = $('path-chart'),
      ctx = canvas.getContext('2d'),
      dim = record.report.coordinate_system;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c5f36b';
    ctx.lineWidth = 2;
    const scale = Math.min((canvas.width - 20) / dim.width, (canvas.height - 20) / dim.height),
      ox = (canvas.width - dim.width * scale) / 2,
      oy = (canvas.height - dim.height * scale) / 2;
    let previous = null;
    for (const s of record.report.samples) {
      if (!s.ball) {
        previous = null;
        continue;
      }
      const x = ox + s.ball.x_px * scale,
        y = oy + s.ball.y_px * scale;
      ctx.beginPath();
      if (previous && s.t_s - previous.t < 0.12 && previous.track_id === s.ball.track_id) {
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#c5f36b';
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      previous = { x, y, t: s.t_s, track_id: s.ball.track_id };
    }
    $('advice').textContent =
      record.advice?.text ||
      (available
        ? 'Ready to review this recording.'
        : 'LLM not connected. Add a GEMINI_API_KEY or OPENAI_API_KEY to .env and restart the server.');
    $('generate-advice').disabled = !available || !!record.advice;
    $('generate-advice').textContent = record.advice ? 'Advice saved' : 'Get coaching advice';
  } catch (e) {
    if (token !== loadToken) return;
    $('library-message').textContent = e.message;
    $('empty-library').hidden = false;
    $('result-video').hidden = true;
    $('advice').textContent = e.message;
  }
}
$('recording-list').onchange = () => show($('recording-list').value);
$('generate-advice').onclick = async () => {
  if (!current || busy || !available) return;
  const id = current.id;
  busy = true;
  $('generate-advice').disabled = true;
  $('advice').textContent = 'Reviewing the measured movement…';
  try {
    const advice = await api(`/api/results/${id}/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (current?.id === id) {
      current.advice = advice;
      $('advice').textContent = advice.text;
      $('generate-advice').textContent = 'Advice saved';
    }
  } catch (e) {
    if (current?.id === id) $('advice').textContent = e.message;
  } finally {
    busy = false;
    $('generate-advice').disabled = !available || !current || !!current.advice;
  }
};
$('chat-form').onsubmit = async (event) => {
  event.preventDefault();
  const message = $('chat-input').value.trim();
  if (!current || !available || chatBusy || !message) return;
  const id = current.id;
  chatBusy = true;
  chatControls();
  $('chat-status').textContent = 'Coach is replying…';
  try {
    const chat = await api(`/api/results/${id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    drafts.delete(id);
    if (current?.id === id) {
      current.chat = chat;
      renderChat();
      $('chat-input').value = '';
      $('chat-status').textContent = 'Conversation saved.';
    }
  } catch (e) {
    if (current?.id === id) $('chat-status').textContent = e.message;
  } finally {
    chatBusy = false;
    chatControls();
  }
};
async function init() {
  try {
    const [config, list] = await Promise.all([api('/api/config'), api('/api/results')]);
    available = config.llm_configured;
    $('llm-status').textContent = available
      ? `Advice and chat send your messages, derived stats and sampled landmarks to ${config.provider}. Videos stay local.`
      : 'LLM not connected. Configure GEMINI_API_KEY or OPENAI_API_KEY in .env and restart the local server.';
    if (!list.results.length) {
      $('library-message').textContent = 'Recordings will appear here after you press Stop.';
      return;
    }
    $('recording-list').replaceChildren();
    for (const record of list.results) {
      const option = document.createElement('option');
      option.value = record.id;
      option.textContent =
        new Date(record.created_at).toLocaleString() +
        ` · ${record.metrics.duration_s.toFixed(1)}s`;
      $('recording-list').append(option);
    }
    $('recording-list').disabled = false;
    const requested = new URLSearchParams(location.search).get('id');
    const id = list.results.some((r) => r.id === requested) ? requested : list.results[0].id;
    $('recording-list').value = id;
    await show(id);
  } catch (e) {
    $('library-message').textContent = 'Could not load local results: ' + e.message;
  }
}
init();
