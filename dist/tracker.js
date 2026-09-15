export const PRESETS = {red: 0, teal: 88, yellow: 29, purple: 143};

export function hueRanges(hue, tolerance) {
  const lo = hue - tolerance, hi = hue + tolerance;
  if (lo < 0) return [[0, hi], [180 + lo, 179]];
  if (hi > 179) return [[lo, 179], [0, hi - 180]];
  return [[lo, hi]];
}

export class BallTracker {
  constructor(cv) { this.cv = cv; this.reset(); }
  reset() { this.previous = null; }
  detect(canvas, time, config) {
    const cv = this.cv, owned = [];
    const own = x => (owned.push(x), x);
    try {
      const src = own(cv.imread(canvas)), rgb = own(new cv.Mat()), hsv = own(new cv.Mat());
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const mask = own(cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1));
      for (const [lo, hi] of hueRanges(config.hue, config.tolerance)) {
        const low = own(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [lo, config.saturation, 45, 0]));
        const high = own(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [hi, 255, 255, 255]));
        const part = own(new cv.Mat());
        cv.inRange(hsv, low, high, part); cv.bitwise_or(mask, part, mask);
      }
      const kernel = own(cv.Mat.ones(3, 3, cv.CV_8U));
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
      const contours = own(new cv.MatVector()), hierarchy = own(new cv.Mat());
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const previous = this.previous && time - this.previous.t < 0.25 ? this.previous : null;
      let best = null;
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          const area = cv.contourArea(contour), perimeter = cv.arcLength(contour, true);
          if (area < 20 || area > src.rows * src.cols * 0.10 || !perimeter) continue;
          const circularity = Math.min(1, 4 * Math.PI * area / (perimeter * perimeter));
          const rect = cv.boundingRect(contour), aspect = Math.max(rect.width / rect.height, rect.height / rect.width);
          if (circularity < 0.25 || aspect > 3.5) continue;
          const m = cv.moments(contour); if (!m.m00) continue;
          const x = m.m10 / m.m00, y = m.m01 / m.m00;
          const distance = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
          const gate = previous ? Math.max(80, (time - previous.t) * src.cols * 5) : Infinity;
          if (distance > gate) continue;
          const continuity = previous ? Math.max(0, 1 - distance / gate) : 0.5;
          const score = 0.65 * circularity + 0.35 * continuity;
          const rank = previous ? score : score * Math.sqrt(area);
          if (!best || rank > best.rank) best = {x, y, radius: Math.sqrt(area / Math.PI), score, rank, t: time};
        } finally { contour.delete(); }
      }
      if (best) this.previous = best;
      return best;
    } finally { owned.reverse().forEach(x => x.delete()); }
  }
}
