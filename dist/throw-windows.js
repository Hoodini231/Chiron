// Throw windows are reviewable motion heuristics, never measured release events.
export const ANALYSIS_FPS = 30;
export const SCAN_FPS = 15;
const round = n => Math.round(n * 1e6) / 1e6;
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= .6 && (p.presence ?? 1) >= .5;
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

function arm(sample, side, width, height) {
  const ids = side === 'left' ? [11,13,15,23] : [12,14,16,24];
  const points = ids.map(i => sample.pose?.[i]);
  if (!points.every(valid)) return null;
  const [shoulder,elbow,wrist,hip] = points.map(p => ({x:p.x*width,y:p.y*height}));
  const scale = dist(shoulder,hip);
  if (scale < Math.hypot(width,height)*.04) return null;
  const a = dist(shoulder,elbow), b = dist(wrist,elbow);
  if (a*b < 1) return null;
  const angle = Math.acos(Math.max(-1,Math.min(1,((shoulder.x-elbow.x)*(wrist.x-elbow.x)+(shoulder.y-elbow.y)*(wrist.y-elbow.y))/(a*b))))*180/Math.PI;
  return {x:(wrist.x-shoulder.x)/scale,y:(wrist.y-shoulder.y)/scale,angle};
}

export function detectThrowWindows(samples, duration, width, height) {
  const events = [];
  for (const side of ['left','right']) {
    const measured = samples.map(s => arm(s,side,width,height));
    // Bridge at most 0.2 s for window estimation only; exported landmarks stay observed/missing.
    const bridged=measured.map((p,i)=>{
      if(p)return p;
      let a=i-1,b=i+1;
      while(a>=0&&!measured[a])a--;
      while(b<measured.length&&!measured[b])b++;
      if(a<0||b>=measured.length||samples[b].t_s-samples[a].t_s>.21)return null;
      const mix=(samples[i].t_s-samples[a].t_s)/(samples[b].t_s-samples[a].t_s);
      return Object.fromEntries(['x','y','angle'].map(k=>[k,measured[a][k]+mix*(measured[b][k]-measured[a][k])]));
    });
    const points=bridged.map((p,i)=>{
      if(!p||!bridged[i-1]||!bridged[i+1])return p;
      return Object.fromEntries(['x','y','angle'].map(k=>[k,[bridged[i-1][k],p[k],bridged[i+1][k]].sort((a,b)=>a-b)[1]]));
    });
    const speeds = samples.map((s,i) => {
      const dt = i ? s.t_s-samples[i-1].t_s : 0;
      return points[i] && points[i-1] && dt>0 && dt<=.21 ? dist(points[i],points[i-1])/dt : null;
    });
    // Two supporting observations suppress single-frame landmark jumps.
    const smooth = speeds.map((v,i) => v === null ? 0 : Math.min(v, Math.max(speeds[i-1]??0,speeds[i+1]??0)));
    for (let i=1;i<samples.length;i++) {
      if (smooth[i]<2 || smooth[i]<(smooth[i-1]??0) || smooth[i]<=(smooth[i+1]??0)) continue;
      const t = samples[i].t_s;
      const local = points.filter((p,j) => p && Math.abs(samples[j].t_s-t)<=.4);
      if (local.length<3) continue;
      const angleRange = Math.max(...local.map(p=>p.angle))-Math.min(...local.map(p=>p.angle));
      const excursion = Math.max(...local.map(p=>dist(p,points[i])));
      const nearby = samples.filter(s => Math.abs(s.t_s-t)<=.45 && s.ball?.observed !== false && s.ball);
      const supported = nearby.some((s,j) => s.ball.tracking_phase==='flight' && nearby.slice(0,j).some(before => before.ball.tracking_phase==='near_hand' && before.ball.track_id===s.ball.track_id && (!before.ball.hand_side || before.ball.hand_side===side)));
      if (!supported && (angleRange<30 || excursion<.55)) continue;
      let start=i, end=i;
      while(start>0 && t-samples[start-1].t_s<=2.5) {
        if (!points[start-1] || (smooth[start-1]<.45 && (smooth[start-2]??0)<.45 && (smooth[start-3]??0)<.45)) break;
        start--;
      }
      while(end+1<samples.length && samples[end+1].t_s-t<=1.5) {
        if (!points[end+1] || (smooth[end+1]<.45 && (smooth[end+2]??0)<.45 && (smooth[end+3]??0)<.45)) break;
        end++;
      }
      events.push({start_s:round(Math.max(0,samples[start].t_s-.25)),end_s:round(Math.min(duration,samples[end].t_s+1/SCAN_FPS+.25)),peak_s:t,side,confidence:supported?'ball_supported':'pose_only',strength:smooth[i]});
    }
  }
  // Suppress opposite-arm and adjacent peaks from the same motion.
  const peaks = [];
  for (const event of events.sort((a,b)=>b.strength-a.strength)) {
    if (!peaks.some(p=>Math.abs(p.peak_s-event.peak_s)<.65)) peaks.push(event);
  }
  const windows = [];
  for (const event of peaks.sort((a,b)=>a.start_s-b.start_s)) {
    const previous = windows.at(-1);
    if(previous && event.start_s<=previous.end_s) {
      previous.end_s=Math.max(previous.end_s,event.end_s);
      previous.estimates.push(event);
    } else windows.push({start_s:event.start_s,end_s:event.end_s,edited:false,estimates:[event]});
  }
  return windows;
}

export function validateWindows(windows, duration) {
  if (!windows.length) throw new Error('Add at least one throw window.');
  const sorted = windows.map(w=>({...w})).sort((a,b)=>a.start_s-b.start_s);
  for(let i=0;i<sorted.length;i++) {
    const w=sorted[i];
    if(!Number.isFinite(w.start_s)||!Number.isFinite(w.end_s)||w.start_s<0||w.end_s>duration||w.end_s-w.start_s<1/ANALYSIS_FPS-1e-6) throw new Error('Each window must be inside the video and at least one analysis frame long.');
    if(i && w.start_s<sorted[i-1].end_s-1e-6) throw new Error('Throw windows overlap. Adjust their start or end times.');
  }
  return sorted;
}

export function buildTimeline(windows, duration) {
  let output=0, index=0;
  const frames=[], segments=[];
  for(const [i,w] of validateWindows(windows,duration).entries()) {
    const length=w.end_s-w.start_s, start=output;
    const estimates=(w.estimates??[]).map(e=>({source_start_s:e.start_s,source_end_s:e.end_s,source_peak_s:e.peak_s,output_peak_s:e.peak_s>=w.start_s&&e.peak_s<w.end_s?round(start+e.peak_s-w.start_s):null,side:e.side,confidence:e.confidence}));
    const segment={id:i+1,source_start_s:w.start_s,source_end_s:w.end_s,output_start_s:round(start),output_end_s:round(start+length),source_start_analysis_frame:Math.floor(w.start_s*ANALYSIS_FPS),source_end_analysis_frame_exclusive:Math.ceil(w.end_s*ANALYSIS_FPS),edited:w.edited??false,estimates};
    segments.push(segment);
    for(let f=0;f/ANALYSIS_FPS<length-1e-8;f++) {
      const offset=f/ANALYSIS_FPS;
      frames.push({frame_index:index++,throw_id:i+1,t_s:round(start+offset),source_media_time_s:round(w.start_s+offset),source_analysis_frame:Math.floor((w.start_s+offset)*ANALYSIS_FPS+1e-6),duration_s:round(Math.min(1/ANALYSIS_FPS,length-offset))});
    }
    output+=length;
  }
  return {frames,segments,duration_s:round(output)};
}
