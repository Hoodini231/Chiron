import {BallMotion} from './ball-motion.js';
export const PRESETS = {red: 0, teal: 88, yellow: 29, purple: 143};

export function hueRanges(hue, tolerance) {
  const lo = hue - tolerance, hi = hue + tolerance;
  if (lo < 0) return [[0, hi], [180 + lo, 179]];
  if (hi > 179) return [[lo, 179], [0, hi - 180]];
  return [[lo, hi]];
}

export class BallTracker {
  constructor(cv) { this.cv = cv; this.motion = new BallMotion(); }
  reset() { this.motion.reset(); }
  seed(x, y, time) { this.motion.seed(x, y, time); }
  get status() { return this.motion.status; }
  detect(canvas, time, config, context = {}) {
    const cv = this.cv, owned = [];
    const own = x => (owned.push(x), x);
    try {
      const src = own(cv.imread(canvas)), rgb = own(new cv.Mat()), hsv = own(new cv.Mat());
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const kernel = own(cv.Mat.ones(3, 3, cv.CV_8U));
      function maskFor(tolerance, saturation) {
        const mask = own(cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1));
        for (const [lo, hi] of hueRanges(config.hue, tolerance)) {
          const low = own(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [lo, saturation, 45, 0]));
          const high = own(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [hi, 255, 255, 255]));
          const part = own(new cv.Mat());
          cv.inRange(hsv, low, high, part); cv.bitwise_or(mask, part, mask);
        }
        cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
        return mask;
      }
      // Strong colour cores separate the ball from similarly coloured skin/clothes.
      // Broad colours support tracking; a wider search can acquire only strongly round candidates.
      const core = maskFor(Math.max(3,config.tolerance*.55),Math.min(255,config.saturation+30));
      const broad = maskFor(config.tolerance,config.saturation);
      const shapeMask = maskFor(Math.min(40,config.tolerance*1.5),config.saturation);
      if (context.isolationCanvas) {
        const gray=own(new cv.Mat()), isolated=own(new cv.Mat());
        cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
        cv.convertScaleAbs(gray,gray,.4,0);
        cv.cvtColor(gray,isolated,cv.COLOR_GRAY2RGBA);
        src.copyTo(isolated,shapeMask);
        cv.imshow(context.isolationCanvas,isolated);
      }
      const candidates = [];
      for (const [maskSource,mask] of [['core',core],['broad',broad],['shape',shapeMask]]) {
        const contours=own(new cv.MatVector()), hierarchy=own(new cv.Mat());
        cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        for (let i=0;i<contours.size();i++) {
          const contour=contours.get(i);
          try {
            const area=cv.contourArea(contour), perimeter=cv.arcLength(contour,true);
            if (area<20 || area>src.rows*src.cols*.25 || !perimeter) continue;
            const circularity=Math.min(1,4*Math.PI*area/(perimeter*perimeter));
            const rect=cv.boundingRect(contour), box=cv.minAreaRect(contour);
            const minor=Math.min(box.size.width,box.size.height), major=Math.max(box.size.width,box.size.height);
            if (minor<2) continue;
            const aspect=major/minor;
            if (circularity<.12 || aspect>7) continue;
            const m=cv.moments(contour); if(!m.m00)continue;
            const x=m.m10/m.m00, y=m.m01/m.m00;
            const circle=cv.minEnclosingCircle(contour);
            const circleFill=area/(Math.PI*circle.radius*circle.radius);
            const angle=.5*Math.atan2(2*m.mu11,m.mu20-m.mu02);
            let colourSum=0,saturationSum=0,count=0;
            const stride=Math.max(1,Math.ceil(Math.sqrt(rect.width*rect.height/144)));
            for(let py=rect.y;py<rect.y+rect.height;py+=stride) for(let px=rect.x;px<rect.x+rect.width;px+=stride) {
              const pixel=py*src.cols+px;
              if(!mask.data[pixel])continue;
              const difference=Math.abs(hsv.data[pixel*3]-config.hue);
              colourSum+=1-Math.min(difference,180-difference)/Math.max(1,config.tolerance);
              saturationSum+=hsv.data[pixel*3+1]/255;count++;
            }
            const radius=Math.sqrt(area/Math.PI);
            candidates.push({x,y,radius,area,circularity,circleFill,aspect,maskSource,axis:{x:Math.cos(angle),y:Math.sin(angle)},
              large:area>src.rows*src.cols*.10,
              strongShape:circularity>=.7 && circleFill>=.72 && aspect<=1.5 && count>0 && saturationSum/count*255>=Math.min(255,config.saturation+30),
              sizeRadius:aspect>2.5?minor/2:radius,colourScore:count?Math.max(0,.7*colourSum/count+.3*saturationSum/count):0});
          } finally {contour.delete();}
        }
      }
      return this.motion.update(candidates,time,src.cols,src.rows,context);
    } finally {owned.reverse().forEach(x=>x.delete());}
  }
}
