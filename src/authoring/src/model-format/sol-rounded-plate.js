/** Shared bevelled armour/clothing plate. Unit half-extents, authored UVs.
 * Only native characterPlate nodes use this; general SOL boxes stay boxes.
 */
let cached;
export function createSolRoundedPlateGeometry(){
 if(cached)return cached;
 const positions=[],normals=[],uvs=[],indices=[],segments=4,radius=.22,core=1-radius;
 for(const [axis,sign,u,v] of [[0,1,1,2],[0,-1,1,2],[1,1,0,2],[1,-1,0,2],[2,1,0,1],[2,-1,0,1]]){
  const base=positions.length/3;
  for(let row=0;row<=segments;row++)for(let col=0;col<=segments;col++){
   const p=[0,0,0];p[axis]=sign;p[u]=2*col/segments-1;p[v]=2*row/segments-1;
   const center=p.map(x=>Math.max(-core,Math.min(core,x))),d=p.map((x,i)=>x-center[i]),l=Math.hypot(...d);
   const n=d.map(x=>x/l);positions.push(...center.map((x,i)=>x+n[i]*radius));normals.push(...n);uvs.push(col/segments,row/segments);
  }
  for(let row=0;row<segments;row++)for(let col=0;col<segments;col++){
   const a=base+row*(segments+1)+col,b=a+1,c=a+segments+1,d=c+1;
   const orientation=(axis===1?-1:1)*sign;
   if(orientation>0)indices.push(a,b,d,a,d,c);else indices.push(a,d,b,a,c,d);
  }
 }
 return cached={positions,normals,indices,uvs};
}
