import {validPlace} from './place-schema.js';
export const dayColors=['#16745c','#356db1','#a56527','#9362b1','#bf5268','#288a94','#78852b'];
export function routeKey(segment,mode){return `${mode}:${segment.from.place.location.join(',')}:${segment.to.place.location.join(',')}`;}
export function routeScope(trip,scope='day',index=0){
  const days=scope==='all'?trip.days.map((d,i)=>({day:d,index:i})):[{day:trip.days[index],index}];
  const points=[],segments=[];let previous=null;
  for(const {day,index:i} of days){
    day.items.forEach((item,j)=>{
      const point={item,dayIndex:i,itemIndex:j,label:`${i+1}-${j+1}`,color:dayColors[i%dayColors.length]};points.push(point);
      if(previous)segments.push({from:previous.item,to:item,fromDay:previous.dayIndex,toDay:i,dayIndex:i,crossDay:previous.dayIndex!==i,fromIndex:previous.itemIndex,toIndex:j,color:previous.dayIndex!==i?'#68776c':point.color,known:validPlace(previous.item.place)&&validPlace(item.place)});
      previous=point;
    });
  }
  return {points,segments,missing:points.filter(p=>!validPlace(p.item.place))};
}
const minutes=time=>{const [h,m]=String(time).split(':').map(Number);return h*60+m;};
function straight(a,b){const rad=x=>x*Math.PI/180,[x1,y1]=a.location,[x2,y2]=b.location;const v=Math.sin(rad(y2-y1)/2)**2+Math.cos(rad(y1))*Math.cos(rad(y2))*Math.sin(rad(x2-x1)/2)**2;return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
export function checkRoute(trip,{scope='day',day=0,mode='driving',routes=new Map()}={}){
  const view=routeScope(trip,scope,day),issues=[],add=(severity,kind,dayIndex,text)=>issues.push({severity,kind,dayIndex,text});
  let checked=0,unverified=0,totalDistance=0,totalDuration=0;
  const indices=scope==='all'?trip.days.map((_,i)=>i):[day];
  for(const i of indices){
    const items=trip.days[i].items,seen=new Set();
    if(!items.length)add('unknown','empty',i,`第 ${i+1} 天尚未安排地点`);
    for(const x of items){
      const start=minutes(x.time);if(!Number.isFinite(start)||start+x.duration>1440)add('error','overnight',i,`第 ${i+1} 天「${x.title}」的停留时间超出当天`);
      if(validPlace(x.place)){if(seen.has(x.place.id))add('warning','duplicate',i,`第 ${i+1} 天重复安排「${x.title}」，请确认是否需要返回`);seen.add(x.place.id);}
      else add('unknown','missing-place',i,`第 ${i+1} 天「${x.title}」尚未确认地图地点，无法核实交通`);
    }
    for(let j=1;j<items.length-1;j++){
      const [a,b,c]=items.slice(j-1,j+2);if(![a,b,c].every(x=>validPlace(x.place)))continue;
      const via=straight(a.place,b.place)+straight(b.place,c.place),direct=straight(a.place,c.place);
      if(via>10000&&via>Math.max(direct,1000)*3)add('warning','backtrack',i,`第 ${i+1} 天「${a.title} → ${b.title} → ${c.title}」可能折返；这是按点位直线分布的粗检，可结合道路与游玩意图调整`);
    }
  }
  for(const segment of view.segments){
    const gap=(segment.toDay-segment.fromDay)*1440+minutes(segment.to.time)-minutes(segment.from.time)-segment.from.duration;
    if(gap<0)add('error','overlap',segment.toDay,`「${segment.from.title}」结束后已超过「${segment.to.title}」开始时间，重叠 ${Math.ceil(-gap)} 分钟`);
    const route=segment.known?routes.get(routeKey(segment,mode)):null;
    if(!segment.known||!route||route.error||!Number.isFinite(route.duration)){unverified++;if(segment.known)add('unknown','unverified-road',segment.toDay,`「${segment.from.title} → ${segment.to.title}」${route?.error?'查询失败':'尚无完整的交通时间'}，未作可达性结论`);continue;}
    checked++;totalDistance+=route.distance;totalDuration+=route.duration;
    const buffer=mode==='driving'?10:5,need=Math.ceil(route.duration/60)+buffer;
    if(gap>=0&&gap<need)add('warning','travel-gap',segment.toDay,`「${segment.from.title} → ${segment.to.title}」预留 ${gap} 分钟，${mode==='driving'?'驾车':'步行'}约需 ${Math.ceil(route.duration/60)} 分钟，另建议留 ${buffer} 分钟缓冲`);
    if(route.duration>(mode==='driving'?4:2)*3600)add('warning','long-transfer',segment.toDay,`「${segment.from.title} → ${segment.to.title}」单段${mode==='driving'?'驾车超过 4 小时':'步行超过 2 小时'}，请确认体力与休息安排`);
  }
  const complete=!issues.some(x=>x.severity==='unknown')&&unverified===0&&view.points.length>0;
  return {issues,checked,unverified,complete,totalDistance,totalDuration,segments:view.segments.length,mode};
}
