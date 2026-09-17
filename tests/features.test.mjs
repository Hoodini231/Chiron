import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jointAngle, summarize } from '../dist/features.js';

test('rotation velocities exclude cuts between throws and retain legacy samples', () => {
  const report = {
    capture: { duration_s: 0.4, original_duration_s: 26 },
    throw_detection: { segments: [{ id: 1 }, { id: 2 }] },
    samples: [
      { t_s: 0, throw_id: 1, features_2d: { shoulder_line_deg: 0, hip_line_deg: 0 } },
      { t_s: 0.1, throw_id: 1, features_2d: { shoulder_line_deg: 10, hip_line_deg: 5 } },
      { t_s: 0.2, throw_id: 2, features_2d: { shoulder_line_deg: 150, hip_line_deg: 130 } },
      { t_s: 0.3, throw_id: 2, features_2d: { shoulder_line_deg: 160, hip_line_deg: 135 } },
    ],
  };
  const metrics = summarize(report);
  assert.equal(metrics.throw_count, 2);
  assert.equal(metrics.shoulder_rotation_velocity_deg_s.observations, 2);
  assert.ok(Math.abs(metrics.shoulder_rotation_velocity_deg_s.peak - 100) < 1e-6);
  assert.ok(Math.abs(metrics.hip_rotation_velocity_deg_s.peak - 50) < 1e-6);
  const legacy = summarize({
    capture: { duration_s: 0.4 },
    samples: report.samples.map(({ throw_id, ...s }) => s),
  });
  assert.equal(legacy.shoulder_rotation_velocity_deg_s.observations, 3);
  assert.equal(legacy.throw_count, undefined);
});
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
