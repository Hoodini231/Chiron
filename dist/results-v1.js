const $ = (id) => document.getElementById(id);
const FRAME_DUR = 1 / 30;
let current = null,
  available = false,
  busy = false,
  chatBusy = false,
  loadToken = 0;

async function api(url, options) {
  const r = await fetch(url, options);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;

function formatTime(s) {
  if (!Number.isFinite(s)) return '0:00.0';
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

// ── Advice parser ──

function parseAdvice(text) {
  const result = { overview: '', phases: [], priorities: [], limits: '' };
  const sections = [];
  // Match "TITLE:" or "1. TITLE" at start of line (all caps, with optional colon)
  const headerRe = /^(?:\d+\.\s+)?([A-Z][A-Z\s\d\-]+?)\s*:?\s*$/gm;
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    const title = m[1].trim();
    if (title.length < 3 || title.length > 40) continue;
    sections.push({ title, pos: m.index, len: m[0].length });
  }
  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].pos + sections[i].len;
    const end = i + 1 < sections.length ? sections[i + 1].pos : text.length;
    const body = text.substring(start, end).trim();
    const title = sections[i].title.toUpperCase();

    if (title === 'OVERVIEW') {
      result.overview = body;
    } else if (title.includes('PRIORITIES') || title.includes('TOP 3')) {
      result.priorities = parsePriorities(body);
    } else if (title === 'LIMITS') {
      result.limits = body;
    } else if (title.includes('CONSISTENCY')) {
      result.phases.push({
        title: 'Throw Consistency',
        subs: [{ label: '', text: body }],
        coachingNote: '',
        status: 'limited',
      });
    } else {
      result.phases.push(parsePhase(sections[i].title, body));
    }
  }
  return result;
}

function parsePhase(title, body) {
  let coachingNote = '';
  const noteRe = /Coaching note:\s*([\s\S]*?)$/i;
  const noteMatch = body.match(noteRe);
  if (noteMatch) {
    coachingNote = noteMatch[1].trim();
    body = body.substring(0, noteMatch.index).trim();
  } else {
    // Try extracting everything after the last sub-section as the coaching note
    const lastSub = body.lastIndexOf('\n');
    if (lastSub > 0) {
      const tail = body.substring(lastSub).trim();
      if (/^(Verdict|Drill|Cue):/i.test(tail)) {
        coachingNote = tail;
        body = body.substring(0, lastSub).trim();
      }
    }
  }

  const subs = [];
  const parts = body.split(/\n(?=[a-d]\)\s)/i);
  for (const part of parts) {
    const sub = part.match(/^([a-d])\)\s*(.+?)\s*[—–\-]+\s*([\s\S]*)/i);
    if (sub) {
      subs.push({ label: sub[2].trim(), text: sub[3].trim() });
    } else if (part.trim()) {
      const labeled = part.match(/^([a-d])\)\s*([\s\S]*)/i);
      if (labeled) {
        const txt = labeled[2].trim();
        const dashSplit = txt.match(/^(.+?)\n([\s\S]*)/);
        if (dashSplit) {
          subs.push({ label: dashSplit[1].trim(), text: dashSplit[2].trim() });
        } else {
          subs.push({ label: '', text: txt });
        }
      } else {
        subs.push({ label: '', text: part.trim() });
      }
    }
  }

  const status = detectStatus(coachingNote, body);
  return { title, subs, coachingNote, status };
}

