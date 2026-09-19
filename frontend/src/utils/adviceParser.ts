export interface AdviceSub {
  label: string;
  text: string;
}

export interface AdvicePhase {
  title: string;
  subs: AdviceSub[];
  coachingNote: string;
  status: 'good' | 'improve' | 'limited';
}

export interface AdvicePriority {
  title: string;
  detail: string;
}

export interface ParsedAdvice {
  overview: string;
  phases: AdvicePhase[];
  priorities: AdvicePriority[];
  limits: string;
}

export interface ParsedCoachingNote {
  note: string;
  drill: string;
  cue: string;
}

export interface ExtractedStat {
  label: string;
  value: string;
}

export function parseAdvice(text: string): ParsedAdvice {
  const result: ParsedAdvice = {
    overview: '',
    phases: [],
    priorities: [],
    limits: '',
  };
  const sections: { title: string; pos: number; len: number }[] = [];
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

function parsePhase(title: string, rawBody: string): AdvicePhase {
  let body = rawBody;
  let coachingNote = '';
  const noteRe = /Coaching note:\s*([\s\S]*?)$/i;
  const noteMatch = body.match(noteRe);
  if (noteMatch) {
    coachingNote = noteMatch[1].trim();
    body = body.substring(0, noteMatch.index).trim();
  } else {
    const lastSub = body.lastIndexOf('\n');
    if (lastSub > 0) {
      const tail = body.substring(lastSub).trim();
      if (/^(Verdict|Drill|Cue):/i.test(tail)) {
        coachingNote = tail;
        body = body.substring(0, lastSub).trim();
      }
    }
  }

  const subs: AdviceSub[] = [];
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
          subs.push({
            label: dashSplit[1].trim(),
            text: dashSplit[2].trim(),
          });
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

function parsePriorities(body: string): AdvicePriority[] {
  const items = body.split(/\n(?=Priority:|(?:\d+\.\s))/i).filter(Boolean);
  return items.map((item) => {
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

function detectStatus(note: string, body: string): 'good' | 'improve' | 'limited' {
  const text = (note + ' ' + body).toLowerCase();

  const verdictMatch = text.match(/verdict:\s*(strong|needs?\s*work|insufficient\s*data)/i);
  if (verdictMatch) {
    const v = verdictMatch[1].toLowerCase();
    if (v.includes('insufficient')) return 'limited';
    if (v.includes('need')) return 'improve';
    return 'good';
  }

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

export function extractStats(text: string): ExtractedStat[] {
  const stats: ExtractedStat[] = [];
  const seen = new Set<string>();
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

export function parseCoachingNote(text: string): ParsedCoachingNote {
  let note = text;
  let drill = '';
  let cue = '';
  const drillMatch = text.match(/Drill:\s*(.*?)(?=\s*Cue:|$)/is);
  if (drillMatch) drill = drillMatch[1].trim();
  const cueMatch = text.match(/Cue:\s*(.*?)$/is);
  if (cueMatch) cue = cueMatch[1].trim().replace(/^["“]|["”]$/g, '');
  if (drill || cue) {
    note = text
      .replace(/\s*Drill:[\s\S]*$/, '')
      .replace(/\s*Cue:[\s\S]*$/, '')
      .trim();
  }
  return { note, drill, cue };
}
