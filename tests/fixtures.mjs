/** A real, tiny tetrahedron GLB. Test fixture only; never part of the runtime. */
export function fixtureGlb(mutator = () => {}) {
  const vertices = new Float32Array([0,1,0,-1,-1,1,1,-1,1,0,1,0,1,-1,1,0,-1,-1,0,1,0,0,-1,-1,-1,-1,1,-1,-1,1,0,-1,-1,1,-1,1]);
  const json = { asset:{version:'2.0',generator:'3D Lab test fixture'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}], meshes:[{primitives:[{attributes:{POSITION:0},mode:4}]}], buffers:[{byteLength:vertices.byteLength}], bufferViews:[{buffer:0,byteOffset:0,byteLength:vertices.byteLength}], accessors:[{bufferView:0,componentType:5126,count:12,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]}] };
  mutator(json);
  return packGlb(json,new Uint8Array(vertices.buffer));
}

/** Indexed, coloured surface above the old base64 validation stack limit.
 * Real GLB geometry, but deliberately synthetic: this is not neural output.
 */
export function fixtureLargeGlb(segments = 320) {
  const count=(segments+1)**2, positions=new Float32Array(count*3), normals=new Float32Array(count*3), colours=new Float32Array(count*3), indices=new Uint32Array(segments*segments*6);
  for(let row=0;row<=segments;row++) for(let col=0;col<=segments;col++) {
    const i=row*(segments+1)+col,x=col/segments*2-1,z=row/segments*2-1,y=.2*Math.cos(Math.PI*x)*Math.cos(Math.PI*z);
    const nx=.2*Math.PI*Math.sin(Math.PI*x)*Math.cos(Math.PI*z),nz=.2*Math.PI*Math.cos(Math.PI*x)*Math.sin(Math.PI*z),length=Math.hypot(nx,1,nz);
    positions.set([x,y,z],i*3);normals.set([nx/length,1/length,nz/length],i*3);colours.set([.35+col/segments*.4,.55,.75-row/segments*.2],i*3);
  }
  let cursor=0;
  for(let row=0;row<segments;row++) for(let col=0;col<segments;col++) {
    const a=row*(segments+1)+col,b=a+1,c=a+segments+1,d=c+1;
    indices.set([a,c,b,b,c,d],cursor);cursor+=6;
  }
  const arrays=[positions,normals,colours,indices], binary=new Uint8Array(arrays.reduce((sum,a)=>sum+a.byteLength,0)),bufferViews=[];
  cursor=0;
  for(const a of arrays){binary.set(new Uint8Array(a.buffer),cursor);bufferViews.push({buffer:0,byteOffset:cursor,byteLength:a.byteLength});cursor+=a.byteLength;}
  const json={asset:{version:'2.0',generator:'3D Lab large synthetic test fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},indices:3,mode:4}]}],buffers:[{byteLength:binary.byteLength}],bufferViews,accessors:[
    {bufferView:0,componentType:5126,count,type:'VEC3',min:[-1,-.2,-1],max:[1,.2,1]},
    {bufferView:1,componentType:5126,count,type:'VEC3'},
    {bufferView:2,componentType:5126,count,type:'VEC3'},
    {bufferView:3,componentType:5125,count:indices.length,type:'SCALAR'}
  ]};
  return packGlb(json,binary);
}

export function packGlb(json,binary) {
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(encoded.length/4)*4,size=12+8+jsonLength+8+binary.byteLength;
  const result=new Uint8Array(size),view=new DataView(result.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,size,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);
  result.fill(32,20,20+jsonLength);result.set(encoded,20);view.setUint32(20+jsonLength,binary.byteLength,true);view.setUint32(24+jsonLength,0x004e4942,true);result.set(binary,28+jsonLength);
  return result;
}
