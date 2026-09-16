export function projectedAngle(a, b, c, width, height) {
  if (!a || !b || !c) return null;
  const ux = (a.x - b.x) * width,
    uy = (a.y - b.y) * height,
    vx = (c.x - b.x) * width,
    vy = (c.y - b.y) * height;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return length < 1e-6
    ? null
    : (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / length))) * 180) / Math.PI;
}
export function handFeatures(hands, pose, width, height) {
  const pairs = [];
  hands.forEach((hand, i) => {
    for (const [side, wrist] of [
      ['left', 15],
      ['right', 16],
    ]) {
      const p = pose?.[wrist];
      if (p && (p.visibility ?? 0) >= 0.6 && (p.presence ?? 1) >= 0.5) {
        const distance = Math.hypot(
          (hand.landmarks[0].x - p.x) * width,
          (hand.landmarks[0].y - p.y) * height,
        );
        if (distance < Math.hypot(width, height) * 0.12) pairs.push({ i, side, distance });
      }
    }
  });
  pairs.sort((a, b) => a.distance - b.distance);
  const usedHands = new Set(),
    usedSides = new Set(),
    matches = new Map();
  for (const p of pairs)
    if (!usedHands.has(p.i) && !usedSides.has(p.side)) {
      matches.set(p.i, p);
      usedHands.add(p.i);
      usedSides.add(p.side);
    }
  return hands.map((hand, i) => {
    const p = hand.landmarks,
      match = matches.get(i),
      size = Math.hypot((p[9].x - p[0].x) * width, (p[9].y - p[0].y) * height);
    const features = {
      index_pip_deg: null,
      middle_pip_deg: null,
      ring_pip_deg: null,
      pinky_pip_deg: null,
      projected_wrist_bend_deg: null,
    };
    if (size >= 8) {
      for (const [key, mcp, pip, dip] of [
        ['index', 5, 6, 7],
        ['middle', 9, 10, 11],
        ['ring', 13, 14, 15],
        ['pinky', 17, 18, 19],
      ])
        features[key + '_pip_deg'] = projectedAngle(p[mcp], p[pip], p[dip], width, height);
      if (match) {
        const elbow = pose[match.side === 'left' ? 13 : 14],
          wrist = pose[match.side === 'left' ? 15 : 16];
        if (elbow && (elbow.visibility ?? 0) >= 0.6) {
          const ax = (wrist.x - elbow.x) * width,
            ay = (wrist.y - elbow.y) * height,
            bx = (p[9].x - p[0].x) * width,
            by = (p[9].y - p[0].y) * height;
          if (Math.hypot(ax, ay) > 5)
            features.projected_wrist_bend_deg =
              (Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI;
        }
      }
    }
    return {
      ...hand,
      associated_pose_side: match?.side ?? null,
      pose_wrist_distance_px: match?.distance ?? null,
      quality_flags: size < 8 ? ['hand_too_small_for_angle_features'] : [],
      features_2d: features,
    };
  });
}
