export function throwSample(
  t,
  starts = [3, 11, 20],
  side = 'right',
  { ball = true, shift = 0 } = {},
) {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5 + shift,
    y: 0.5,
    visibility: 1,
    presence: 1,
  }));
  for (const [s, e, w, h] of [
    [11, 13, 15, 23],
    [12, 14, 16, 24],
  ]) {
    pose[s] = { x: 0.5 + shift, y: 0.35, visibility: 1 };
    pose[h] = { x: 0.5 + shift, y: 0.7, visibility: 1 };
    pose[e] = { x: 0.62 + shift, y: 0.36, visibility: 1 };
    pose[w] = { x: 0.48 + shift, y: 0.48, visibility: 1 };
  }
  let theta = 2.5,
    active = null;
  for (const start of starts) {
    const p = t - start;
    if (p >= 0 && p < 2.25) {
      active = p;
      if (p < 0.6) theta = 2.5 + p / 0.6;
      else if (p < 0.85) theta = 3.5 - ((p - 0.6) / 0.25) * 3.35;
      else if (p < 1.35) theta = 0.15 + ((p - 0.85) / 0.5) * 1.35;
      else theta = 1.5 + (p - 1.35) / 0.9;
    }
  }
  const wrist = side === 'left' ? 15 : 16;
  pose[wrist] = {
    x: 0.62 + shift + 0.17 * Math.cos(theta),
    y: 0.36 + 0.17 * Math.sin(theta),
    visibility: 1,
  };
  return {
    t_s: t,
    pose,
    hands: [],
    ball:
      ball && active !== null
        ? {
            x_px: 0,
            y_px: 0,
            observed: true,
            track_id: starts.findIndex((s) => t >= s && t < s + 2.25) + 1,
            hand_side: side,
            tracking_phase: active < 0.7 ? 'near_hand' : 'flight',
          }
        : null,
  };
}
export const throwSamples = (duration = 26, starts = [3, 11, 20], side = 'right', options = {}) =>
  Array.from({ length: Math.ceil(duration * 15) }, (_, i) =>
    throwSample(i / 15, starts, side, options),
  );
