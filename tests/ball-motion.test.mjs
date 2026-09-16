import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BallMotion,handAnchors} from '../dist/ball-motion.js';
const W=640,H=360;
const ball=(x,y=180,radius=10,extra={})=>({x,y,radius,area:Math.PI*radius*radius,circularity:.9,aspect:1,colourScore:1,...extra});
const context=(x,y=180)=>({hands:[{associated_pose_side:'right',landmarks:Array.from({length:21},()=>({x:x/W,y:y/H}))}]});
const update=(tracker,candidates,t,ctx={})=>tracker.update(candidates,t,W,H,ctx);

test('hand-assisted acquisition beats a larger same-colour distractor',()=>{
  const tracker=new BallMotion();
  const found=update(tracker,[ball(400,180,26),ball(110)],0,context(100));
  assert.equal(found.x,110);assert.equal(found.tracking_phase,'near_hand');assert.equal(found.hand_source,'hand_landmarks');
});
test('hand proximity cannot promote an irregular skin-coloured patch over a clear ball',()=>{
  const found=update(new BallMotion(),[ball(100,180,22,{circularity:.48,colourScore:.65}),ball(280)],0,context(100));
  assert.equal(found.x,280);
});
test('visible pose wrist is a weaker fallback when fingers are occluded',()=>{
  const pose=Array(33).fill(null);pose[15]={x:100/W,y:.5,visibility:.9,presence:.9};
  const anchors=handAnchors({pose},W,H);
  assert.equal(anchors[0].source,'pose_wrist');assert.ok(anchors[0].reliability<1);
  const found=update(new BallMotion(),[ball(450,180,25),ball(110)],0,{pose});
  assert.equal(found.x,110);assert.equal(found.hand_side,'left');
});
test('ball leaves its hand and continues in flight despite a distractor by the hand',()=>{
  const tracker=new BallMotion();
  update(tracker,[ball(100)],0,context(100));
  update(tracker,[ball(110)],.05,context(110));
  const separating=update(tracker,[ball(165)],.1,context(110));
  assert.equal(separating.tracking_phase,'near_hand');
  const released=update(tracker,[ball(220)],.15,context(110));
  assert.equal(released.tracking_phase,'flight');
  const flight=update(tracker,[ball(110,180,15),ball(275)],.2,context(110));
  assert.equal(flight.x,275);assert.equal(flight.track_id,released.track_id);
});
test('missing hand alone never confirms release',()=>{
  const tracker=new BallMotion();
  update(tracker,[ball(100)],0,context(100));
  update(tracker,[ball(130)],.05);
  assert.notEqual(update(tracker,[ball(170)],.1).tracking_phase,'flight');
});
test('motion predictor bridges a short gap without manufacturing observations',()=>{
  const tracker=new BallMotion();
  const first=update(tracker,[ball(100)],0);
  update(tracker,[ball(120)],.05);
  assert.equal(update(tracker,[],.1),null);
  assert.equal(tracker.status.state,'predicted');assert.equal(tracker.status.prediction.observed,false);
  assert.equal(tracker.status.prediction.x,140);
  const found=update(tracker,[ball(120,180,15),ball(160)],.15);
  assert.equal(found.x,160);assert.equal(found.track_id,first.track_id);
  update(tracker,[],.4);assert.equal(tracker.status.state,'lost');assert.equal(tracker.status.prediction,null);
  const reacquired=update(tracker,[ball(450)],.8);
  assert.notEqual(reacquired.track_id,first.track_id);
});
test('inconsistent jumps and motion-unsupported streaks are rejected',()=>{
  const tracker=new BallMotion();
  assert.equal(update(tracker,[ball(100,180,20,{aspect:5})],0),null);
  update(tracker,[ball(100)],.05);update(tracker,[ball(120)],.1);
  assert.equal(update(tracker,[ball(620)],.15),null);
  const blur=update(tracker,[ball(160,180,20,{aspect:4,sizeRadius:10,axis:{x:1,y:0},circularity:.3})],.2);
  assert.ok(blur);assert.equal(blur.blurred,true);
});
test('tracking follows curved observations rather than replacing them with a straight line',()=>{
  const tracker=new BallMotion();
  for(const [index,[x,y]] of [[100,180],[120,182],[140,190],[158,204],[172,224]].entries()){
    const found=update(tracker,[ball(x,y)],index*.05);
    assert.equal(found.x,x);assert.equal(found.y,y);assert.equal(found.observed,true);
  }
});
test('a colour sample also seeds the intended ball location; seed is not an observation',()=>{
  const tracker=new BallMotion();tracker.seed(400/W,180/H,0);
  assert.equal(tracker.status.prediction,null);
  assert.equal(update(tracker,[ball(100,180,30),ball(400)],.05).x,400);
});
test('camera timestamp restart clears stale identity and velocity',()=>{
  const tracker=new BallMotion();update(tracker,[ball(100)],4);update(tracker,[ball(120)],4.05);
  const found=update(tracker,[ball(400)],0);
  assert.equal(found.x,400);assert.equal(tracker.velocity.x,0);
});


test('retracting hand cannot pull the ball track back before flight is confirmed',()=>{
  const tracker=new BallMotion();
  const first=update(tracker,[ball(100)],0,context(100));
  update(tracker,[ball(130)],.05,context(130));
  const released=update(tracker,[ball(90),ball(160)],.1,context(90));
  assert.equal(released.x,160);
  assert.equal(released.track_id,first.track_id);
  assert.equal(released.tracking_phase,'near_hand');
  // Even short-gap predictions must follow the ball, not the retracting wrist.
  assert.equal(update(tracker,[],.15,context(60)),null);
  assert.ok(Math.abs(tracker.status.prediction.x-190)<1e-6);
  const next=update(tracker,[ball(60),ball(220)],.2,context(60));
  assert.equal(next.x,220);assert.equal(next.track_id,first.track_id);
});


test('irregular yellow regions do not sustain an established ball identity',()=>{
  const tracker=new BallMotion();update(tracker,[ball(100)],0);
  assert.equal(update(tracker,[ball(105,180,12,{circularity:.45,circleFill:.5})],.05),null);
  assert.equal(tracker.status.state,'predicted');
});