function parsePriorities(body) {
  // Split on "Priority:" lines or numbered items
  const items = body.split(/\n(?=Priority:|(?:\d+\.\s))/i).filter(Boolean);
  return items.map((item) => {
    // New format: Priority: / Issue: / Drill: / Cue:
    const titleMatch = item.match(/Priority:\s*(.+)/i);
    const issueMatch = item.match(/Issue:\s*(.+)/i);
    const drillMatch = item.match(/Drill:\s*(.+)/i);
    const cueMatch = item.match(/Cue:\s*(.+)/i);

    if (titleMatch) {
      let detail = '';
      if (issueMatch) detail += issueMatch[1].trim();
      if (drillMatch) detail += (detail ? ' ' : '') + 'Drill: ' + drillMatch[1].trim();
      if (cueMatch) detail += (detail ? ' ' : '') + 'Cue: ' + cueMatch[1].trim();
      return { title: titleMatch[1].trim(), detail };
    }

    // Fallback: old "1. Title: detail" format
    const m = item.match(/^\d+\.\s+([\s\S]*)/);
    if (!m) return { title: item.trim(), detail: '' };
    const full = m[1].trim();
    const colonMatch = full.match(/^(.+?)[:\.]\s*(.*)/s);
    if (colonMatch) {
      return { title: colonMatch[1].trim(), detail: colonMatch[2].trim() };
    }
    return { title: full.split('\n')[0].trim(), detail: full };
  });
}

function detectStatus(note, body) {
  const text = (note + ' ' + body).toLowerCase();

  // Explicit verdict from LLM
  const verdictMatch = text.match(/verdict:\s*(strong|needs?\s*work|insufficient\s*data)/i);
  if (verdictMatch) {
    const v = verdictMatch[1].toLowerCase();
    if (v.includes('insufficient')) return 'limited';
    if (v.includes('need')) return 'improve';
    return 'good';
  }

  // Fallback heuristic — biased toward critical
  if (/insufficient|cannot be assessed|only one|cannot assess|no clear|sparse/.test(text))
    return 'limited';
  if (
    /needs? work|improve|issue|problem|not enough|limited|abrupt|missing|not smooth|not consistently|minimal|poor|lacking|weak|no (?:clear|meaningful|significant)|arm.dominant|upper.body.dominant|doesn.t|does not|isn.t|little|stiff|early|late|skip/.test(
      text,
    )
  )
    return 'improve';
  return 'good';
}

function extractStats(text) {
  const stats = [];
  const seen = new Set();
  for (const m of text.matchAll(
    /(?:at|by|around|between)\s+(\d+\.?\d*)\s*s(?:\s*(?:to|and)\s+(\d+\.?\d*)\s*s)?/g,
  )) {
    const key = m[1] + 's';
    if (!seen.has(key)) {
      seen.add(key);
      stats.push({ label: 'Time', value: key });
    }
    if (m[2] && !seen.has(m[2] + 's')) {
      seen.add(m[2] + 's');
      stats.push({ label: 'Time', value: m[2] + 's' });
    }
  }
  for (const m of text.matchAll(/(-?\d+\.?\d*)\s*degrees/g)) {
    const key = m[1] + '°';
    if (!seen.has(key)) {
      seen.add(key);
      stats.push({ label: 'Angle', value: key });
    }
  }
  return stats;
}

function parseCoachingNote(text) {
  let note = text,
    drill = '',
    cue = '';
  const drillMatch = text.match(/Drill:\s*(.*?)(?=\s*Cue:|$)/is);
  if (drillMatch) drill = drillMatch[1].trim();
  const cueMatch = text.match(/Cue:\s*(.*?)$/is);
  if (cueMatch) cue = cueMatch[1].trim().replace(/^[""]|[""]$/g, '');
  if (drill || cue) {
    note = text
      .replace(/\s*Drill:[\s\S]*$/, '')
      .replace(/\s*Cue:[\s\S]*$/, '')
      .trim();
  }
  return { note, drill, cue };
}

// ── Rendering ──

function badgeFor(status) {
  return status === 'good' ? 'Strong' : status === 'improve' ? 'Needs work' : 'Insufficient data';
}

function colorFor(status) {
  return status === 'good' ? 'var(--green)' : status === 'improve' ? 'var(--red)' : 'var(--yellow)';
}

function classFor(status) {
  return status === 'good' ? 'green' : status === 'improve' ? 'red' : 'yellow';
}

