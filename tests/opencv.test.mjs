import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {BallTracker,PRESETS} from '../dist/tracker.js';
const module={exports:{}};
vm.runInNewContext(fs.readFileSync(new URL('../dist/vendor/opencv.js',import.meta.url),'utf8'),{module,exports:module.exports,require:createRequire(import.meta.url),process,Buffer,console,WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,__dirname:process.cwd(),__filename:'opencv.cjs'});
const {cv}=await new Promise(resolve=>module.exports.then(cv=>resolve({cv})));
test('strong colour core separates a red ball touching a skin-coloured patch',()=>{
  const mat=new cv.Mat(180,320,cv.CV_8UC4,[10,10,10,255]), original=cv.imread;
  try {
    cv.rectangle(mat,new cv.Point(80,90),new cv.Point(150,115),new cv.Scalar(200,105,70,255),-1);
    cv.circle(mat,new cv.Point(80,90),14,new cv.Scalar(255,0,0,255),-1);
    cv.imread=()=>mat.clone();
    const ball=new BallTracker(cv).detect({},0,{hue:0,tolerance:14,saturation:140});
    assert.ok(ball);assert.equal(ball.mask_source,'core');
    assert.ok(Math.hypot(ball.x-80,ball.y-90)<1);
  } finally {cv.imread=original;mat.delete();}
});

test('clear circular edges can acquire a less saturated ball and maintain its track',()=>{
  const mat=new cv.Mat(180,320,cv.CV_8UC4,[10,10,10,255]), original=cv.imread;
  const config={hue:0,tolerance:14,saturation:140};
  try {
    cv.imread=()=>mat.clone();
    cv.circle(mat,new cv.Point(80,90),14,new cv.Scalar(255,0,0,255),-1);
    const tracker=new BallTracker(cv);assert.ok(tracker.detect({},0,config));
    mat.setTo(new cv.Scalar(10,10,10,255));
    cv.circle(mat,new cv.Point(85,90),14,new cv.Scalar(255,100,100,255),-1);
    assert.equal(new BallTracker(cv).detect({},0,config).mask_source,'object');
    const ball=tracker.detect({},.05,config);
    assert.ok(ball);assert.ok(Math.abs(ball.x-85)<2);
  } finally {cv.imread=original;mat.delete();}
});
test('actual OpenCV finds all four synthetic coloured balls and rejects blank frames',()=>{
  const colours={red:[255,0,0,255],teal:[0,210,200,255],yellow:[255,220,0,255],purple:[190,0,255,255]};
  const original=cv.imread;
  try {
    for(const [name,colour] of Object.entries(colours)){
      const mat=new cv.Mat(180,320,cv.CV_8UC4,[10,10,10,255]);
      cv.circle(mat,new cv.Point(120,90),18,new cv.Scalar(...colour),-1);
      cv.imread=()=>mat.clone();
      const tracker=new BallTracker(cv),ball=tracker.detect({},0,{hue:PRESETS[name],tolerance:14,saturation:85});
      assert.ok(ball, name+' detection');assert.ok(Math.hypot(ball.x-120,ball.y-90)<1);
      mat.setTo(new cv.Scalar(10,10,10,255));
      assert.equal(tracker.detect({},.1,{hue:PRESETS[name],tolerance:14,saturation:85}),null);
      mat.delete();
    }
  }finally{cv.imread=original;}
});

test('rendered same-colour distractor loses to the ball beside the hand',()=>{
  const mat=new cv.Mat(180,320,cv.CV_8UC4,[10,10,10,255]), original=cv.imread;
  try {
    cv.circle(mat,new cv.Point(245,90),28,new cv.Scalar(255,0,0,255),-1);
    cv.circle(mat,new cv.Point(80,90),10,new cv.Scalar(255,0,0,255),-1);
    cv.imread=()=>mat.clone();
    const hands=[{associated_pose_side:'right',landmarks:Array.from({length:21},()=>({x:70/320,y:.5}))}];
    const found=new BallTracker(cv).detect({},0,{hue:0,tolerance:14,saturation:85},{hands});
    assert.ok(Math.abs(found.x-80)<1);assert.equal(found.tracking_phase,'near_hand');
  } finally {cv.imread=original;mat.delete();}
});

test('rendered blur is accepted along established motion, but not as an initial ball',()=>{
  const mat=new cv.Mat(180,320,cv.CV_8UC4,[10,10,10,255]), original=cv.imread;
  const config={hue:0,tolerance:14,saturation:85};
  try {
    cv.imread=()=>mat.clone();
    const tracker=new BallTracker(cv);
    for(const [i,x] of [60,80,100].entries()){
      mat.setTo(new cv.Scalar(10,10,10,255));cv.circle(mat,new cv.Point(x,90),10,new cv.Scalar(255,0,0,255),-1);
      assert.ok(tracker.detect({},i*.05,config));
    }
    mat.setTo(new cv.Scalar(10,10,10,255));
    cv.ellipse(mat,new cv.Point(120,90),new cv.Size(35,8),0,0,360,new cv.Scalar(255,0,0,255),-1);
    const detected=tracker.detect({},.15,config);
    assert.ok(detected);assert.equal(detected.blurred,true);assert.ok(Math.abs(detected.x-120)<1);
    assert.equal(new BallTracker(cv).detect({},0,config),null);
  } finally {cv.imread=original;mat.delete();}
});


test('warm yellow close-up acquires by shape, but a warm elongated patch does not',()=>{
  const mat=new cv.Mat(360,640,cv.CV_8UC4,[25,25,25,255]), original=cv.imread;
  const config={hue:29,tolerance:14,saturation:140};
  try {
    cv.imread=()=>mat.clone();
    // Warm yellow from the reported lighting; >10% of frame and outside core hue.
    cv.circle(mat,new cv.Point(455,130),94,new cv.Scalar(201,132,58,255),-1);
    const ball=new BallTracker(cv).detect({},0,config);
    assert.ok(ball);assert.ok(['shape','saturated','object'].includes(ball.mask_source));
    assert.ok(Math.hypot(ball.x-455,ball.y-130)<3);
    assert.ok(ball.radius>90);
    mat.setTo(new cv.Scalar(25,25,25,255));
    cv.rectangle(mat,new cv.Point(100,100),new cv.Point(400,160),new cv.Scalar(201,132,58,255),-1);
    assert.equal(new BallTracker(cv).detect({},0,config),null);
  } finally {cv.imread=original;mat.delete();}
});


test('yellow wall rectangles cannot acquire or sustain a ball track',()=>{
  const mat=new cv.Mat(180,320,cv.CV_8UC4,[10,10,10,255]),original=cv.imread;
  const config={hue:29,tolerance:14,saturation:140};
  try {
    cv.imread=()=>mat.clone();const tracker=new BallTracker(cv);
    cv.circle(mat,new cv.Point(120,90),20,new cv.Scalar(255,220,0,255),-1);
    assert.ok(tracker.detect({},0,config));
    mat.setTo(new cv.Scalar(10,10,10,255));
    cv.rectangle(mat,new cv.Point(90,60),new cv.Point(150,120),new cv.Scalar(255,220,0,255),-1);
    assert.equal(tracker.detect({},.1,config),null);
    assert.equal(new BallTracker(cv).detect({},0,config),null);
  } finally {cv.imread=original;mat.delete();}
});
