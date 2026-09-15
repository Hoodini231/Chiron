import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {BallTracker,PRESETS} from '../dist/tracker.js';
const module={exports:{}};
vm.runInNewContext(fs.readFileSync(new URL('../dist/vendor/opencv.js',import.meta.url),'utf8'),{module,exports:module.exports,require:createRequire(import.meta.url),process,Buffer,console,WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,__dirname:process.cwd(),__filename:'opencv.cjs'});
const {cv}=await new Promise(resolve=>module.exports.then(cv=>resolve({cv})));
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
