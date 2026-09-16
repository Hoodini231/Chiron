// All geometry in this module uses the detector image's pixels and seconds.
const clamp = (value) => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const valid = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);

export function handAnchors(context, width, height) {
  const anchors = [];
  for (const [index, hand] of (context.hands ?? []).entries()) {
    const points = (hand.landmarks ?? [])
      .filter(valid)
      .map((p) => ({ x: p.x * width, y: p.y * height }));
    if (points.length !== 21) continue;
    const palm = [0, 5, 9, 13, 17].map((i) => points[i]);
    const centre = {
      x: palm.reduce((sum, p) => sum + p.x, 0) / 5,
      y: palm.reduce((sum, p) => sum + p.y, 0) / 5,
    };
    const side = hand.associated_pose_side;
    anchors.push({
      ...centre,
      points,
      radius: Math.max(4, ...palm.map((p) => distance(p, centre))),
      id: side ? `pose:${side}` : `hand:${index}`,
      side: side ?? null,
      source: 'hand_landmarks',
      reliability: 1,
    });
  }
  for (const [side, index] of [
    ['left', 15],
    ['right', 16],
  ]) {
    const wrist = context.pose?.[index];
    if (!valid(wrist) || (wrist.visibility ?? 0) < 0.6 || (wrist.presence ?? 1) < 0.5) continue;
    if (anchors.some((a) => a.side === side)) continue;
    const point = { x: wrist.x * width, y: wrist.y * height };
    anchors.push({
      ...point,
      points: [point],
      radius: 6,
      id: `pose:${side}`,
      side,
      source: 'pose_wrist',
      reliability: 0.55,
    });
  }
  return anchors;
}

function proximity(candidate, anchor) {
  const gap = Math.min(...anchor.points.map((p) => distance(candidate, p)));
  const reach = candidate.sizeRadius * 1.8 + anchor.radius * 0.5 + 8;
  return { anchor, gap, reach, closeness: clamp(1 - gap / (reach * 2)) * anchor.reliability };
}

