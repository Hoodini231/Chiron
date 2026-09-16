import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { BallTracker, PRESETS } from '../dist/tracker.js';
const module = { exports: {} };
vm.runInNewContext(fs.readFileSync(new URL('../dist/vendor/opencv.js', import.meta.url), 'utf8'), {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  process,
  Buffer,
  console,
  WebAssembly,
  TextDecoder,
  TextEncoder,
  setTimeout,
  clearTimeout,
  __dirname: process.cwd(),
  __filename: 'opencv.cjs',
});
const { cv } = await new Promise((resolve) => module.exports.then((cv) => resolve({ cv })));

const dir = '/tmp/dodgeball-frames',
  times = JSON.parse(fs.readFileSync(dir + '/times.json'));
const report = JSON.parse(fs.readFileSync('results/52cc1e26f37d44459bf27ed0ae7fb4b3/data.json'));
const tracker = new BallTracker(cv),
  mat = new cv.Mat(360, 640, cv.CV_8UC4);
cv.imread = () => mat.clone();
const output = [];
let j = 0;
for (let i = 0; i < times.length; i++) {
  const t = times[i];
  while (j + 1 < report.samples.length && report.samples[j + 1].t_s < t) j++;
  mat.data.set(fs.readFileSync(dir + '/' + String(i).padStart(4, '0') + '.rgba'));
  const sample = report.samples[j];
  output.push({
    t,
    ball: tracker.detect({}, t, report.tracking, { hands: sample.hands, pose: sample.pose }),
  });
}
fs.writeFileSync(process.argv[2], JSON.stringify(output));
mat.delete();
