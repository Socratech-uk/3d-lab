import assert from 'node:assert/strict';
import { actionAssetRows,actionAssetSummary } from '../src/action-assets.mjs';

const asset=(id,title,origin,extra={})=>({id,title,origin,folder:'',tags:[],notes:'',createdAt:'2026-10-15T10:00:00Z',triangles:100,byteLength:2048,...extra});
const rows=[
  asset('a','Window hinge','edit',{folder:'Ships',tags:['mechanical'],notes:'Port window'}),
  asset('b','Runner','action',{folder:'People',tags:['human'],createdAt:'2026-10-15T11:00:00Z',action:{joints:21,clips:3}}),
  asset('c','Animal','generation',{folder:'Animals',tags:['quadruped']}),
  asset('d','<img src=x onerror=alert(1)>','import'),
  asset('e','Vessel','shape',{shape:{parts:2}})
];
const before=structuredClone(rows);
assert.deepEqual(actionAssetRows(rows,{query:'WINDOW MECHANICAL',folder:'Ships',type:'edit'}).map(r=>r.id),['a']);
assert.deepEqual(actionAssetRows(rows,{type:'action'}).map(r=>r.id),['b']);
assert.equal(actionAssetRows(rows,{sort:'recent'})[0].id,'b');
assert.deepEqual(actionAssetRows(rows,{sort:'name'}).map(r=>r.id),['d','c','b','e','a']);
assert.deepEqual(actionAssetRows(rows,{folder:'People',query:'animal'}),[]);
assert.deepEqual(rows,before,'Browsing must not mutate library metadata');
assert.match(actionAssetSummary(rows[1]).detail,/21 joints.*3 saved actions/);
assert.match(actionAssetSummary(rows[1]).guidance,/mesh, joints, weights and saved actions/);
assert.match(actionAssetSummary(rows[4]).guidance,/shape recipe in Shape Lab/);
assert.match(actionAssetSummary(rows[3]).guidance,/supported skeleton and actions/);
assert.equal(actionAssetSummary(rows[3]).title,rows[3].title,'Render names as text, never interpolate into markup');
assert.equal(actionAssetSummary({...rows[0],origin:'future'}).kind,'Saved model');
console.log('PASS Action asset metadata: combined filters, sort, immutable input, honest origin guidance (12 assertions)');
