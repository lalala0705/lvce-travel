export function validPlace(p){return !!(p&&p.source==='amap'&&p.coordinateSystem==='GCJ-02'&&typeof p.id==='string'&&p.id.length<=100&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=80&&typeof p.address==='string'&&p.address.length<=200&&typeof p.city==='string'&&p.city.length<=30&&typeof p.district==='string'&&p.district.length<=50&&Array.isArray(p.location)&&p.location.length===2&&p.location.every(Number.isFinite)&&Math.abs(p.location[0])<=180&&Math.abs(p.location[1])<=90);}
export function needsPlace(item){
  if(validPlace(item?.place))return true;
  if(item?.type==='交通'&&/^(?:前往|往返|乘坐|乘车|步行|驾车|骑行|出发|返程|交通|打车|地铁|公交|高铁|火车|航班|转乘)/.test(item.title.trim()))return false;
  if(['体验','其他'].includes(item?.type)&&/^(?:自由活动|午休|休息|整理行李|自由休息|返程途中)(?:[（(].*[）)])?$/.test(item.title.trim()))return false;
  return true;
}
export function validPlaceMatch(value){return !!(value&&['matched','pending','unmatched','error','activity'].includes(value.status)&&typeof value.query==='string'&&value.query.length<=60&&typeof value.message==='string'&&value.message.length<=200&&Array.isArray(value.candidates)&&value.candidates.length<=5&&value.candidates.every(validPlace));}
export function placeStatus(item){
  if(validPlace(item?.place))return {kind:'matched',label:'已匹配高德'};
  if(!needsPlace(item))return {kind:'activity',label:'时间安排，无需单独标点'};
  const status=validPlaceMatch(item?.placeMatch)?item.placeMatch.status:'unchecked';
  return {kind:status,label:({pending:'待确认高德地点',unmatched:'未找到具体地点',error:'地图查询未完成',unchecked:'待匹配高德'})[status]||'待匹配高德'};
}
