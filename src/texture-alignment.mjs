import {check} from './core.mjs';
import {PROJECTION_AXES} from './builder-materials.mjs';
export const defaultAlignment=()=>({scale:1,widthScale:1,heightScale:1,offsetX:0,offsetY:0,flipX:false});
export function alignment(value={}){
 const a={...defaultAlignment(),...value};
 check(['scale','widthScale','heightScale'].every(k=>Number.isFinite(a[k])&&a[k]>=.01&&a[k]<=100),'Use positive image scales from 0.01 to 100.');
 check(['offsetX','offsetY'].every(k=>Number.isFinite(a[k])&&Math.abs(a[k])<=10),'Use image offsets from −10 to 10.');
 return {scale:a.scale,widthScale:a.widthScale,heightScale:a.heightScale,offsetX:a.offsetX,offsetY:a.offsetY,flipX:!!a.flipX};
}
/** Shared by the visible aligner and final baker, in model-projected coordinates. */
export function projectionFrame(minimum,maximum,direction,imageWidth,imageHeight,value={}){
 const a=alignment(value),axes=PROJECTION_AXES[direction];check(axes&&imageWidth>0&&imageHeight>0,'Choose a valid reference direction and image.');
 const minX=axes[1]>0?minimum[axes[0]]:-maximum[axes[0]],maxX=axes[1]>0?maximum[axes[0]]:-minimum[axes[0]],minY=axes[3]>0?minimum[axes[2]]:-maximum[axes[2]],maxY=axes[3]>0?maximum[axes[2]]:-minimum[axes[2]];
 const width=maxX-minX,height=maxY-minY;check(width>1e-12&&height>1e-12,'Choose a view that shows the surface rather than its edge.');
 const base=Math.max(width,height*imageWidth/imageHeight)*a.scale;
 return {...a,axes,minX,minY,width,height,centreX:(minX+maxX)/2,centreY:(minY+maxY)/2,imageWidth:base*a.widthScale,imageHeight:base*imageHeight/imageWidth*a.heightScale};
}
export function sourceUv(frame,x,y){let u=(x-frame.centreX)/frame.imageWidth+.5-frame.offsetX;if(frame.flipX)u=1-u;return [u,(y-frame.centreY)/frame.imageHeight+.5-frame.offsetY];}
