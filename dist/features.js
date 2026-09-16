export function jointAngle(a, b, c, width, height) {
  if (![a, b, c].every((p) => p && (p.visibility ?? 0) >= 0.6 && (p.presence ?? 1) >= 0.5))
    return null;
  const ux = (a.x - b.x) * width,
    uy = (a.y - b.y) * height,
    vx = (c.x - b.x) * width,
    vy = (c.y - b.y) * height;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (length < 1e-8) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / length))) * 180) / Math.PI;
}
export function poseFeatures(p, width, height) {
  if (!p) return null;
  return {
    left_elbow_deg: jointAngle(p[11], p[13], p[15], width, height),
    right_elbow_deg: jointAngle(p[12], p[14], p[16], width, height),
    left_knee_deg: jointAngle(p[23], p[25], p[27], width, height),
    right_knee_deg: jointAngle(p[24], p[26], p[28], width, height),
  };
}
export function summarize(report) {
  const samples = report.samples ?? [],
    n = samples.length,
    seen = samples.filter((s) => s.ball).length,
    poses = samples.filter((s) => s.pose?.length).length;
  const angles = {};
  for (const key of ['left_elbow_deg', 'right_elbow_deg', 'left_knee_deg', 'right_knee_deg']) {
    const values = samples
      .map((s) => s.features_2d?.[key])
      .filter((v) => typeof v === 'number' && Number.isFinite(v));
    angles[key] = values.length
      ? { min: Math.min(...values), max: Math.max(...values), observations: values.length }
      : null;
  }
  const duration = report.capture?.duration_s ?? 0;
  const handFrames = samples.filter((s) => s.hands?.length).length;
  const wrist = {};
  for (const side of ['left', 'right']) {
    const values = samples
      .flatMap((s) => s.hands ?? [])
      .filter((h) => h.associated_pose_side === side)
      .map((h) => h.features_2d?.projected_wrist_bend_deg)
      .filter((v) => typeof v === 'number' && Number.isFinite(v));
    // Angular values can cross ±180°; report observations without a misleading min/max span.
    wrist[side] = { observations: values.length };
  }
  return {
    duration_s: duration,
    processed_frames: n,
    processed_fps: duration > 0 ? (n - 1) / duration : null,
    ball_detection_fraction: n ? seen / n : 0,
    pose_detection_fraction: n ? poses / n : 0,
    hand_detection_fraction: n ? handFrames / n : 0,
    wrist_bend_samples: wrist,
    projected_angles_deg: angles,
    ball_speed_m_s: null,
    time_to_load_s: null,
    time_to_release_s: null,
    ball_spin_rpm: null,
  };
}
