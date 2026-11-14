import * as THREE from '../vendor/three-0.160.1/build/three.module.js';

// Small local studio environment: useful reflections on metal and glass without
// external HDR downloads. It belongs to the preview, never to exported meshes.
export function studioEnvironment(renderer) {
  const width=256,height=128,pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/width,v=y/height,sky=.12+.28*Math.max(0,1-v*1.5);
    const key=Math.exp(-(((u-.2)/.055)**2+((v-.33)/.17)**2)),fill=.65*Math.exp(-(((u-.72)/.09)**2+((v-.4)/.21)**2)),light=Math.min(1,sky+key+fill),i=(y*width+x)*4;
    pixels[i]=Math.round(light*242);pixels[i+1]=Math.round(light*248);pixels[i+2]=Math.round(light*255);pixels[i+3]=255;
  }
  const source=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);source.colorSpace=THREE.SRGBColorSpace;source.mapping=THREE.EquirectangularReflectionMapping;source.needsUpdate=true;
  const generator=new THREE.PMREMGenerator(renderer);
  try{return generator.fromEquirectangular(source);}finally{source.dispose();generator.dispose();}
}