export class BallMotion {
  constructor() {
    this.nextId = 0;
    this.reset();
  }
  reset() {
    this.last = null;
    this.velocity = { x: 0, y: 0 };
    this.phase = 'searching';
    this.owner = null;
    this.separation = null;
    this.separationCount = 0;
    this.status = { state: 'searching', phase: 'searching', prediction: null, track_id: null };
    this.hint = null;
    this.lastTime = null;
  }
  seed(x, y, time) {
    this.reset();
    if ([x, y, time].every(Number.isFinite)) this.hint = { x, y, t: time };
  }
  update(candidates, time, width, height, context = {}) {
    if (!Number.isFinite(time)) return null;
    if (this.lastTime !== null && time <= this.lastTime) {
      if (time < this.lastTime) this.reset();
      else return null;
    }
    this.lastTime = time;
    // Never carry an identity indefinitely through an occlusion or camera pause.
    if (this.last && time - this.last.t > 0.5) this.reset();
    this.lastTime = time;
    const anchors = handAnchors(context, width, height),
      previous = this.last;
    const dt = previous ? time - previous.t : 0;
    const predicted = previous
      ? { x: previous.x + this.velocity.x * dt, y: previous.y + this.velocity.y * dt }
      : null;
    const owner =
      this.owner &&
      anchors.find(
        (a) => a.id === this.owner.id && distance(a, this.owner) < Math.hypot(width, height) * 0.35,
      );
    // Hands help acquisition and phase labels, but never move an established ball track.
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const gate = previous
      ? Math.max(24, previous.sizeRadius * 3) + width * dt * 0.6 + speed * dt * 0.65
      : Infinity;
    // Launch can accelerate sharply before velocity has been established.
    const searchGate =
      previous && this.phase !== 'flight'
        ? Math.max(gate, width * dt * 2.5, previous.sizeRadius * 4)
        : gate;
    const hint =
      this.hint && time - this.hint.t < 1
        ? { x: this.hint.x * width, y: this.hint.y * height }
        : null;
    let best = null;
    for (const candidate of candidates) {
      const c = { ...candidate, sizeRadius: candidate.sizeRadius ?? candidate.radius };
      const aspect = c.aspect ?? 1,
        circularity = c.circularity ?? 1;
      if (
        !previous &&
        !hint &&
        (circularity < 0.5 ||
          (c.circleFill ?? 1) < 0.55 ||
          c.maskSource === 'broad' ||
          ((c.maskSource === 'shape' || c.maskSource === 'saturated' || c.large) && !c.strongShape))
      )
        continue;
      const residual = predicted ? distance(c, predicted) : 0;
      if (previous && residual > searchGate) continue;
      // Elongated streaks are accepted only when supported by a moving track.
      const blurred = aspect > 1.8;
      // Colour alone must never sustain a track on clothing or a wall.
      if (!blurred && (circularity < 0.7 || (c.circleFill ?? 1) < 0.72)) continue;
      if (blurred && (!previous || speed < width * 0.2 || residual > searchGate * 0.7)) continue;
      if (blurred && c.axis && speed > 0) {
        const alignment = Math.abs(
          (c.axis.x * this.velocity.x + c.axis.y * this.velocity.y) / speed,
        );
        if (alignment < 0.65) continue;
      }
      const ratio = previous ? c.sizeRadius / previous.sizeRadius : 1;
      if (previous && (ratio < 0.3 || ratio > 2.8)) continue;
      const near = anchors.map((a) => proximity(c, a)).sort((a, b) => b.closeness - a.closeness)[0];
      const colour = c.colourScore ?? 1;
      const shape = Math.min(clamp(circularity / 0.85), clamp((c.circleFill ?? 1) / 0.8));
      const size = previous
        ? Math.exp(-Math.abs(Math.log(ratio)))
        : clamp(Math.sqrt(c.area ?? Math.PI * c.radius * c.radius) / 35);
      const motion = predicted ? Math.exp(-2.5 * (residual / searchGate) ** 2) : 0;
      let score;
      if (previous) {
        // Release labels can lag the actual throw. Association must follow ball evidence
        // immediately, even while the heuristic phase still says near_hand.
        score = 0.62 * motion + 0.15 * size + 0.1 * colour + 0.13 * (blurred ? 0.7 : shape);
      } else {
        // Proximity alone must not turn a skin/clothing patch into a ball.
        score = anchors.length
          ? 0.25 * (near?.closeness ?? 0) + 0.4 * shape ** 2 + 0.3 * colour + 0.05 * size
          : 0.55 * shape ** 2 + 0.35 * colour + 0.1 * size;
        if (hint)
          score =
            0.4 * score +
            0.6 * Math.exp(-(distance(c, hint) ** 2) / (2 * Math.max(25, c.radius * 3) ** 2));
      }
      if (previous && score < 0.62) continue;
      if (!best || score > best.score) best = { ...c, score, near };
    }
    if (!best) {
      const canPredict =
        previous &&
        dt <= 0.2 &&
        predicted.x >= 0 &&
        predicted.x < width &&
        predicted.y >= 0 &&
        predicted.y < height;
      this.status = {
        state: canPredict ? 'predicted' : previous ? 'lost' : 'searching',
        phase: this.phase,
        track_id: previous?.track_id ?? null,
        prediction: canPredict
          ? { ...predicted, radius: previous.radius, t: time, observed: false, age_s: dt }
          : null,
      };
      // Only actual detections go into ball measurements and trajectory metrics.
      return null;
    }
    const id = previous?.track_id ?? ++this.nextId;
    const currentNear = best.near;
    let handEvidence = null;
    if (!previous) {
      this.phase =
        currentNear && currentNear.gap <= currentNear.reach ? 'near_hand' : 'unassociated';
      this.owner = this.phase === 'near_hand' ? currentNear.anchor : null;
      this.separation = currentNear?.gap ?? null;
    } else if (this.phase !== 'flight') {
      const reference = owner ? proximity(best, owner) : currentNear;
      if (reference) {
        handEvidence = reference;
        if (reference.gap <= reference.reach) {
          this.phase = 'near_hand';
          this.owner = reference.anchor;
          this.separationCount = 0;
        } else if (
          owner &&
          this.phase === 'near_hand' &&
          this.separation !== null &&
          reference.gap > this.separation + Math.max(3, best.sizeRadius * 0.2)
        ) {
          this.separationCount++;
          if (this.separationCount >= 2) this.phase = 'flight';
          this.owner = owner;
        } else {
          this.separationCount = 0;
          if (owner) this.owner = owner;
        }
        this.separation = reference.gap;
      } else {
        // Disappearing hand landmarks alone are not evidence of release.
        this.separationCount = 0;
      }
    }
    if (previous) {
      const measured = { x: (best.x - previous.x) / dt, y: (best.y - previous.y) / dt };
      const weight = previous.observations === 1 ? 1 : 0.7;
      this.velocity = {
        x: weight * measured.x + (1 - weight) * this.velocity.x,
        y: weight * measured.y + (1 - weight) * this.velocity.y,
      };
    }
    handEvidence ??= currentNear;
    const observed = {
      x: best.x,
      y: best.y,
      radius: best.radius,
      score: best.score,
      t: time,
      observed: true,
      track_id: id,
      tracking_phase: this.phase,
      hand_distance_px: handEvidence?.gap ?? null,
      hand_source: handEvidence?.anchor.source ?? null,
      hand_side: handEvidence?.anchor.side ?? null,
      blurred: best.aspect > 1.8,
      mask_source: best.maskSource ?? null,
    };
    this.last = {
      ...observed,
      sizeRadius: previous ? previous.sizeRadius * 0.75 + best.sizeRadius * 0.25 : best.sizeRadius,
      observations: (previous?.observations ?? 0) + 1,
    };
    this.hint = null;
    this.status = { state: 'observed', phase: this.phase, track_id: id, prediction: null };
    return observed;
  }
}
