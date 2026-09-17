import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectThrowWindows,validateWindows,buildTimeline} from '../dist/throw-windows.js';
import {throwSamples,throwSample} from './throw-fixtures.mjs';

test('26 seconds with three throws yields three padded full-motion windows',()=>{
  const windows=detectThrowWindows(throwSamples(),26,640,640);
  assert.equal(windows.length,3);
  for(const [i,w] of windows.entries()) {
    const start=[3,11,20][i];
    assert.ok(w.start_s<=start+.1,JSON.stringify(w));
    assert.ok(w.end_s>=start+1.35,JSON.stringify(w));
    assert.ok(w.end_s-w.start_s<4);
  }
  const joined=buildTimeline(windows,26);
  assert.ok(joined.duration_s<12);
  assert.equal(joined.frames[0].t_s,0);
  for(let i=1;i<joined.frames.length;i++) {
    const before=joined.frames[i-1],after=joined.frames[i];
    assert.ok(Math.abs(before.t_s+before.duration_s-after.t_s)<.000002);
  }
  assert.ok(Math.abs(joined.frames.at(-1).t_s+joined.frames.at(-1).duration_s-joined.duration_s)<.000002);
});
test('either throwing arm can produce pose-only candidates when ball is obscured',()=>{
  for(const side of ['left','right']) {
    const result=detectThrowWindows(throwSamples(8,[2],side,{ball:false}),8,640,640);
    assert.equal(result.length,1);assert.equal(result[0].estimates[0].side,side);
    assert.equal(result[0].estimates[0].confidence,'pose_only');
  }
});
test('idle motion, translations, predictions and an isolated landmark jump are not throws',()=>{
  const idle=throwSamples(4,[]);
  assert.equal(detectThrowWindows(idle,4,640,640).length,0);
  const translating=idle.map((s,i)=>({...throwSample(i/15,[],'right',{shift:i*.02}),ball_prediction:{observed:false,x_px:i*30}}));
  assert.equal(detectThrowWindows(translating,4,640,640).length,0);
  idle[25].pose[16].x+=1;
  assert.equal(detectThrowWindows(idle,4,640,640).length,0);
});
test('brief tracking gaps do not create duplicate throws; clip edges are clamped',()=>{
  const samples=throwSamples(6,[0,4.5]);samples[8].pose=null;samples[13].ball=null;
  const windows=detectThrowWindows(samples,6,640,640);
  assert.equal(windows.length,2);
  assert.equal(windows[0].start_s,0);
  assert.equal(windows[1].end_s,6);
});
test('opposite arm peaks and overlapping proposals collapse into one window',()=>{
  const samples=throwSamples(5,[1]).map(s=>{
    const left=throwSample(s.t_s,[1.2],'left');
    for(const i of [11,13,15,23])s.pose[i]=left.pose[i];return s;
  });
  assert.equal(detectThrowWindows(samples,5,640,640).length,1);
});
test('edited windows sort chronologically and preserve source/output timestamps',()=>{
  const result=buildTimeline([{start_s:20,end_s:21.01,edited:true},{start_s:3,end_s:4.5}],26);
  assert.equal(result.duration_s,2.51);
  assert.deepEqual(result.segments.map(s=>[s.source_start_s,s.output_start_s,s.output_end_s]),[[3,0,1.5],[20,1.5,2.51]]);
  assert.equal(result.frames.find(s=>s.throw_id===2).source_media_time_s,20);
  assert.equal(result.frames.find(s=>s.throw_id===2).source_analysis_frame,4800);
  assert.equal(result.segments[1].edited,true);
  for(const windows of [[],[{start_s:-1,end_s:1}],[{start_s:1,end_s:27}],[{start_s:1,end_s:1}],[{start_s:NaN,end_s:2}],[{start_s:1,end_s:3},{start_s:2,end_s:4}]]) assert.throws(()=>validateWindows(windows,26));
});
