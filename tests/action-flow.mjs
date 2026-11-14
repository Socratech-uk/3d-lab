import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {FLOW_FORMAT,ActionFlowRunner,flowPreset,createFlowNode,normalizeFlow,flowOrder,requiredFlowModels,parseFlow,stringifyFlow,FLOW_LIMITS} from '../src/action-flow.mjs';

const chain=(...types)=>{const nodes=types.map(createFlowNode);return {format:FLOW_FORMAT,version:1,name:'Test workflow',nodes,edges:nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id}))};};
const returns=kind=>async()=>({kind});
assert.equal(flowOrder(flowPreset()).length,7);
assert.deepEqual(requiredFlowModels(flowPreset()),['unirig','unimate']);
assert.equal(flowOrder(flowPreset('reuse'))[2].type,'accept');
assert.equal(flowOrder(flowPreset('reference'))[1].type,'model');
assert.equal(parseFlow(stringifyFlow(flowPreset())).format,FLOW_FORMAT);
{
 const plan=flowPreset('reference'),node=plan.nodes.find(n=>n.type==='model');node.config={model:'hunyuan3d-2mv',device:'cuda',resolution:512,seed:42,steps:75,guidanceScale:5.5,memoryMode:'cpu-offload',numChunks:4000,imagePadding:.05,unloadAfter:true};
 assert.deepEqual(parseFlow(stringifyFlow(plan)).nodes.find(n=>n.type==='model').config,node.config);
 node.config.imagePadding=.3;assert.throws(()=>normalizeFlow(plan));node.config.imagePadding=.05;
 node.config.model='triposr';assert.throws(()=>normalizeFlow(plan),/mesh resolution/);
}
assert.throws(()=>parseFlow(' '.repeat(FLOW_LIMITS.bytes+1)),/256 KiB/);
let f=chain('current','review','save');f.edges.push({from:f.nodes[2].id,to:f.nodes[1].id});assert.throws(()=>normalizeFlow(f),/one incoming/);
f=chain('current','review','save');f.edges=[{from:f.nodes[1].id,to:f.nodes[2].id},{from:f.nodes[2].id,to:f.nodes[1].id}];assert.throws(()=>normalizeFlow(f),/cycle/);
f=chain('reference','save');assert.throws(()=>normalizeFlow(f),/matching ports/);
f=chain('current','review');f.edges=[];assert.equal(normalizeFlow(f).nodes.length,2);assert.throws(()=>flowOrder(f),/Connect every node/);
f=chain('current','motions');f.nodes[1].config.actions[0].durationSeconds=10;f.nodes[1].config.model='momask';assert.throws(()=>normalizeFlow(f),/9.6/);
f=chain('current','motions');f.nodes[1].config.actions[0].prompt='';assert.throws(()=>normalizeFlow(f),/name and movement/);
f=chain('current','equipment');f.nodes[1].config.actions=['hold','hold'];assert.throws(()=>normalizeFlow(f),/distinct/);
f=chain('current','reuse');f.nodes[1].config.scale=9;assert.throws(()=>normalizeFlow(f),/0 to 4/);
f=chain('current','review');f.policy={autoApplyJoints:true,acceptedModels:['unimate']};assert.equal(normalizeFlow(f).policy,undefined);

let calls=[],changes=[];
let runner=new ActionFlowRunner({current:async()=>{calls.push('current');return {kind:'character',summary:'Character loaded'};},review:async({input,approved})=>{assert(approved);calls.push('review');return input;},save:async({input})=>{calls.push('save');return input;}},{onChange:state=>changes.push(state.status)});
let state=await runner.start(chain('current','review','save'));
assert.equal(state.status,'paused');assert.deepEqual(calls,['current']);assert.equal(state.nodes[0].summary,'Character loaded');assert.equal(state.nodes[0].output,undefined);
await assert.rejects(runner.start(chain('current')),/Finish or cancel/);
state=await runner.resume();assert.equal(state.status,'completed');assert.deepEqual(calls,['current','review','save']);assert(changes.includes('running'));

calls=[];runner=new ActionFlowRunner({current:async()=>{calls.push('current');return {kind:'character'};}});
await assert.rejects(runner.start(chain('current','save')),/unavailable/);assert.deepEqual(calls,[]);
runner=new ActionFlowRunner({current:returns('character'),motions:returns('character')});await assert.rejects(runner.start(chain('current','motions')),/terms for unimate/);assert.equal(runner.status,'idle');
state=await runner.start(chain('current','motions'),{acceptedModels:['unimate']});assert.equal(state.status,'completed');

const gateFlow=chain('current','accept','bind','review');gateFlow.nodes[1].config.autoApply=true;
runner=new ActionFlowRunner({current:returns('character'),accept:returns('character'),bind:returns('character'),review:returns('character')});
state=await runner.start(gateFlow);assert.equal(state.nodeId,gateFlow.nodes[1].id);state=await runner.resume();assert.equal(state.nodeId,gateFlow.nodes[2].id);state=await runner.resume();assert.equal(state.nodeId,gateFlow.nodes[3].id);await runner.resume();
state=await runner.start(gateFlow,{autoApplyJoints:true,autoBindWeights:true});assert.equal(state.status,'paused');assert.equal(state.nodeId,gateFlow.nodes[3].id);runner.cancel();

let attempts=0;
runner=new ActionFlowRunner({current:returns('character'),save:async({previousOutput,checkpoint,attempt})=>{attempts++;assert.equal(attempt,attempts);if(attempts===1){checkpoint({kind:'character',savedIds:['retained-clip']});throw new Error('Disk full');}assert.deepEqual(previousOutput.savedIds,['retained-clip']);return previousOutput;}});
state=await runner.start(chain('current','save'));assert.equal(state.status,'failed');assert.match(state.message,/Disk full/);state=await runner.retry();assert.equal(state.status,'completed');assert.equal(attempts,2);
runner=new ActionFlowRunner({current:async()=>({wrong:true})});state=await runner.start(chain('current'));assert.equal(state.status,'failed');assert.match(state.message,/valid character/);

let release,signalSeen;calls=[];runner=new ActionFlowRunner({current:async({signal,progress})=>{signalSeen=signal;await new Promise(r=>release=r);progress('Late progress ignored');return {kind:'character'};},save:async()=>{calls.push('save');return {kind:'character'};}});
const pending=runner.start(chain('current','save'));assert.equal(runner.status,'running');runner.cancel();assert(signalSeen.aborted);release();await pending;assert.equal(runner.status,'cancelled');assert.deepEqual(calls,[]);assert.doesNotMatch(runner.message,/Late progress/);
runner=new ActionFlowRunner({current:returns('character'),review:returns('character')});await runner.start(chain('current','review'));runner.cancel();await assert.rejects(runner.resume(),/not waiting/);
console.log('Action flow tests passed: typed graphs, scoped consent, review gates, errors, retry checkpoints and cancellation.');
