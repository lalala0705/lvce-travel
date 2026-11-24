import test from 'node:test';
import assert from 'node:assert/strict';
import {toCents,splitExpense,ledger,makeTrip,makeDemo,validTrip,parseBackup,shareSnapshot,encodeShare,decodeShare,dayDate,validateDate} from '../dist/domain.js';
test('money is represented as integer cents, not floating point',()=>{
  assert.equal(toCents('0.29'),29);assert.equal(toCents('240.01'),24001);
  for(const bad of ['0','-1','NaN','Infinity','1.001','1e4',''])assert.throws(()=>toCents(bad));
});
test('cent remainder is deterministic and sums to original expense',()=>{
  assert.deepEqual(splitExpense(100,['a','b','c']),[{id:'a',cents:34},{id:'b',cents:33},{id:'c',cents:33}]);
  assert.deepEqual(splitExpense(1,['a','b']),[{id:'a',cents:1},{id:'b',cents:0}]);
  assert.throws(()=>splitExpense(20,[]));assert.throws(()=>splitExpense(20,['a','a']));
});
test('demo transfer reproduces prototype: Xiaozhou owes Xiaolin 360',()=>{
  const t=makeDemo(),l=ledger(t);assert.equal(l.total,120000);
  assert.deepEqual(l.transfers,[{from:'小周',to:'小林',cents:36000}]);
  assert.equal(l.balances.reduce((s,x)=>s+x.net,0),0);assert.ok(validTrip(t));
});
test('only selected participants owe their share and payer can be outside them',()=>{
  const t=makeTrip({names:['甲','乙','丙']}),[a,b,c]=t.members.map(m=>m.id);
  t.expenses=[{id:'expense-1',title:'午餐',type:'餐饮',date:t.date,cents:101,payer:a,participants:[b,c]}];
  const l=ledger(t);assert.deepEqual(l.balances.map(x=>x.net),[101,-51,-50]);
  assert.equal(l.transfers.reduce((s,x)=>s+x.cents,0),101);
});
test('settlement zeroes balances for random multi-member bills',()=>{
  for(let count=2;count<=12;count++){
    const t=makeTrip({names:Array.from({length:count},(_,i)=>`成员${i}`)});
    t.expenses=Array.from({length:37},(_,i)=>({cents:17+i*39,payer:t.members[i%count].id,participants:t.members.filter((_,j)=>(i+j)%3!==0||count===2).map(m=>m.id)}));
    const l=ledger(t),net=new Map(l.balances.map(m=>[m.name,m.net]));
    for(const x of l.transfers){net.set(x.from,net.get(x.from)+x.cents);net.set(x.to,net.get(x.to)-x.cents);}
    assert.ok([...net.values()].every(v=>v===0));
  }
});
test('new journeys do not inherit demo bills and unknown cities start empty',()=>{
  const t=makeTrip({city:'苏州',count:4});assert.equal(t.days.length,4);assert.equal(t.days.flatMap(d=>d.items).length,0);assert.equal(t.expenses.length,0);assert.ok(validTrip(t));
  assert.throws(()=>makeTrip({count:31}));assert.throws(()=>makeTrip({names:['重复','重复']}));
});
test('calendar dates cross month and leap-day boundaries without UTC drift',()=>{
  assert.equal(dayDate('2026-12-31',1),'2027-01-01');assert.equal(dayDate('2028-02-28',1),'2028-02-29');
  assert.ok(validateDate('2028-02-29'));assert.equal(validateDate('2026-02-30'),false);assert.equal(validateDate('bad'),false);
});
test('backup is validated before it can replace or append state',()=>{
  const t=makeDemo(),backup={version:1,activeId:t.id,trips:[t]};assert.equal(parseBackup(JSON.stringify(backup)).activeId,t.id);
  t.expenses[0].payer='unknown';assert.throws(()=>parseBackup(JSON.stringify(backup)));
  assert.throws(()=>parseBackup('{"version":1,"trips":[]}'));
  assert.throws(()=>parseBackup('x'.repeat(2000001)));
});
test('backup rejects conflicting IDs and unbounded numeric data',()=>{
  const t=makeDemo();t.days[0].items[0].id=t.members[0].id;assert.equal(validTrip(t),false);
  const b=makeDemo();b.expenses[0].cents=Number.MAX_VALUE;assert.equal(validTrip(b),false);
});
test('read-only share strips personal details, notes, bills and member names',()=>{
  const t=makeDemo();t.days[0].items[0].note='私密备注不能分享';t.secret='api-key';
  const s=shareSnapshot(t),encoded=encodeShare(t);assert.deepEqual(decodeShare(encoded),s);
  const plain=JSON.stringify(s);for(const privateText of ['小林','小周','api-key','私密备注不能分享','expenses','members'])assert.equal(plain.includes(privateText),false);
  assert.throws(()=>decodeShare('not-a-valid-snapshot'));
});
