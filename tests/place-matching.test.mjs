import test from 'node:test';
import assert from 'node:assert/strict';
import {decidePlace,matchPlanPlaces,mergePlaceMatches,matchingSummary} from '../dist/place-matching.js';
import {needsPlace,placeStatus} from '../dist/place-schema.js';
import {makeDemo,validTrip,parseBackup,encodeShare,decodeShare} from '../dist/domain.js';
import {routeScope,checkRoute,routeKey} from '../dist/route-check.js';
import {applyDayRevision,daySignature} from '../dist/revision.js';
const poi=(name='杭州西湖风景名胜区-断桥残雪',id='a',city='杭州市')=>({id,name,city,address:'景区入口',district:'西湖区',source:'amap',coordinateSystem:'GCJ-02',location:[120.15,30.25]});
const stop=(title='断桥残雪',type='景点')=>({title,type});
const plan=(...items)=>({days:[{items}]});
test('only unique exact city/name POIs auto-bind; branches, generic meals and wrong cities require confirmation',()=>{
 assert.equal(decidePlace(stop(),[poi(),poi('断桥残雪碑亭','b')],'杭州').place.id,'a');
 assert.equal(decidePlace(stop(),[poi(),poi('断桥残雪','b')],'杭州').place,undefined);
 assert.equal(decidePlace(stop(),[poi('断桥残雪','a','广州市')],'杭州').place,undefined);
 assert.equal(decidePlace(stop('午餐','餐饮'),[poi('午餐')],'杭州').place,undefined);
 assert.equal(decidePlace(stop('西湖'),[poi('西湖-断桥')],'杭州').place,undefined);
 assert.equal(decidePlace(stop(),[{name:'断桥残雪',location:[120,30]}],'杭州').placeMatch.status,'unmatched');
});
test('batch resolves repeated names once, preserves original plan and known locations, and skips pure transport/rest',async()=>{
 let calls=0;const original=plan(stop(),stop(),stop('前往雷峰塔','交通'),stop('自由休息','体验'),{...stop('已选'),place:poi('已选')});
 const before=structuredClone(original),result=await matchPlanPlaces(original,'杭州',{search:async()=>{calls++;return [poi()];}});
 assert.equal(calls,1);assert.deepEqual(original,before);assert.equal(result.days[0].items[0].place.id,'a');
 assert.equal(needsPlace(stop('杭州东站','交通')),true);assert.equal(placeStatus(result.days[0].items[2]).kind,'activity');
 assert.deepEqual(matchingSummary(result),{total:3,matched:3,pending:0,activities:2});
});
test('quota interruption retains completed results and marks remaining stops pending without retrying',async()=>{
 let calls=0;const result=await matchPlanPlaces(plan(stop(),stop('雷峰塔'),stop('灵隐寺')),'杭州',{search:async()=>{if(++calls===2)throw Error('查询次数已用完');return [poi()];}});
 assert.equal(calls,2);assert.equal(result.days[0].items[0].place.id,'a');assert.equal(result.days[0].items[2].placeMatch.status,'pending');
});
test('phase timeout keeps draft and user cancellation discards matching work',async()=>{
 const search=(_, {signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true}));
 const result=await matchPlanPlaces(plan(stop()),'杭州',{budgetMs:10,search});assert.equal(result.days[0].items[0].placeMatch.status,'pending');
 const controller=new AbortController();controller.abort();await assert.rejects(matchPlanPlaces(plan(stop()),'杭州',{signal:controller.signal,search}),{name:'AbortError'});
});
test('metadata merges preserve concurrent edits, reject changed titles/locations, survive backup and stay out of sharing',async()=>{
 const before=makeDemo(),matched=await matchPlanPlaces(before,before.city,{search:async({keywords})=>[poi(keywords)]}),current=structuredClone(before);
 current.days[0].items[0].time='09:15';current.days[0].items[0].note='我的备注';current.days[0].items[1].title='新的景点';current.days[0].items[2].place=poi('手选','manual');
 const updated=mergePlaceMatches(current,before,matched);assert.equal(updated.days[0].items[0].time,'09:15');assert.equal(updated.days[0].items[0].note,'我的备注');assert.equal(updated.days[0].items[1].place,undefined);assert.equal(updated.days[0].items[2].place.id,'manual');assert.deepEqual(updated.expenses,current.expenses);assert.ok(validTrip(updated));
 assert.ok(parseBackup(JSON.stringify({version:1,trips:[updated],activeId:updated.id})).trips[0].days[0].items[0].place);
 assert.equal(JSON.stringify(decodeShare(encodeShare(updated))).includes('placeMatch'),false);
 const invalid=structuredClone(updated);invalid.days[0].items[0].placeMatch.candidates=[{name:'bad'}];assert.equal(validTrip(invalid),false);
});
test('revisions keep deliberately confirmed replacement POIs',()=>{
 const trip=makeDemo();trip.days[0].items[0].place=poi('原入口','old');const item={...trip.days[0].items[0],place:poi('新入口','new')};
 assert.equal(applyDayRevision(trip,0,{days:[{title:'一天',items:[item]}]},daySignature(trip.days[0])).days[0].items[0].place.id,'new');
});
test('route skips transport text but validates full schedule and never bridges unknown scenic locations',()=>{
 const trip=makeDemo(),base=trip.days[0].items[0];trip.days[0].items=[{...base,title:'断桥残雪',time:'09:00',duration:60,place:poi()},{...base,id:'travel',title:'前往雷峰塔',type:'交通',time:'10:00',duration:30},{...base,id:'tower',title:'雷峰塔',time:'10:30',place:poi('雷峰塔','b')}];
 const view=routeScope(trip);assert.deepEqual(view.points.map(x=>x.label),['1-1','1-3']);assert.equal(view.segments.length,1);
 const routes=new Map([[routeKey(view.segments[0],'driving'),{distance:1000,duration:900}]]);
 const checked=checkRoute(trip,{routes});assert.equal(checked.issues.some(x=>x.kind==='missing-place'||x.kind==='travel-gap'),false);
 trip.days[0].items[1].time='09:30';assert.ok(checkRoute(trip).issues.some(x=>x.kind==='overlap'));
 trip.days[0].items[1].type='景点';trip.days[0].items[1].title='未知景点';assert.equal(routeScope(trip).segments.filter(x=>x.known).length,0);
});
