import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jointAngle, summarize } from '../dist/features.js';
const point = (x, y, visibility = 1) => ({ x, y, visibility, presence: 1 });
test('angles use image dimensions and suppress occluded joints', () => {
  assert.equal(jointAngle(point(0, 0), point(0, 1), point(1, 1), 640, 360), 90);
  assert.equal(jointAngle(point(0, 0, 0.1), point(0, 1), point(1, 1), 640, 360), null);
  assert.equal(jointAngle(point(0, 0), point(0, 0), point(1, 1), 640, 360), null);
});
test('missing detections remain missing and unavailable physics stay null', () => {
  const result = summarize({
    capture: { duration_s: 1 },
    samples: [
      { ball: {}, pose: [] },
      { ball: null, pose: Array(33).fill({}) },
    ],
  });
  assert.equal(result.ball_detection_fraction, 0.5);
  assert.equal(result.pose_detection_fraction, 0.5);
  assert.equal(result.ball_speed_m_s, null);
  assert.equal(result.projected_angles_deg.left_elbow_deg, null);
});