function renderScorePills(phases) {
  const c = $('score-pills');
  c.innerHTML = '';
  for (const phase of phases) {
    const summary = (phase.subs[0]?.text || phase.coachingNote || '').split(/[.!]\s/)[0] + '.';
    const cue = phase.coachingNote ? phase.coachingNote.split(/[.!]\s/)[0] + '.' : '';
    const cls = phase.status;
    c.innerHTML +=
      `<div class="category ${cls}">` +
      `<div class="indicator"></div>` +
      `<div class="cat-body">` +
      `<div class="cat-title">${esc(phase.title)} <span class="badge">${badgeFor(phase.status)}</span></div>` +
      `<div class="cat-summary">${esc(summary)}</div>` +
      (cue ? `<div class="cat-cue">${esc(cue)}</div>` : '') +
      `</div></div>`;
  }
}

function renderPriorities(priorities) {
  const c = $('priorities');
  c.innerHTML = '';
  for (let i = 0; i < Math.min(priorities.length, 3); i++) {
    const p = priorities[i];
    c.innerHTML +=
      `<div class="priority-card">` +
      `<div class="priority-num">#${i + 1} PRIORITY</div>` +
      `<div class="priority-title">${esc(p.title)}</div>` +
      `<div class="priority-drill">${esc(p.detail)}</div>` +
      `</div>`;
  }
}

function renderBreakdown(advice) {
  const c = $('coaching-breakdown');
  c.innerHTML = '';

  if (advice.overview) {
    c.innerHTML +=
      `<div class="sub-card" style="grid-column:1/-1">` +
      `<div class="sub-card-title">Overview</div>` +
      `<p>${esc(advice.overview)}</p></div>`;
  }

  for (const phase of advice.phases) {
    const col = colorFor(phase.status);
    const cls = classFor(phase.status);

    c.innerHTML +=
      `<div class="phase-group-header">` +
      `<span class="indicator" style="background:${col}"></span> ${esc(phase.title)} ` +
      `<span class="badge" style="background:var(--${cls}-bg);color:var(--${cls});border:1px solid var(--${cls}-border);font-size:10px;padding:2px 6px;border-radius:4px">${badgeFor(phase.status)}</span>` +
      `</div>`;

    for (const sub of phase.subs) {
      let html =
        `<div class="sub-card">` +
        (sub.label ? `<div class="sub-card-title">${esc(sub.label)}</div>` : '') +
        `<p>${esc(sub.text)}</p>`;

      const stats = extractStats(sub.text);
      if (stats.length) {
        html += '<div class="phase-stats">';
        for (const s of stats)
          html += `<div><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></div>`;
        html += '</div>';
      }
      html += '</div>';
      c.innerHTML += html;
    }

    if (phase.coachingNote) {
      const tipCls =
        phase.status === 'good'
          ? 'good-tip'
          : phase.status === 'improve'
            ? 'improve-tip'
            : 'limited-tip';
      const parts = parseCoachingNote(phase.coachingNote);
      if (parts.note) {
        c.innerHTML +=
          `<div class="coaching-tip-card ${tipCls}">` +
          `<div class="tip-label">Coaching note</div>` +
          `${esc(parts.note)}</div>`;
      }
      if (parts.drill) {
        c.innerHTML +=
          `<div class="coaching-tip-card ${tipCls}">` +
          `<div class="tip-label">Drill</div>` +
          `${esc(parts.drill)}</div>`;
      }
      if (parts.cue) {
        c.innerHTML +=
          `<div class="coaching-tip-card ${tipCls}">` +
          `<div class="tip-label">Cue</div>` +
          `${esc(parts.cue)}</div>`;
      }
    }
  }

  const duration = current?.metrics?.duration_s;
  const timeline = renderTimeline(advice.phases, duration);
  if (timeline) c.innerHTML += timeline;
}

