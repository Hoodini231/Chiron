import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(){
  const elements=new Map(), requests=[];
  const paint=new Proxy({}, {get:()=>()=>{}});
  const track={requestFrame(){},stop(){}};
  class Element extends EventTarget {
    constructor(){super();this.currentTime=0;this.duration=1;this.readyState=4;this.videoWidth=640;this.videoHeight=360;this.style={};this.classList={remove(){},toggle(){}};this.parentElement=this;}
    getContext(){return paint;}captureStream(){return {getVideoTracks:()=>[track],getTracks:()=>[track]};}
    pause(){this.paused=true;}async play(){this.paused=false;}load(){queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')));}removeAttribute(){}requestVideoFrameCallback(){return 1;}cancelVideoFrameCallback(){}
  }
  const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  class Recorder{static isTypeSupported(){return true;}constructor(){this.mimeType='video/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['processed'])});this.onstop();}}
  const context={document:{getElementById:$,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener(){}},window:{MediaRecorder:Recorder,addEventListener(){}},MediaRecorder:Recorder,URL,Blob,File,Event,performance,console,setTimeout,clearTimeout,cancelAnimationFrame(){},requestAnimationFrame(){},fetch:async(url,options)=>{requests.push({url,...options});return {ok:true,json:async()=>url==='/api/results'?{id:'test',processed:'processed.webm',original:'original.webm'}:{}};},drawPose(){},drawHands(){},collectHands:()=>[],handFeatures:()=>[],poseFeatures:()=>({}),summarize:()=>({}),LANDMARK_NAMES:[],HAND_NAMES:[]};
  vm.createContext(context);
  const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/loadTracker\(\);\nloadPose\(\);\nloadHands\(\);/,'');
  vm.runInContext(source+`\nready=true;tracker={reset(){},detect(){return null;},status:{}};poseTracker={detectForVideo(){return {landmarks:[]};}};handTracker={detectForVideo(){return {};}};globalThis.captureTest={uploadVideo,startRecording,stopRecording,frame,state:()=>({uploadedFile,recording,finalizing,pendingSave})};`,context);
  return {api:context.captureTest,$,requests};
}
test('uploaded video runs all pipelines and saves the original file unchanged',async()=>{
  const {api,$,requests}=harness();const file=new File(['original bytes'],'throw.webm',{type:'video/webm'});
  await api.uploadVideo(file);assert.equal(api.state().uploadedFile,file);assert.equal($('start').disabled,false);
  await api.startRecording();assert.ok(api.state().recording);assert.equal(api.state().recording.raw,null);
  api.frame(performance.now()+10,{mediaTime:.5});
  await api.stopRecording();
  assert.equal(api.state().recording,null);assert.equal(api.state().pendingSave,null);
  assert.equal(requests.find(r=>r.url.endsWith('/original.webm')).body,file);
  const report=JSON.parse(requests[0].body).report;
  assert.equal(report.capture.source,'uploaded_video');assert.equal(report.samples[0].t_s,.5);
  assert.equal(report.capture.original_filename,'throw.webm');
});
test('unsupported and oversized uploads are rejected before replacing a source',async()=>{
  const {api,$}=harness();
  await api.uploadVideo(new File(['x'],'bad.txt',{type:'text/plain'}));assert.equal(api.state().uploadedFile,null);assert.match($('error').textContent,/MP4 or WebM/);
  await api.uploadVideo({size:161*1024*1024});assert.match($('error').textContent,/160 MB/);
  $('source').duration=121;
  await api.uploadVideo(new File(['x'],'long.mp4',{type:'video/mp4'}));assert.equal(api.state().uploadedFile,null);assert.match($('error').textContent,/2 minutes/);
});
