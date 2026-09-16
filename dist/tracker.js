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
      const saturated = maskFor(Math.min(40,config.tolerance*1.5),Math.min(240,config.saturation+60));
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
      for (const [maskSource,mask] of [['core',core],['broad',broad],['shape',shapeMask],['saturated',saturated]]) {
        const contours=own(new cv.MatVector()), hierarchy=own(new cv.Mat());
        cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        for (let i=0;i<contours.size();i++) {
          const contour=contours.get(i);
          try {
            const area=cv.contourArea(contour), perimeter=cv.arcLength(contour,true);
            if (area<20 || area>src.rows*src.cols*.25 || !perimeter) continue;
            let circularity=Math.min(1,4*Math.PI*area/(perimeter*perimeter));
            const rect=cv.boundingRect(contour), box=cv.minAreaRect(contour);
            const minor=Math.min(box.size.width,box.size.height), major=Math.max(box.size.width,box.size.height);
            if (minor<2) continue;
            const aspect=major/minor;
            if (circularity<.12 || aspect>7) continue;
            const m=cv.moments(contour); if(!m.m00)continue;
            const x=m.m10/m.m00, y=m.m01/m.m00;
            const circle=cv.minEnclosingCircle(contour);
            let circleFill=area/(Math.PI*circle.radius*circle.radius);
            // Texture and small finger occlusions roughen a real ball's boundary.
            // Only use the convex outline when the observed region is mostly solid.
            const hull=new cv.Mat();
            try {
              cv.convexHull(contour,hull);
              const hullArea=cv.contourArea(hull), hullPerimeter=cv.arcLength(hull,true);
              if(hullArea>0 && area/hullArea>=.85 && hullPerimeter>0){
                circularity=Math.max(circularity,Math.min(1,4*Math.PI*hullArea/(hullPerimeter*hullPerimeter)));
                circleFill=Math.max(circleFill,hullArea/(Math.PI*circle.radius*circle.radius));
              }
            } finally {hull.delete();}
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
              sizeRadius:aspect>1.8?minor/2:radius,colourScore:count?Math.max(0,.7*colourSum/count+.3*saturationSum/count):0});
          } finally {contour.delete();}
        }
      }
      // Independent object proposals: contrast-enhanced luminance edges, then
      // colour occupancy and surrounding-background checks on the ORIGINAL pixels.
      const gray=own(new cv.Mat()), contrast=own(new cv.Mat()), reduced=own(new cv.Mat()), circles=own(new cv.Mat());
      cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
      cv.equalizeHist(gray,contrast);
      const scale=src.cols/320;
      cv.resize(contrast,reduced,new cv.Size(320,Math.round(src.rows/scale)),0,0,cv.INTER_AREA);
      cv.GaussianBlur(reduced,reduced,new cv.Size(5,5),1.2);
      const edges=own(new cv.Mat()), natural=own(new cv.Mat());
      cv.resize(gray,natural,reduced.size(),0,0,cv.INTER_AREA);
      cv.GaussianBlur(natural,natural,new cv.Size(5,5),1.2);
      cv.Canny(natural,edges,30,70);
      cv.HoughCircles(reduced,circles,cv.HOUGH_GRADIENT,1,6,100,16,3,Math.round(Math.min(src.rows,src.cols)*.3/scale));
      const matches=(x,y)=>x>=0&&x<src.cols&&y>=0&&y<src.rows&&shapeMask.data[y*src.cols+x]>0;
      for(let i=0;i<circles.data32F.length;i+=3){
        const x=circles.data32F[i]*scale,y=circles.data32F[i+1]*scale,radius=circles.data32F[i+2]*scale;
        // A fitted circle must also agree with a segmented, round region.
        // Hough votes alone can invent circles across unrelated wall edges.
        const segmented=candidates.some(c=>c.circularity>=.7&&c.circleFill>=.72&&c.aspect<=1.8&&
          Math.hypot(c.x-x,c.y-y)<radius*.4&&Math.abs(c.radius-radius)<radius*.35);
        if(!segmented)continue;
        let edgeSupport=0;
        for(let k=0;k<48;k++){
          const angle=k*Math.PI/24;let found=false;
          for(let offset=-2;offset<=2;offset++){
            const ex=Math.round(x/scale+(radius/scale+offset)*Math.cos(angle));
            const ey=Math.round(y/scale+(radius/scale+offset)*Math.sin(angle));
            if(ex>=0&&ex<edges.cols&&ey>=0&&ey<edges.rows&&edges.data[ey*edges.cols+ex])found=true;
          }
          if(found)edgeSupport++;
        }
        if(edgeSupport<34)continue;
        let inside=0,outside=0,saturation=0;
        for(let k=0;k<32;k++){
          const a=k*Math.PI/16,dx=Math.cos(a),dy=Math.sin(a);
          for(const ring of [.2,.5,.8]){
            const px=Math.round(x+dx*radius*ring),py=Math.round(y+dy*radius*ring);
            if(matches(px,py)){inside++;saturation+=hsv.data[(py*src.cols+px)*3+1];}
          }
          if(matches(Math.round(x+dx*radius*1.3),Math.round(y+dy*radius*1.3)))outside++;
        }
        const fill=inside/96,background=outside/32;
        if(fill<.92 || background>.65 || saturation/Math.max(1,inside)<config.saturation+15)continue;
        candidates.push({x,y,radius,sizeRadius:radius,area:Math.PI*radius*radius,circularity:.9,circleFill:fill,
          aspect:1,maskSource:'object',strongShape:true,colourScore:fill,large:false});
      }
      return this.motion.update(candidates,time,src.cols,src.rows,context);
    } finally {owned.reverse().forEach(x=>x.delete());}
  }
}
