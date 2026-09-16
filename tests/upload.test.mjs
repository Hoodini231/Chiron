import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWindows} from '../dist/throw-windows.js';
import {scanThrows,processThrows,seekVideo} from '../dist/upload-processing.js';
import {summarize,poseFeatures} from '../dist/features.js';
import {throwSample} from './throw-fixtures.mjs';
function harness({throws=[.2],duration=3,saveFails=false}={}){
  const elements=new Map(), requests=[],encoded=[];
  const paint=new Proxy({}, {get:()=>()=>{}});
  const track={requestFrame(){},stop(){}};
  class Element extends EventTarget {
    constructor(){super();this.time=0;this.duration=duration;this.readyState=4;this.videoWidth=640;this.videoHeight=640;this.style={};this.classList={remove(){},toggle(){}};this.parentElement=this;this.children=[];this.tagName='DIV';}
    get currentTime(){return this.time;}set currentTime(t){this.time=t;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
    getContext(){return paint;}captureStream(){return {getVideoTracks:()=>[track],getTracks:()=>[track]};}
    setAttribute(name,value){this[name]=value;}append(...children){this.children.push(...children);}replaceChildren(){this.children=[];}querySelectorAll(){return this.children.flatMap(c=>typeof c==='object'?[c,...c.querySelectorAll()]:[]);}
    pause(){this.paused=true;}async play(){this.paused=false;}load(){queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')));}removeAttribute(){}requestVideoFrameCallback(){return 1;}cancelVideoFrameCallback(){}
  }
  const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  class Recorder{static isTypeSupported(){return true;}constructor(){this.mimeType='video/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['processed'])});this.onstop();}}
  const context={document:{getElementById:$,createElement:tag=>{const e=new Element();e.tagName=tag.toUpperCase();return e;},querySelectorAll:()=>[],addEventListener(){}},window:{MediaRecorder:Recorder,addEventListener(){}},MediaRecorder:Recorder,URL,Blob,File,Event,AbortController,DOMException,performance,console,setTimeout,clearTimeout,cancelAnimationFrame(){},requestAnimationFrame(){},fetch:async(url,options)=>{requests.push({url,...options});return {ok:!saveFails,json:async()=>saveFails?{error:'disk full'}:url==='/api/results'?{id:'test',processed:'processed.webm',original:'original.webm'}:{}};},drawPose(){},drawHands(){},collectHands:()=>[],handFeatures:()=>[],poseFeatures,summarize,LANDMARK_NAMES:[],HAND_NAMES:[],validateWindows,scanThrows,processThrows,seekVideo,checkEncoderSupport:async()=>{},createVideoWriter:async()=>({add:async(t,d)=>encoded.push([t,d]),finish:async()=>new Blob(['processed'],{type:'video/webm'}),cancel:async()=>{}}),poseAt:()=>throwSample($('source').currentTime,throws).pose};
  vm.createContext(context);
  const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/loadTracker\(\);\nloadPose\(\);\nloadHands\(\);/,'');
  vm.runInContext(source+`\nready=true;tracker={reset(){},detect(){return null;},status:{}};poseTracker={detectForVideo(){return {landmarks:[poseAt()]};}};handTracker={detectForVideo(){return {};}};globalThis.captureTest={uploadVideo,startRecording,stopRecording,processApprovedThrows,frame,saveResult,setCamera:()=>{clearSource();stream={getVideoTracks:()=>[{getSettings:()=>({frameRate:60})}]};},state:()=>({uploadedFile,recording,finalizing,pendingSave,throwWindows,uploadJob,reviewing})};`,context);
  return {api:context.captureTest,$,requests,encoded};
}
test('uploaded video scans, reviews, then saves only retained samples and unchanged original',async()=>{
  const {api,$,requests,encoded}=harness();const file=new File(['original bytes'],'throw.webm',{type:'video/webm'});
  await api.uploadVideo(file);assert.equal(api.state().uploadedFile,file);assert.equal($('start').disabled,false);
  await api.startRecording();assert.equal(api.state().recording,null);assert.equal(api.state().throwWindows.length,1);assert.equal(requests.length,0);
  const row=$('throw-windows').children[0];
  const inputs=row.children.filter(c=>c.tagName==='LABEL').map(label=>label.children[1]);
  inputs[0].value='0.3';inputs[0].oninput();inputs[1].value='1.8';inputs[1].oninput();
  assert.equal($('process-throws').disabled,false);
  await api.processApprovedThrows();
  assert.equal(api.state().pendingSave,null);assert.equal(encoded.length,45);
  assert.equal(requests.find(r=>r.url.endsWith('/original.webm')).body,file);
  const report=JSON.parse(requests[0].body).report;
  assert.equal(report.capture.source,'uploaded_video');assert.equal(report.samples[0].t_s,0);
  assert.equal(report.samples[0].source_media_time_s,.3);assert.equal(report.capture.original_filename,'throw.webm');
  assert.equal(report.metrics.duration_s,1.5);assert.equal(report.metrics.processed_fps,30);assert.equal(report.metrics.throw_count,1);
  assert.equal(report.throw_detection.segments[0].edited,true);
});
test('zero detections allow a manual window and invalid edits disable processing',async()=>{
  const {api,$,requests}=harness({throws:[]});
  await api.uploadVideo(new File(['x'],'empty.webm',{type:'video/webm'}));await api.startRecording();
  assert.equal(api.state().throwWindows.length,0);assert.equal($('process-throws').disabled,true);assert.match($('throw-review-message').textContent,/No throws/);
  $('source').currentTime=.3;$('add-throw').onclick();
  assert.equal($('process-throws').disabled,false);
  const row=$('throw-windows').children[0],start=row.children.find(c=>c.tagName==='LABEL').children[1];
  start.value='';start.oninput();assert.equal($('process-throws').disabled,true);
  start.value='.4';start.oninput();assert.equal($('process-throws').disabled,false);
  await api.processApprovedThrows();assert.equal(requests.length,4);
});
test('save failure keeps finished export for retry and disables further processing',async()=>{
  const {api,$}=harness({saveFails:true});
  await api.uploadVideo(new File(['x'],'throw.webm',{type:'video/webm'}));await api.startRecording();await api.processApprovedThrows();
  assert.ok(api.state().pendingSave);assert.equal($('process-throws').disabled,true);assert.equal($('retry-save').hidden,false);
});
test('camera recording remains untrimmed and uses the existing recorder save transaction',async()=>{
  const {api,requests}=harness();api.setCamera();await api.startRecording();assert.ok(api.state().recording.raw);
  api.frame(performance.now(),{mediaTime:10});api.frame(performance.now()+50,{mediaTime:10.05});await api.stopRecording();
  assert.equal(requests.length,4);const report=JSON.parse(requests[0].body).report;
  assert.equal(report.capture.source,'camera');assert.equal(report.throw_detection,undefined);assert.equal(report.samples.length,2);assert.equal(report.samples[0].t_s,0);
});
test('unsupported and oversized uploads are rejected before replacing a source',async()=>{
  const {api,$}=harness();
  await api.uploadVideo(new File(['x'],'bad.txt',{type:'text/plain'}));assert.equal(api.state().uploadedFile,null);assert.match($('error').textContent,/MP4 or WebM/);
  await api.uploadVideo({size:161*1024*1024});assert.match($('error').textContent,/160 MB/);
  $('source').duration=121;
  await api.uploadVideo(new File(['x'],'long.mp4',{type:'video/mp4'}));assert.equal(api.state().uploadedFile,null);assert.match($('error').textContent,/2 minutes/);
});
