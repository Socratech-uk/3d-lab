import {bodyFixture} from './body-fixtures.mjs';
import {createJoint} from '../src/action-document.mjs';
import {autoBind} from '../src/action-geometry.mjs';
import {FACINGS,turnPosition} from '../src/action-anatomy.mjs';

/** Synthetic 24-joint dog-like tree, not a captured UniRig prediction. Four
 * additional hocks and a third, ground-reaching tail joint exercise detail. */
export function animalFixture({facing='+Z',generic=true,tail=true,shuffle=false,transform=true,longTail=true}={}){
 const {base,doc,ids}=bodyFixture('quadruped'),byName=new Map(doc.joints.map(j=>[j.name,j]));
 const position=(name,p)=>byName.get(name).position=p;
 for(const [name,p]of Object.entries({Hips:[0,.95,-.5],Spine:[0,1,0],Chest:[0,1.05,.6],Neck:[0,1.4,.9],Head:[0,1.55,1.05],Tail:[0,.95,-.7],TailTip:[0,.04,-3.7]}))position(name,p);
 const middle=createJoint([0,.4,-1.5],ids.Tail,'TailMiddle');byName.get('TailTip').parent=middle.id;doc.joints.push(middle);ids.TailMiddle=middle.id;
 if(!longTail){middle.position=[0,.8,-.85];byName.get('TailTip').position=[0,.7,-1.05];}
 for(const side of ['Left','Right'])for(const end of ['Front','Back']){
  const prefix=side+end,x=side==='Left'?.24:-.24,z=end==='Front'?.6:-.5;
  position(prefix+'Upper',[x,.9,z]);position(prefix+'Lower',[x,.55,z+(end==='Back'?.12:-.1)]);position(prefix+'Foot',[x,.05,z+(end==='Front'?.08:0)]);
  const hock=createJoint([x,.22,z+(end==='Back'?-.12:-.05)],ids[prefix+'Lower'],prefix+'Hock');byName.get(prefix+'Foot').parent=hock.id;doc.joints.push(hock);ids[prefix+'Hock']=hock.id;
 }
 if(!tail)doc.joints=doc.joints.filter(j=>!j.name.startsWith('Tail'));
 doc.joints.forEach((j,i)=>{j.position=turnPosition(j.position,FACINGS[facing]);if(transform)j.position=j.position.map((v,k)=>v*2.3+[5,-2,7][k]);if(generic)j.name='Joint'+i;});
 if(shuffle)doc.joints=doc.joints.filter((_,i)=>i%2).reverse().concat(doc.joints.filter((_,i)=>!(i%2)).reverse());
 autoBind(base,doc);return {base,doc,ids};
}
