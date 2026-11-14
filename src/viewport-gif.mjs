import {check} from './core.mjs';
// A fixed colour cube and grey ramp avoid palette flicker across frames.
const palette=[];
for(let r=0;r<6;r++)for(let g=0;g<6;g++)for(let b=0;b<6;b++)palette.push(r*51,g*51,b*51);
for(let i=0;i<39;i++)palette.push(...Array(3).fill(Math.round(i*255/38)));
palette.push(0,0,0); // Index 255 is transparent.
const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export function gifIndices(rgba,width,transparent=false){
 check(rgba.length%4===0,'Invalid capture pixels.');const out=new Uint8Array(rgba.length/4);
 for(let i=0;i<out.length;i++){
  if(transparent&&rgba[i*4+3]<128){out[i]=255;continue;}
  const d=(bayer[(i%width&3)+((Math.floor(i/width)&3)*4)]-7.5)*1.4,r=Math.max(0,Math.min(255,rgba[i*4]+d)),g=Math.max(0,Math.min(255,rgba[i*4+1]+d)),b=Math.max(0,Math.min(255,rgba[i*4+2]+d)),ri=Math.round(r/51),gi=Math.round(g/51),bi=Math.round(b/51),grey=Math.round((r+g+b)/3/255*38),v=grey*255/38;
  out[i]=(r-v)**2+(g-v)**2+(b-v)**2<(r-ri*51)**2+(g-gi*51)**2+(b-bi*51)**2?216+grey:ri*36+gi*6+bi;
 }return out;
}
export function gifLzw(indices){
 check(indices.length>0,'Empty GIF frame.');const bytes=[];let bits=0,count=0,width=9,decoderNext=258,seen=false;
 const emit=code=>{bits|=code<<count;count+=width;while(count>=8){bytes.push(bits&255);bits>>>=8;count-=8;}if(code===256){width=9;decoderNext=258;seen=false;}else if(code!==257){if(seen){decoderNext++;if(decoderNext===1<<width&&width<12)width++;}else seen=true;}};
 let dict=new Map(),next=258,prefix=indices[0];emit(256);
 for(let i=1;i<indices.length;i++){const k=indices[i],key=prefix*256+k,code=dict.get(key);if(code!==undefined){prefix=code;continue;}emit(prefix);if(next<4096)dict.set(key,next++);else{emit(256);dict=new Map();next=258;}prefix=k;}
 emit(prefix);emit(257);if(count)bytes.push(bits&255);return new Uint8Array(bytes);
}
export class GifWriter {
 constructor(width,height,{loop=true,transparent=false,maxBytes=64*1024**2}={}){
  check(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=2048&&height<=2048,'Invalid GIF dimensions.');Object.assign(this,{width,height,transparent,maxBytes,parts:[],bytes:0,frames:0});
  this.push(new TextEncoder().encode('GIF89a'));this.push([width&255,width>>8,height&255,height>>8,0xf7,transparent?255:0,0]);this.push(palette);
  if(loop)this.push([0x21,0xff,11,...new TextEncoder().encode('NETSCAPE2.0'),3,1,0,0,0]);
 }
 push(value){const bytes=value instanceof Uint8Array?value:new Uint8Array(value);check(this.bytes+bytes.length<=this.maxBytes,'GIF exceeds 64 MiB. Choose a smaller size, fewer frames or a shorter range.');this.parts.push(bytes);this.bytes+=bytes.length;}
 add(rgba,delay){check(rgba.length===this.width*this.height*4,'GIF frame dimensions changed.');check(Number.isInteger(delay)&&delay>=1&&delay<=65535,'Invalid GIF frame delay.');
  this.push([0x21,0xf9,4,8+(this.transparent?1:0),delay&255,delay>>8,255,0]);this.push([0x2c,0,0,0,0,this.width&255,this.width>>8,this.height&255,this.height>>8,0,8]);
  const compressed=gifLzw(gifIndices(rgba,this.width,this.transparent));for(let i=0;i<compressed.length;i+=255){const chunk=compressed.subarray(i,i+255);this.push([chunk.length]);this.push(chunk);}this.push([0]);this.frames++;
 }
 finish(){check(this.frames>0,'GIF has no frames.');this.push([0x3b]);return new Blob(this.parts,{type:'image/gif'});}
}
