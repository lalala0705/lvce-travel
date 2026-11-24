import {uid,validTrip} from './domain.js?v=0.4.1';
import {validPlace} from './place-schema.js?v=0.4.1';
export const daySignature=day=>JSON.stringify(day);
export function safeDayContext(trip,index){return {title:trip.days[index].title,items:trip.days[index].items.map(({title,time,duration,type,cost})=>({title,time,duration,type,cost}))};}
export function applyDayRevision(current,index,plan,signature){
  if(!current.days[index]||daySignature(current.days[index])!==signature)throw new Error('这一天已在生成期间被修改，请重新生成，避免覆盖新内容');
  if(!plan.days||plan.days.length!==1)throw new Error('调整草稿只能替换选中的一天');
  const old=current.days[index],used=new Set();
  const items=plan.days[0].items.map(next=>{
    const original=old.items.find(x=>x.title===next.title&&!used.has(x.id));if(original)used.add(original.id);
    return {...next,id:original?.id||uid(),...(original?.note?{note:original.note}:{}),...(validPlace(next.place)?{place:next.place}:original&&validPlace(original.place)?{place:original.place}:{})};
  });
  const updated={...current,days:current.days.map((d,i)=>i===index?{...d,title:plan.days[0].title,items}:d)};
  if(!validTrip(updated))throw new Error('调整结果无法保存，原行程未修改');
  return updated;
}
export function summarizeRevision(before,after){
  const a=before.items.map(x=>x.title),b=after.items.map(x=>x.title);
  return {added:b.filter(x=>!a.includes(x)),removed:a.filter(x=>!b.includes(x)),rescheduled:after.items.filter(n=>before.items.some(o=>o.title===n.title&&(o.time!==n.time||o.duration!==n.duration))).map(x=>x.title)};
}
