import {check,inspectGlb,imageDimensions} from './core.mjs';

/** Rewrite embedded colour images, never pass the rig through a mesh exporter. */
export function textureContainer(input){
  const {bytes,json}=inspectGlb(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const binary=28+view.getUint32(12,true);
  const buffer=index=>{const b=json.bufferViews[index];check(b,'Missing texture buffer.');return bytes.slice(binary+(b.byteOffset||0),binary+(b.byteOffset||0)+b.byteLength);};
  const layers=json.extras?.cappTextureLayers;
  check(!layers||layers.version===1,'This texture layer version is not supported.');
  if(layers){
    check(Array.isArray(layers.layers)&&layers.layers.length<=(json.images?.length||0),'Invalid texture layers.');
    const geometry=new Set(json.accessors.map(a=>a.bufferView)),reserved=new Set(),images=new Set();
    for(const layer of layers.layers){
      check(Number.isInteger(layer.image)&&json.images?.[layer.image]&&!images.has(layer.image),'Invalid layer image.');images.add(layer.image);
      check([layer.baseBufferView,layer.paintBufferView,layer.compositeBufferView].every(i=>Number.isInteger(i)&&json.bufferViews[i]&&!geometry.has(i)),'A texture layer must not reference geometry or animation buffers.');
      check(json.images[layer.image].bufferView===layer.compositeBufferView,'The texture layer composite does not match its image.');
      check(layer.paintBufferView!==layer.baseBufferView&&!reserved.has(layer.paintBufferView)&&!json.images.some(i=>i.bufferView===layer.paintBufferView),'Invalid paint layer buffer.');reserved.add(layer.paintBufferView);
      check(['image/png','image/jpeg'].includes(layer.baseMime),'Invalid base texture type.');
    }
  }
  return {bytes,json,buffer,layers:layers?.layers||[]};
}
export function textureLayer(container,imageIndex){
  const image=container.json.images?.[imageIndex];check(image,'Choose an embedded colour texture.');
  const shared=[];
  const visit=value=>{for(const [key,v]of Object.entries(value||{})){if(key==='extras')continue;if(key.endsWith('Texture')&&key!=='baseColorTexture'&&container.json.textures?.[v?.index]?.source===imageIndex)shared.push(key);else if(v&&typeof v==='object')visit(v);}};
  for(const material of container.json.materials||[])visit(material);
  check(!shared.length,'This image also supplies another material channel. Give base colour its own image before painting.');
  const saved=container.layers.find(l=>l.image===imageIndex),base=saved?container.buffer(saved.baseBufferView):container.buffer(image.bufferView);
  const mime=saved?.baseMime||image.mimeType,dims=imageDimensions(base,mime);
  check(base.length<=16*1024**2&&dims.width>0&&dims.height>0&&dims.width*dims.height<=24_000_000,'Use a base texture up to 16 MiB and 24 megapixels for touch-ups.');
  let paint=null;
  if(saved){check(Number.isFinite(saved.opacity)&&saved.opacity>=0&&saved.opacity<=1,'Invalid paint layer opacity.');paint=container.buffer(saved.paintBufferView);const p=imageDimensions(paint,'image/png');check(paint.length<=16*1024**2&&p.width===dims.width&&p.height===dims.height,'The paint layer must match its base texture and fit within 16 MiB.');}
  return {image:imageIndex,base,baseMime:mime,paint,opacity:saved?.opacity??1,...dims};
}
export function saveTextureLayers(input,changes){
  const container=textureContainer(input),json=structuredClone(container.json),blocks=json.bufferViews.map((_,i)=>container.buffer(i));
  const layers=structuredClone(container.layers),used=new Set();
  const append=data=>{const index=blocks.length;blocks.push(data);json.bufferViews.push({buffer:0,byteLength:data.length});return index;};
  for(const change of changes){
    check(Number.isInteger(change.image)&&!used.has(change.image),'Choose each texture once.');used.add(change.image);
    const existing=textureLayer(container,change.image),image=json.images[change.image];
    check(['composite','paint'].every(k=>change[k] instanceof Uint8Array),'Texture layers require encoded PNG bytes.');
    for(const k of ['composite','paint']){const d=imageDimensions(change[k],'image/png');check(d.width===existing.width&&d.height===existing.height,'Texture dimensions must stay unchanged.');check(change[k].length<=16*1024**2,'Use a texture image up to 16 MiB.');}
    check(Number.isFinite(change.opacity)&&change.opacity>=0&&change.opacity<=1,'Use layer opacity from 0 to 1.');
    let layer=layers.find(l=>l.image===change.image);
    if(!layer){layer={image:change.image,baseBufferView:image.bufferView,baseMime:existing.baseMime,paintBufferView:append(change.paint),opacity:change.opacity};layers.push(layer);}
    else blocks[layer.paintBufferView]=change.paint;
    layer.opacity=change.opacity;
    // A source bufferView can be shared by images or accessors. Give the composite
    // its own slot on the first edit rather than replacing an unrelated payload.
    if(!layer.compositeBufferView&&layer.compositeBufferView!==0)layer.compositeBufferView=append(change.composite);
    else blocks[layer.compositeBufferView]=change.composite;
    image.bufferView=layer.compositeBufferView;image.mimeType='image/png';
  }
  json.extras={...json.extras,cappTextureLayers:{version:1,layers}};
  let size=0;for(let i=0;i<blocks.length;i++){size=(size+3)&~3;json.bufferViews[i]={...json.bufferViews[i],buffer:0,byteOffset:size,byteLength:blocks[i].length};size+=blocks[i].length;}
  json.buffers[0].byteLength=size;const binSize=(size+3)&~3,encoded=new TextEncoder().encode(JSON.stringify(json)),jsonSize=(encoded.length+3)&~3;
  const out=new Uint8Array(28+jsonSize+binSize),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,jsonSize,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonSize);out.set(encoded,20);v.setUint32(20+jsonSize,binSize,true);v.setUint32(24+jsonSize,0x004e4942,true);
  for(let i=0;i<blocks.length;i++)out.set(blocks[i],28+jsonSize+json.bufferViews[i].byteOffset);
  inspectGlb(out);return out;
}
