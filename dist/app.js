import {BallTracker, PRESETS} from './tracker.js';
import {createPoseTracker, drawPose, LANDMARK_NAMES} from './pose.js';
import {poseFeatures, summarize} from './features.js';
import {createHandTracker, collectHands, drawHands, HAND_NAMES} from './hands.js';
import {handFeatures} from './hand-features.js';
const $ = id => document.getElementById(id);
const video = $('source'), canvas = $('output'), ctx = canvas.getContext('2d');
const small = document.createElement('canvas'), sctx = small.getContext('2d', {willReadFrequently:true});
const rawFrame=document.createElement('canvas'), rawContext=rawFrame.getContext('2d');
const isolatedFrame=document.createElement('canvas');
let tracker, poseTracker, handTracker, stream, ready = false, opening = false, recording = null, picking = false, pendingSave = null;
let config = {colour:'red', hue:0, tolerance:14, saturation:140, isolate:false};
let trail = [], latestTime = 0, lastFrame = -1, lastWall = 0, fps = 0, urls = [], finalizing = false;

function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function controls() {
  const active = !!recording || finalizing || !!pendingSave;
  $('start').disabled = !ready || !stream || active;
  $('stop').disabled = !recording;
  $('enable').disabled = opening;
  $('sample').disabled = !stream || !ready || active;
  document.querySelectorAll('#colours input, input[type=range], #isolate').forEach(e => e.disabled = active);
}
async function loadTracker() {
  try {
    const {cv} = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tracker download timed out. Reload to retry.')), 90000);
      const script = document.createElement('script');
      script.src = './vendor/opencv.js';
      script.onerror = () => {clearTimeout(timeout); reject(new Error('Could not load the ball tracker. Reload to retry.'));};
      script.onload = () => {
        // Emscripten's legacy thenable resolves to itself; never await it directly.
        const loaded = window.cv;
        const finish = runtime => {clearTimeout(timeout); resolve({cv:runtime});};
        try { if (loaded?.Mat) finish(loaded); else if (loaded?.then) loaded.then(finish); else if (loaded) loaded.onRuntimeInitialized = () => finish(loaded); }
        catch(e) {clearTimeout(timeout); reject(e);}
      };
      document.head.append(script);
    });
    tracker = new BallTracker(cv); ready = !!poseTracker && !!handTracker;
    $('ball-state').textContent = 'Ready';
    $('status').textContent = ready ? 'All three pipelines ready. Enable camera to begin.' : 'Loading movement pipelines…';
    controls();
  } catch(e) { error(e.message); $('status').textContent = 'Tracker unavailable'; }
}
async function loadPose() {
  try {
    poseTracker = await createPoseTracker(); ready = !!tracker && !!handTracker;
    $('body-state').textContent = 'Ready';
    $('status').textContent = ready ? 'All three pipelines ready. Enable camera to begin.' : 'Loading remaining pipelines…'; controls();
  } catch(e) {error('Could not load body pose. Reload to retry.'); $('body-state').textContent = 'Unavailable';}
}
async function loadHands(){
  try{handTracker=await createHandTracker();ready=!!tracker&&!!poseTracker;$('hand-state').textContent='Ready';$('status').textContent=ready?'All three pipelines ready. Enable camera to begin.':'Loading remaining pipelines…';controls();}
  catch(e){error('Could not load hand tracking. Reload to retry.');$('hand-state').textContent='Unavailable';}
}
async function enableCamera() {
  if (opening || stream) return;
  opening = true; error(''); controls();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost in a supported browser.');
    const candidate = await navigator.mediaDevices.getUserMedia({audio:false, video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60},facingMode:'environment'}});
    video.srcObject = candidate;
    try { await video.play(); } catch(e) {candidate.getTracks().forEach(t => t.stop()); throw e;}
    stream = candidate; canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    rawFrame.width=canvas.width;rawFrame.height=canvas.height;
    small.width = Math.min(640, canvas.width); small.height = Math.round(canvas.height * small.width / canvas.width);
    $('empty').hidden = true; $('mode').textContent = 'LIVE CAMERA';
    $('status').textContent = ready ? 'Ready. Check the ball marker before recording.' : 'Loading ball tracker…';
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      stopRecording(); stream = null; $('empty').hidden = false; $('mode').textContent = 'CAMERA OFF';
      error('Camera disconnected. Reconnect it and enable the camera again.'); controls();
    });
    lastFrame = -1; scheduleFrame();
  } catch(e) {
    const messages = {NotAllowedError:'Camera access was declined. Allow camera access in your browser, then try again.',NotFoundError:'No camera found. Connect a camera and try again.',NotReadableError:'The camera is busy or unavailable. Close other camera apps and try again.'};
    error(messages[e.name] || e.message);
  } finally { opening = false; controls(); }
}
function scheduleFrame() {
  if (!stream) return;
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
  else requestAnimationFrame(now => frame(now, {mediaTime:video.currentTime}));
}
function frame(now, metadata) {
  if (!stream) return;
  const t = metadata.mediaTime;
  if (lastFrame === t || video.readyState < 2) {scheduleFrame(); return;}
  lastFrame = t; latestTime = t;
  const dt = (now - lastWall) / 1000; lastWall = now;
  if (dt > 0 && dt < 1) fps = fps ? fps * .9 + (1 / dt) * .1 : 1 / dt;
  rawContext.drawImage(video,0,0,rawFrame.width,rawFrame.height);
  ctx.drawImage(rawFrame, 0, 0, canvas.width, canvas.height);
  sctx.drawImage(rawFrame, 0, 0, small.width, small.height);
  let ball = null, pose = null, hands = [];
  if (ready) {
    try {
      pose = poseTracker.detectForVideo(small, now).landmarks[0] ?? null;
      hands = handFeatures(collectHands(handTracker.detectForVideo(rawFrame,now)),pose,canvas.width,canvas.height);
      ball = tracker.detect(small, t, config, {hands, pose, isolationCanvas:config.isolate?isolatedFrame:null});
      if(config.isolate)ctx.drawImage(isolatedFrame,0,0,canvas.width,canvas.height);
    } catch(e) {ready = false; stopRecording(); error('A processing pipeline failed. Reload the page to reset it.'); controls();}
  }
  drawPose(ctx, pose, canvas.width, canvas.height);
  drawHands(ctx,hands,canvas.width,canvas.height);
  $('hand-state').textContent=hands.length?`${hands.length} detected`:ready?'Not visible':handTracker?'Ready':'Loading';
  $('body-state').textContent = pose ? 'Detected' : ready ? 'Not visible' : poseTracker ? 'Ready' : 'Loading';
  if (ball) {
    const scale = canvas.width / small.width;
    ball = {...ball, x:ball.x * scale, y:ball.y * scale, radius:ball.radius * scale};
    if (trail.length && (t - trail[trail.length - 1].t > .12 || trail[trail.length - 1].track_id !== ball.track_id)) trail = [];
    trail.push(ball);
  }
  trail = trail.filter(p => t - p.t < .8);
  ctx.strokeStyle = '#c5f36b'; ctx.lineWidth = Math.max(2, canvas.width / 400);
  ctx.beginPath(); trail.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.stroke();
  if (ball) {
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c5f36b'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  const ballStatus=tracker?.status;
  const prediction=ballStatus?.prediction;
  if (prediction && ready) {
    const scale=canvas.width/small.width;
    ctx.save(); ctx.strokeStyle='#d9a65c'; ctx.setLineDash([6,6]);
    ctx.beginPath(); ctx.arc(prediction.x*scale,prediction.y*scale,prediction.radius*scale+5,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  const phaseLabels={near_hand:'Near hand',flight:'In flight',unassociated:'Detected'};
  $('ball-state').textContent = ball ? phaseLabels[ball.tracking_phase] : ready ? prediction?'Predicted briefly':'Not visible' : 'Waiting';
  $('score').textContent = ball ? ball.score.toFixed(2) : '—'; $('fps').textContent = fps ? Math.round(fps) : '—';
  if (recording) {
    const r = recording;
    if (r.origin === null) r.origin = t;
    const elapsed = t - r.origin;
    const detectorScale=canvas.width/small.width;
    r.samples.push({frame_index:r.samples.length, t_s:+elapsed.toFixed(6), source_media_time_s:t, presented_frame:metadata.presentedFrames ?? null, ball:ball ? {x_px:+ball.x.toFixed(2),y_px:+ball.y.toFixed(2),radius_px:+ball.radius.toFixed(2),tracking_score:+ball.score.toFixed(3),observed:true,track_id:ball.track_id,tracking_phase:ball.tracking_phase,hand_distance_px:ball.hand_distance_px===null?null:+(ball.hand_distance_px*detectorScale).toFixed(2),hand_source:ball.hand_source,hand_side:ball.hand_side,motion_blur_candidate:ball.blurred,colour_mask_source:ball.mask_source} : null,ball_tracking:{state:ballStatus?.state??'searching',phase:ballStatus?.phase??'searching',phase_is_heuristic:true,track_id:ballStatus?.track_id??null},ball_prediction:prediction?{x_px:prediction.x*detectorScale,y_px:prediction.y*detectorScale,radius_px:prediction.radius*detectorScale,age_s:prediction.age_s,observed:false}:null,pose:pose?.map(p=>({x:p.x,y:p.y,z:p.z,visibility:p.visibility,presence:p.presence}))??null,features_2d:poseFeatures(pose,canvas.width,canvas.height),hands});
    const label = `${Math.floor(elapsed / 60).toString().padStart(2,'0')}:${(elapsed % 60).toFixed(1).padStart(4,'0')}`;
    $('elapsed').textContent = label;
    const size = Math.max(16, Math.round(canvas.width / 55));
    ctx.fillStyle = '#101319cf'; ctx.fillRect(12, 12, size * 24, size * 2.1);
    ctx.font = `${size}px monospace`; ctx.fillStyle = '#c5f36b';
    ctx.fillText(`REC ${label} · ${ball ? 'BALL DETECTED' : 'BALL NOT VISIBLE'}`, 24, 12 + size * 1.4);
    r.processedStream.getVideoTracks()[0].requestFrame?.();
    if (performance.now() - r.startWall >= 120000) stopRecording();
  }
  scheduleFrame();
}
function recorderFor(source, chunks) {
  const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4','video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(source, {...(mimeType ? {mimeType} : {}),videoBitsPerSecond:8000000});
  recorder.ondataavailable = e => {if (e.data.size) chunks.push(e.data);};
  return recorder;
}
function startRecording() {
  if (!ready || !stream || recording || finalizing) return;
  error(''); picking = false; canvas.parentElement.classList.remove('sampling');
  let r;
  try {
    if (!window.MediaRecorder || !canvas.captureStream) throw new Error('Recording is unavailable in this browser. Try a current Chrome, Edge or Safari browser.');
    // Keep the established ball identity when recording starts.
    trail = [];
    const processedStream = canvas.captureStream(0);
    if (!processedStream.getVideoTracks()[0].requestFrame) {
      processedStream.getTracks().forEach(t => t.stop());
      throw new Error('This browser cannot capture processed frames reliably. Please use Chrome or Edge.');
    }
    r = {processedStream,chunks:[],rawChunks:[],samples:[],origin:null,startWall:performance.now(),config:{...config},settings:stream.getVideoTracks()[0].getSettings()};
    r.processed = recorderFor(processedStream, r.chunks); r.raw = recorderFor(stream, r.rawChunks);
    r.finished = Promise.all([r.processed,r.raw].map(rec => new Promise(resolve => {
      rec.onstop = resolve; rec.onerror = () => {r.failed = true; error('Recording failed. Start a new clip.'); stopRecording();};
    })));
    recording = r; r.processed.start(1000); r.raw.start(1000);
    r.timer = setTimeout(stopRecording, 120000);
    $('mode').textContent = '● RECORDING'; $('status').textContent = 'Recording body + ball + hands'; controls();
  } catch(e) {
    if (r) {recording = null; [r.processed,r.raw].forEach(rec => {if(rec?.state === 'recording') rec.stop();}); r.processedStream.getTracks().forEach(t => t.stop());}
    error(e.message); controls();
  }
}
async function stopRecording() {
  if (!recording) return;
  const r = recording; recording = null; finalizing = true; clearTimeout(r.timer); controls();
  $('status').textContent = 'Finishing recording…';
  [r.processed,r.raw].forEach(rec => {if (rec.state !== 'inactive') rec.stop();});
  await r.finished;
  r.processedStream.getTracks().forEach(t => t.stop());
  finalizing = false; $('mode').textContent = stream ? 'LIVE CAMERA' : 'CAMERA OFF';
  if (!r.failed && r.chunks.length && r.samples.length) {
    urls.forEach(URL.revokeObjectURL); urls = [];
    const detected = r.samples.filter(s => s.ball).length;
    const duration = r.samples.at(-1).t_s;
    const report = {schema_version:'0.2',created_at:new Date().toISOString(),measurement_mode:'single_camera_uncalibrated',coordinate_system:{origin:'top_left',x:'right',y:'down',unit:'pixel',width:canvas.width,height:canvas.height},capture:{requested_fps:60,reported_camera_fps:r.settings.frameRate??null,processed_frames:r.samples.length,duration_s:duration,timestamp_source:video.requestVideoFrameCallback?'requestVideoFrameCallback.mediaTime':'video.currentTime',recording_frame_alignment:'t_s=0 is first processed frame after record start; recorder startup offset is not calibrated'},tracking:{method:'opencv_hsv_contours',...r.config,score_is_probability:false,detection_fraction:detected/r.samples.length},body_pipeline:{model:'mediapipe_pose_landmarker_lite',version:'0.10.21',landmark_names:LANDMARK_NAMES,xy_units:'normalized_image_width_and_height',z_units:'model_relative_depth_not_calibrated',joint_angles:'projected_2d_degrees',visibility_threshold_for_angles:0.6},limitations:['No metric calibration','Throw events are not implemented','Tracking score is heuristic','Video records browser processing cadence, not high-speed camera acquisition','Original and processed recorder start times may differ slightly'],samples:r.samples};
    report.metrics = summarize(report);
    report.tracking.association='hand_assisted_motion_prediction_v1';
    report.tracking.prediction_horizon_s=.2;
    report.tracking.identity_timeout_s=.5;
    report.tracking.phase_is_heuristic=true;
    report.tracking.colour_masks={acquisition:'colour_core_or_wide_colour_round_shape',shape_hue_tolerance:Math.min(40,r.config.tolerance*1.5),shape_min_circularity:.7,shape_min_circle_fill:.72,max_frame_area_fraction:.25,core_hue_tolerance:Math.max(3,r.config.tolerance*.55),core_min_saturation:Math.min(255,r.config.saturation+30),tracking:'core_broad_and_shape'};
    report.limitations.push('Ball tracking phases are association heuristics, not validated release events; dashed predictions are excluded from measured ball positions');
    report.hands_pipeline={model:'mediapipe_hand_landmarker',version:'0.10.21',landmark_names:HAND_NAMES,xy_units:'normalized_image_width_and_height',z_units:'model_relative_depth_not_calibrated',handedness_score_is_landmark_confidence:false,association:'nearest_visible_pose_wrist_one_to_one_with_distance_gate',features:'projected_2d_degrees; wrist bend is signed forearm-to-middle-MCP direction, not anatomical flexion',frame_orientation:'unmirrored'};
    report.limitations.push('Hand landmarks do not measure ball spin, grip force, or true 3D curvature','Small or occluded hands may be missed; handedness score is classification confidence only');
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    function attach(id, blob, name) {const url = URL.createObjectURL(blob); urls.push(url); $(id).href=url; $(id).download=name; return url;}
    const mime = r.processed.mimeType || r.chunks[0].type, rawMime = r.raw.mimeType || r.rawChunks[0]?.type || 'video/webm';
    const processedBlob = new Blob(r.chunks,{type:mime}), rawBlob = new Blob(r.rawChunks,{type:rawMime});
    $('playback').src = attach('download-video',processedBlob,`throw-${stamp}-processed.${mime.includes('mp4')?'mp4':'webm'}`);
    attach('download-raw',rawBlob,`throw-${stamp}-original.${rawMime.includes('mp4')?'mp4':'webm'}`);
    attach('download-data',new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`throw-${stamp}.json`);
    $('summary').textContent = `${duration.toFixed(1)}s · ${r.samples.length} frames · ball visible in ${Math.round(detected/r.samples.length*100)}%`;
    $('result').hidden = false; $('status').textContent = 'Recording complete. Saving to results…';
    $('advice').textContent = 'Open the saved result to review stats and request LLM advice.';
    pendingSave = {report,processedBlob,rawBlob};
    await saveResult();
  } else {error('No usable frames were recorded. Try a longer recording.'); $('status').textContent = 'Ready to retry';}
  controls();c
}
async function saveResult() {
  if (!pendingSave) return;
  const pending = pendingSave;
  finalizing=true; controls(); $('retry-save').hidden=true; $('view-result').hidden=true; $('save-state').textContent='Saving to results…';
  async function request(url,options) {const response=await fetch(url,options); const data=await response.json(); if(!response.ok)throw new Error(data.error||'Save failed'); return data;}
  try {
    const saved=await request('/api/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report:pending.report,video_mime:pending.processedBlob.type,raw_mime:pending.rawBlob.type})});
    await request(`/api/results/${saved.id}/${saved.processed}`,{method:'PUT',body:pending.processedBlob});
    await request(`/api/results/${saved.id}/${saved.original}`,{method:'PUT',body:pending.rawBlob});
    await request(`/api/results/${saved.id}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    $('save-state').textContent='Saved in results/'+saved.id+'/'; $('view-result').href='results.html?id='+saved.id; $('view-result').hidden=false;
    $('status').textContent='Saved. Ready for another throw.'; pendingSave=null;
  } catch(e) { $('save-state').textContent='Could not save: '+e.message; $('retry-save').hidden=false; $('status').textContent='Save failed. Retry or download a copy.'; }
  finally {finalizing=false; controls();}
}
$('retry-save').onclick=saveResult;
$('isolate').onchange=()=>{config.isolate=$('isolate').checked;};
$('enable').onclick = enableCamera; $('start').onclick = startRecording; $('stop').onclick = stopRecording;
document.querySelectorAll('[name=colour]').forEach(input => input.onchange = () => {
  config.colour=input.value; config.hue=PRESETS[input.value]; tracker?.reset(); trail=[];
  $('sample-hint').textContent='Sample the centre of the ball for your lighting.';
});
['tolerance','saturation'].forEach(id => $(id).oninput = () => {config[id]=Number($(id).value); $(id+'-value').textContent=$(id).value; tracker?.reset(); trail=[];});
$('sample').onclick = () => {picking = !picking; canvas.parentElement.classList.toggle('sampling',picking); $('sample-hint').textContent=picking?'Click the centre of the ball in the live video.':'Sample the centre of the ball for your lighting.';};
canvas.onclick = e => {
  if (!picking || !ready || !stream || recording) return;
  const rect = canvas.getBoundingClientRect();
  // object-fit: contain may letterbox non-16:9 cameras.
  const scale = Math.min(rect.width/canvas.width, rect.height/canvas.height);
  const x = (e.clientX-rect.left-(rect.width-canvas.width*scale)/2)/scale;
  const y = (e.clientY-rect.top-(rect.height-canvas.height*scale)/2)/scale;
  if (x<0 || y<0 || x>=canvas.width || y>=canvas.height) return;
  const px = Math.min(small.width-1,Math.floor(x*small.width/canvas.width)), py = Math.min(small.height-1,Math.floor(y*small.height/canvas.height));
  const [r,g,b] = sctx.getImageData(px,py,1,1).data.map(v=>v/255);
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  if (d<.15 || max<.18) { $('sample-hint').textContent='Choose a brighter, more colourful part of the ball.'; return; }
  let h = max===r ? ((g-b)/d)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
  config.hue=Math.round(((h*60+360)%360)/2)%180; config.colour='sampled';
  document.querySelectorAll('[name=colour]').forEach(i=>i.checked=false);
  picking=false; canvas.parentElement.classList.remove('sampling'); tracker.seed(x/canvas.width,y/canvas.height,latestTime); trail=[];
  $('sample-hint').textContent='Sampled colour active. Adjust tolerance if needed.';
};
document.addEventListener('visibilitychange',() => {if (document.hidden && recording) {stopRecording(); error('Recording stopped because the page was hidden. Keep this tab visible while recording.');}});
window.addEventListener('pagehide',() => {stream?.getTracks().forEach(t=>t.stop()); poseTracker?.close(); handTracker?.close(); urls.forEach(URL.revokeObjectURL);});
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tool = {
    name:'get_capture_status', title:'Read camera capture status',
    description:'Read whether the ball tracker, camera and recording are active. Does not start camera capture.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.');
      return {tracker_ready:ready,camera_active:!!stream,recording:!!recording,finalizing,ball_colour:config.colour};
    }
  };
  try {Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});} catch {}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
loadTracker();
loadPose();
loadHands();
