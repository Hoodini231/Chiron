import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handFeatures} from '../dist/hand-features.js';
test('hand association is one-to-one and straight wrist has zero projected bend',()=>{
  const pose=Array.from({length:33},()=>({x:0,y:0,visibility:0}));
  pose[13]={x:.1,y:.5,visibility:1};pose[15]={x:.2,y:.5,visibility:1};
  const landmarks=Array.from({length:21},()=>({x:.2,y:.5}));landmarks[9]={x:.3,y:.5};
  const hands=handFeatures([{landmarks},{landmarks}],pose,640,360);
  assert.equal(hands[0].associated_pose_side,'left');assert.equal(hands[1].associated_pose_side,null);
  assert.equal(hands[0].features_2d.projected_wrist_bend_deg,0);
  assert.equal(hands[1].features_2d.projected_wrist_bend_deg,null);
});
test('small hands do not produce angle features',()=>{
  const landmarks=Array.from({length:21},()=>({x:.2,y:.5}));
  const result=handFeatures([{landmarks}],null,640,360)[0];
  assert.deepEqual(result.quality_flags,['hand_too_small_for_angle_features']);
  assert.ok(Object.values(result.features_2d).every(v=>v===null));
});
