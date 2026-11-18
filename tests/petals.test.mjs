import {test} from 'node:test';import assert from 'node:assert/strict';
import {blendPose,sampleJourney,selectionPose} from '../public/petal-model.js';
const a={x:40,y:90,r:0,s:1,o:1},b={x:330,y:480,r:30,s:.6,o:.5};
test('curves preserve both exact poses and remain reversible at section boundaries',()=>{
 const stops=[{at:0,poses:Array(5).fill(a)},{at:500,poses:Array(5).fill(b)},{at:800,poses:Array(5).fill(a)}];
 for(let i=0;i<5;i++){
  assert.deepEqual(blendPose(a,b,0,i),a);assert.deepEqual(blendPose(a,b,1,i),b);
  assert.deepEqual(sampleJourney(stops,500,i),b);
  const left=sampleJourney(stops,499.99,i),right=sampleJourney(stops,500.01,i);
  assert.ok(Math.hypot(left.x-right.x,left.y-right.y)<.01);
  for(const y of [0,100,300,500,700,800])assert.deepEqual(sampleJourney(stops,y,i),sampleJourney(stops,y,i));
 }
 assert.notDeepEqual(blendPose(a,b,.5,0),blendPose(a,b,.5,1));
});
test('all seven combinations and empty choice have finite independent petal states',()=>{
 for(let mask=0;mask<8;mask++){
 const selected=['etha','ambo','minne'].filter((_,i)=>mask&(1<<i));
 for(let i=0;i<5;i++){
  const p=selectionPose(a,i,selected);assert.ok(Object.values(p).every(Number.isFinite));
  const associated=['minne','etha','ambo',null,null][i];
  if(!associated||selected.includes(associated))assert.deepEqual(p,a);else assert.ok(p.s<a.s);
 }
 }
});