function renderTimeline(phases, duration) {
  if (!duration || phases.length < 2) return '';
  const timesByPhase = [];
  for (const phase of phases) {
    const allText = phase.subs.map((s) => s.text).join(' ') + ' ' + phase.coachingNote;
    const times = [];
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
  if (timesByPhase.length < 2) return '';

  let html =
    `<div class="card phase-card" style="grid-column:1/-1">` +
    `<div class="phase-header" style="color:var(--accent)"><span class="indicator" style="width:8px;height:8px;border-radius:50%;background:var(--accent)"></span> Release Timeline</div>` +
    `<div class="timeline-bar">`;
  for (const p of timesByPhase) {
    const dur = Math.max(0.1, p.max - p.min);
    const cls = p.title.toLowerCase().includes('load')
      ? 'tl-load'
      : p.title.toLowerCase().includes('release')
        ? 'tl-release'
        : 'tl-follow';
    html += `<div class="tl-phase ${cls}" style="flex:${dur.toFixed(1)}"><span class="tl-label">${esc(p.title.replace(' PHASE', ''))}</span><span class="tl-time">${dur.toFixed(1)}s</span></div>`;
  }
  html += `</div>`;

  html += `<div class="phase-stats" style="margin-top:8px">`;
  html += `<div><span>Total duration</span><strong>${duration.toFixed(1)}s</strong></div>`;
  for (const p of timesByPhase) {
    const dur = (p.max - p.min).toFixed(1);
    html += `<div><span>${esc(p.title.replace(' PHASE', ''))}</span><strong>${dur}s</strong></div>`;
  }
  for (const p of timesByPhase) {
    html += `<div><span>${esc(p.title.replace(' PHASE', ''))} window</span><strong>${p.min.toFixed(1)}–${p.max.toFixed(1)}s</strong></div>`;
  }
  html += `</div></div>`;
  return html;
}

function renderAdvice(text, provider, model) {
  const advice = parseAdvice(text);
  $('score-empty').hidden = true;
  $('score-content').hidden = false;
  $('score-header-provider').textContent = `powered by ${provider} ${model}`;
  renderScorePills(advice.phases);
  renderPriorities(advice.priorities);
  renderBreakdown(advice);
  $('limits-text').textContent = advice.limits || 'No specific limitations noted.';
}

// ── Pipeline data ──

function renderPipeline(record) {
  const c = $('pipeline-inner');
  c.innerHTML = '';
  const m = record.metrics;
  const rpt = record.report || {};
  const trk = rpt.tracking || {};
  const cap = rpt.capture || {};
  const cs = rpt.coordinate_system || {};
  const samples = rpt.samples || [];

  function section(title) {
    return `<div class="drawer-section-title">${title}</div>`;
  }
  function card(label, value, sub) {
    return (
      `<div class="card"><div class="card-label">${label}</div>` +
      `<div class="card-value">${value}</div>` +
      (sub ? `<div class="card-sub">${sub}</div>` : '') +
      `</div>`
    );
  }
  function barCard(label, value, fraction, sub) {
    return (
      `<div class="card"><div class="card-label">${label}</div>` +
      `<div class="card-value" style="color:var(--accent)">${value}</div>` +
      `<div class="stat-bar"><div class="fill" style="width:${Math.round(fraction * 100)}%"></div></div>` +
      (sub ? `<div class="card-sub">${sub}</div>` : '') +
      `</div>`
    );
  }

  let html = '';

  html += section('Capture');
  html += '<div class="dashboard">';
  html += card('Duration', `${m.duration_s?.toFixed(1) ?? '—'}s`, `${m.processed_frames} frames`);
  html += card('Processed FPS', m.processed_fps?.toFixed(1) ?? '—', `Requested 60 fps`);
  html += card(
    'Source',
    esc(cap.source || 'unknown'),
    cs.width ? `${cs.width} × ${cs.height}` : '',
  );
  html += card('Timestamp', 'requestVideoFrameCallback', 'Frame-accurate');
  html += '</div>';

  html += section('Detection rates');
  html += '<div class="dashboard">';
  const bf = m.ball_detection_fraction ?? 0;
  const pf = m.pose_detection_fraction ?? 0;
  const hf = m.hand_detection_fraction ?? 0;
  const frames = m.processed_frames || 0;
  html += barCard('Ball visible', pct(bf), bf, `${Math.round(bf * frames)} of ${frames} frames`);
  html += barCard('Body detected', pct(pf), pf, `${Math.round(pf * frames)} of ${frames} frames`);
  html += barCard('Hands detected', pct(hf), hf, `${Math.round(hf * frames)} of ${frames} frames`);
  html += card('Dominant hand', dominantHand(samples), 'Ball–wrist association');
  html += '</div>';

  html += section('Hip-shoulder separation & rotation');
  html += '<div class="dashboard">';
  const sep = m.projected_angles_deg?.hip_shoulder_separation_deg;
  html += card(
    'Hip-shoulder separation',
    sep ? `${Math.round(sep.min)}° to ${Math.round(sep.max)}°` : '—',
    sep
      ? `Peak separation ${Math.round(Math.max(Math.abs(sep.min), Math.abs(sep.max)))}° · ${sep.observations} frames`
      : 'No data',
  );
  const shoulderVel = m.shoulder_rotation_velocity_deg_s;
  html += card(
    'Torso rotation velocity',
    shoulderVel ? `${Math.round(shoulderVel.peak)}°/s` : '—',
    shoulderVel ? `Peak · mean ${Math.round(shoulderVel.mean)}°/s` : 'No data',
  );
  const hipVel = m.hip_rotation_velocity_deg_s;
  html += card(
    'Pelvic rotation velocity',
    hipVel ? `${Math.round(hipVel.peak)}°/s` : '—',
    hipVel ? `Peak · mean ${Math.round(hipVel.mean)}°/s` : 'No data',
  );
  const shoulderLine = m.projected_angles_deg?.shoulder_line_deg;
  const hipLine = m.projected_angles_deg?.hip_line_deg;
  html += card(
    'Shoulder line range',
    shoulderLine ? `${Math.round(shoulderLine.min)}° to ${Math.round(shoulderLine.max)}°` : '—',
    shoulderLine ? `${shoulderLine.observations} frames` : 'No data',
  );
  html += card(
    'Hip line range',
    hipLine ? `${Math.round(hipLine.min)}° to ${Math.round(hipLine.max)}°` : '—',
    hipLine ? `${hipLine.observations} frames` : 'No data',
  );
  if (hipVel && shoulderVel) {
    const leads = hipVel.peak > shoulderVel.peak ? 'Pelvis leads' : 'Torso leads';
    html += card(
      'Rotation sequence',
      leads,
      `Pelvis peak ${Math.round(hipVel.peak)}°/s · Torso peak ${Math.round(shoulderVel.peak)}°/s`,
    );
  }
  html += '</div>';

  html += section('Ball tracking');
  html += '<div class="dashboard">';
  html += `<div class="card" style="grid-column:span 2"><div class="card-label">Ball trajectory</div><canvas class="path-canvas" id="pipeline-trajectory" width="500" height="80"></canvas></div>`;
  html += card(
    'Method',
    shortMethod(trk.method),
    `Hue ${trk.hue ?? '—'} · tol ${trk.tolerance ?? '—'}`,
  );
  html += card('Ball colour', formatColour(trk), 'Core + broad + shape + saturated');
  const ms = meanBallScore(samples);
  html += card('Mean score', ms !== null ? ms.toFixed(2) : '—', 'Heuristic');
  const blur = samples.filter((s) => s.ball?.motion_blur_candidate).length;
  html += card('Motion blur', `${blur} frames`, 'Near release');
  html += '</div>';

  html += section('Not yet measured');
  html += '<div class="dashboard">';
  for (const label of ['Ball speed', 'Time to load', 'Time to release', 'Ball spin'])
    html += `<div class="card placeholder-card"><div class="card-label">${label}</div><div class="card-value placeholder-value">—</div></div>`;
  html += '</div>';

  const lims = rpt.limitations || [];
  if (lims.length) {
    html += section('Limitations');
    html +=
      '<div class="dashboard"><div class="card" style="grid-column:span 3"><ul class="limits-list">';
    for (const l of lims) html += `<li>${esc(l)}</li>`;
    html += '</ul></div></div>';
  }

  html += section('Downloads');
  html +=
    `<div class="downloads-row">` +
    `<a class="download-link" href="/results/${esc(record.id)}/data.json" download>Pipeline JSON</a>` +
    `<a class="download-link" href="/results/${esc(record.id)}/${esc(record.original)}">Original video</a>` +
    `<a class="download-link" href="/results/${esc(record.id)}/${esc(record.processed)}">Processed video</a>` +
    `</div>`;

  c.innerHTML = html;

  if (cs.width && cs.height) {
    requestAnimationFrame(() => drawTrajectory('pipeline-trajectory', samples, cs));
  }
}

function drawTrajectory(id, samples, cs) {
  const canvas = $(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#c5f36b';
  ctx.lineWidth = 2;
  const scale = Math.min((canvas.width - 20) / cs.width, (canvas.height - 20) / cs.height);
  const ox = (canvas.width - cs.width * scale) / 2;
  const oy = (canvas.height - cs.height * scale) / 2;
  let prev = null;
  for (const s of samples) {
    if (!s.ball) {
      prev = null;
      continue;
    }
    const x = ox + s.ball.x_px * scale;
    const y = oy + s.ball.y_px * scale;
    ctx.beginPath();
    if (prev && s.t_s - prev.t < 0.12 && prev.tid === s.ball.track_id) {
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#c5f36b';
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    prev = { x, y, t: s.t_s, tid: s.ball.track_id };
  }
}

function dominantHand(samples) {
  let l = 0,
    r = 0;
  for (const s of samples)
    for (const h of s.hands || []) {
      if (h.associated_pose_side === 'left') l++;
      else if (h.associated_pose_side === 'right') r++;
    }
  return l === 0 && r === 0 ? '—' : r >= l ? 'Right' : 'Left';
}

function meanBallScore(samples) {
  let sum = 0,
    n = 0;
  for (const s of samples)
    if (s.ball?.tracking_score != null) {
      sum += s.ball.tracking_score;
      n++;
    }
  return n > 0 ? sum / n : null;
}

function shortMethod(m) {
  return m
    ? m
        .replace(/_/g, ' ')
        .replace('opencv colour segmentation and validated circle edges', 'Colour + circle edges')
    : '—';
}

function formatColour(t) {
  if (t.colour && t.colour !== 'sampled')
    return t.colour.charAt(0).toUpperCase() + t.colour.slice(1);
  if (t.hue != null) return 'HSV hue ' + t.hue;
  return '—';
}

// ── Chat ──

function renderChat(chat) {
  const c = $('chat-messages');
  c.innerHTML = '';
  for (const msg of chat?.messages || []) {
    c.innerHTML +=
      `<div class="chat-msg ${msg.role === 'user' ? 'user' : 'coach'}">` +
      `<span class="msg-label">${msg.role === 'user' ? 'You' : 'Coach'}</span>` +
      `${esc(msg.text)}</div>`;
  }
  c.scrollTop = c.scrollHeight;
}

// ── Video crop from wireframe ──

function cropVideoToWireframe(samples) {
  const v = $('result-video');
  if (!v) return;
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
  if (count < 10) return;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pad = 0.15;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const zoom = Math.min(2, Math.max(1.05, 1 / Math.max(bw, bh)));
  const clamp = (val) => Math.max(0, Math.min(100, val));

  v.style.objectFit = 'cover';
  v.style.objectPosition = `${clamp(cx * 100)}% ${clamp(cy * 100)}%`;
  v.style.transform = `scale(${zoom.toFixed(2)})`;
  v.style.transformOrigin = `${clamp(cx * 100)}% ${clamp(cy * 100)}%`;
}

// ── Main ──

async function show(id) {
  const token = ++loadToken;
  current = null;
  $('score-empty').hidden = false;
  $('score-content').hidden = true;
  $('score-pills').innerHTML = '';
  try {
    const record = await api('/api/results/' + encodeURIComponent(id));
    if (token !== loadToken) return;
    current = record;
    history.replaceState(null, '', 'results-v1.html?id=' + id);

    $('result-video').src = `/results/${id}/${record.processed}`;
    $('original-link').href = `/results/${id}/${record.original}`;
    cropVideoToWireframe(record.report?.samples || []);

    const m = record.metrics;
    $('video-meta').textContent =
      `${m.duration_s.toFixed(1)}s · ${m.processed_frames} frames · ${m.processed_fps?.toFixed(1) ?? '—'} fps`;

    if (record.advice) {
      $('no-advice-section').hidden = true;
      $('advice-content').hidden = false;
      renderAdvice(record.advice.text, record.advice.provider, record.advice.model);
      renderChat(record.chat);
    } else {
      $('no-advice-section').hidden = false;
      $('advice-content').hidden = true;
      $('generate-advice').disabled = !available;
      $('generate-advice').textContent = 'Get coaching advice';
    }
    renderPipeline(record);
  } catch (e) {
    if (token !== loadToken) return;
    $('no-advice-section').hidden = false;
    $('no-advice-section').querySelector('p').textContent = e.message;
  }
}

async function init() {
  try {
    const [config, list] = await Promise.all([api('/api/config'), api('/api/results')]);
    available = config.llm_configured;

    if (!list.results.length) {
      $('no-advice-section').hidden = false;
      $('no-advice-section').querySelector('p').textContent =
        'No recordings yet. Record a throw first.';
      $('generate-advice').disabled = true;
      return;
    }

    const select = $('recording-select');
    select.innerHTML = '';
    for (const r of list.results) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent =
        new Date(r.created_at).toLocaleString() + ' · ' + r.metrics.duration_s.toFixed(1) + 's';
      select.appendChild(o);
    }
    select.disabled = false;
    select.onchange = () => show(select.value);

    const requested = new URLSearchParams(location.search).get('id');
    const id = list.results.some((r) => r.id === requested) ? requested : list.results[0].id;
    select.value = id;
    await show(id);
  } catch (e) {
    $('no-advice-section').hidden = false;
    $('no-advice-section').querySelector('p').textContent = 'Could not load: ' + e.message;
  }
}

// ── Playback ──

function initPlayback() {
  const v = $('result-video');
  if (!v) return;
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
    } else if (e.code === 'ArrowLeft' && e.shiftKey) v.currentTime = Math.max(0, v.currentTime - 5);
    else if (e.code === 'ArrowRight' && e.shiftKey)
      v.currentTime = Math.min(v.duration, v.currentTime + 5);
    else if (e.code === 'ArrowLeft') {
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

// ── Events ──

$('generate-advice').onclick = async () => {
  if (!current || busy || !available) return;
  busy = true;
  $('generate-advice').disabled = true;
  $('generate-advice').textContent = 'Generating advice…';
  try {
    const advice = await api(`/api/results/${current.id}/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    current.advice = advice;
    await show(current.id);
  } catch (e) {
    $('generate-advice').textContent = e.message;
  } finally {
    busy = false;
  }
};

$('regenerate-advice').onclick = async () => {
  if (!current || busy || !available) return;
  busy = true;
  $('regenerate-advice').disabled = true;
  $('regenerate-advice').textContent = 'Regenerating…';
  try {
    const advice = await api(`/api/results/${current.id}/advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: true }),
    });
    current.advice = advice;
    await show(current.id);
  } catch (e) {
    $('regenerate-advice').textContent = e.message;
  } finally {
    busy = false;
    $('regenerate-advice').disabled = false;
    $('regenerate-advice').textContent = 'Regenerate coaching advice';
  }
};

$('chat-send').onclick = sendChat;
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

async function sendChat() {
  const message = $('chat-input').value.trim();
  if (!current || !available || chatBusy || !message) return;
  chatBusy = true;
  $('chat-send').disabled = true;
  $('chat-status').textContent = 'Coach is replying…';
  try {
    const chat = await api(`/api/results/${current.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    current.chat = chat;
    renderChat(chat);
    $('chat-input').value = '';
    $('chat-status').textContent = '';
  } catch (e) {
    $('chat-status').textContent = e.message;
  } finally {
    chatBusy = false;
    $('chat-send').disabled = false;
  }
}

// ── Boot ──
initPlayback();
init();
