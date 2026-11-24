import {validPlace} from './place-schema.js';
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const money = cents => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(cents / 100);
export function toCents(input) {
  const s = String(input).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) throw new Error('请输入有效金额，最多两位小数');
  const [whole, fraction = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents <= 0) throw new Error('金额必须大于 0');
  return cents;
}
export function localDate(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function dayDate(date, offset = 0) {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function validateDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || Number(s.slice(0,4)) < 2000 || Number(s.slice(0,4)) > 2100) return false;
  return dayDate(s) === s;
}
export function splitExpense(cents, participants) {
  if (!Number.isSafeInteger(cents) || cents <= 0 || !participants.length || new Set(participants).size !== participants.length) throw new Error('消费金额或参与人无效');
  const base = Math.floor(cents / participants.length), remainder = cents % participants.length;
  return participants.map((id, i) => ({ id, cents: base + (i < remainder ? 1 : 0) }));
}
export function ledger(trip) {
  const balances = trip.members.map(m => ({ ...m, paid: 0, owed: 0, net: 0 }));
  const byId = new Map(balances.map(m => [m.id, m]));
  for (const e of trip.expenses) {
    if (!byId.has(e.payer) || e.participants.some(id => !byId.has(id))) throw new Error('消费关联的成员不存在');
    byId.get(e.payer).paid += e.cents;
    for (const part of splitExpense(e.cents, e.participants)) byId.get(part.id).owed += part.cents;
  }
  for (const m of balances) m.net = m.paid - m.owed;
  const debtors = balances.filter(m => m.net < 0).map(m => ({ ...m, left: -m.net }));
  const creditors = balances.filter(m => m.net > 0).map(m => ({ ...m, left: m.net }));
  const transfers = []; let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].left, creditors[j].left);
    transfers.push({ from: debtors[i].name, to: creditors[j].name, cents });
    debtors[i].left -= cents; creditors[j].left -= cents;
    if (!debtors[i].left) i++; if (!creditors[j].left) j++;
  }
  return { balances, transfers, total: trip.expenses.reduce((n,e) => n + e.cents,0) };
}
const templates = {
  '杭州': [
    { title:'西湖漫步', items:[['09:00','断桥残雪','景点',120,0,'沿白堤慢走，在湖边留一点自由时间。'],['12:00','湖滨杭帮菜午餐','餐饮',60,8000,'找一家喜欢的小馆，两菜一汤刚刚好。'],['14:00','雷峰塔','景点',120,4000,'登高看西湖，门票和开放时间出发前确认。']] },
    { title:'龙井茶山', items:[['09:30','龙井村','景点',120,0,'穿过茶山，感受清晨的山野。'],['12:00','龙井村午餐','餐饮',60,7000,'在村里简单吃一顿当地菜。'],['14:00','九溪烟树','景点',150,0,'山间慢走，预留返程时间。']] },
    { title:'老街寻味', items:[['09:30','河坊街','景点',120,0,'逛逛老街，尝尝葱包桧。'],['12:00','南宋御街午餐','餐饮',60,6000,'给杭州的味道留一个位置。']] }
  ],
  '成都': [
    { title:'老城烟火',items:[['09:30','人民公园','景点',120,0,'在茶馆坐一会儿，慢慢进入成都的节奏。'],['12:00','宽窄巷子午餐','餐饮',60,6000,'在附近选择一家喜欢的小馆。'],['14:00','成都博物馆','景点',150,0,'请提前核实开放日与预约要求。']] },
    { title:'城市漫游',items:[['09:30','武侯祠','景点',120,5000,'门票价格仅作预算估计。'],['12:00','锦里午餐','餐饮',60,7000,'按自己的口味选择。'],['14:00','玉林路','景点',120,0,'在街角喝杯咖啡，慢逛小店。']] },
    { title:'公园与归途',items:[['10:00','浣花溪公园','景点',120,0,'在绿地里走走。'],['12:00','青羊区午餐','餐饮',60,6000,'返程前再吃一顿当地菜。']] }
  ],
  '大理': [
    {title:'古城慢游',items:[['09:30','大理古城','景点',120,0,'从清晨的街巷开始。'],['12:00','古城午餐','餐饮',60,6000,'找家白族菜馆。'],['14:00','才村','景点',120,0,'在洱海边散步，注意返程交通。']]},
    {title:'洱海时光',items:[['09:30','喜洲古镇','景点',120,0,'看老建筑，尝尝喜洲粑粑。'],['12:00','喜洲午餐','餐饮',60,6000,'不赶路，慢慢吃。'],['14:00','海舌生态公园','景点',120,0,'提前确认预约和入园规则。']]},
    {title:'山间与归途',items:[['09:30','苍山周边','景点',150,0,'根据天气选择山脚步道，不包含索道费用。'],['12:00','古城午餐','餐饮',60,6000,'为返程预留充足时间。']]}
  ]
};
export function makeTrip({ city='杭州',date=localDate(7),count=3,names=['小林','小周'],budget=200000,pace='慢逛休闲',preferences=['自然风光','当地美食'] }={}) {
  if (!city.trim() || city.length>30 || !validateDate(date) || !Number.isInteger(count) || count<1 || count>30) throw new Error('请核对目的地、日期和天数（1–30 天）');
  if (!names.length || names.length>12 || names.some(n => !n.trim() || n.length>20) || new Set(names).size!==names.length) throw new Error('请输入 1–12 位不同的同行人，每个名字不超过 20 字');
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('请填写有效人均预算');
  const cleanCity=city.trim(), source = templates[cleanCity] ?? [];
  return { id:uid(),city:cleanCity,title:`${cleanCity}慢游`,date,budget,pace,preferences,members:names.map(name=>({id:uid(),name:name.trim()})),days:Array.from({length:count},(_,i)=>({id:uid(),title:source[i]?.title ?? '留白的一天',items:(source[i]?.items??[]).map(([time,title,type,duration,cost,note])=>({id:uid(),time,title,type,duration,cost,note}))})),expenses:[],checklist:[['身份证','检查有效期，随身携带','证件'],['预订住宿','确认订单与入住时间','预约'],['常用药品','按个人需要准备','行李'],['充电器与充电宝','出发前充满电','行李'],['景点开放时间','核实门票、预约与开放规则','预约'],['查看出发前天气','根据天气调整户外安排','提醒']].map(([title,note,category])=>({id:uid(),title,note,category,done:false})),favorites:[] };
}
export function makeDemo() {
  const t=makeTrip();const [a,b]=t.members.map(m=>m.id);
  t.expenses=[{id:uid(),type:'住宿',title:'西湖边民宿 · 2 晚',cents:80000,payer:a,participants:[a,b],date:t.date},{id:uid(),type:'餐饮',title:'杭帮菜午餐',cents:24000,payer:b,participants:[a,b],date:t.date},{id:uid(),type:'交通',title:'往返车费',cents:16000,payer:a,participants:[a,b],date:t.date}];
  t.checklist[0].done=t.checklist[1].done=true;t.demo=true;return t;
}
const str=(v,max=200)=>typeof v==='string'&&v.length<=max;
const array=(v,max)=>Array.isArray(v)&&v.length<=max;
export function validTrip(t) {
  if (!t||!str(t.id,100)||!str(t.city,30)||!t.city.trim()||!str(t.title,80)||!validateDate(t.date)||!Number.isSafeInteger(t.budget)||t.budget<=0||t.budget>9999999999||!str(t.pace,30)||!array(t.preferences,10)||!t.preferences.every(x=>str(x,30))) return false;
  if (!array(t.members,12)||!t.members.length||!t.members.every(m=>m&&str(m.id,100)&&str(m.name,20)&&m.name.trim())||new Set(t.members.map(m=>m.id)).size!==t.members.length) return false;
  const ids=new Set(t.members.map(m=>m.id));
  if (!array(t.days,30)||!t.days.length||!t.days.every(d=>d&&str(d.id,100)&&str(d.title,80)&&array(d.items,50)&&d.items.every(x=>x&&str(x.id,100)&&str(x.title,80)&&x.title.trim()&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x.time)&&str(x.type,20)&&Number.isInteger(x.duration)&&x.duration>=5&&x.duration<=720&&Number.isSafeInteger(x.cost)&&x.cost>=0&&x.cost<=9999999999&&str(x.note,500)&&(x.place===undefined||validPlace(x.place))))) return false;
  if (!array(t.expenses,2000)||!t.expenses.every(e=>e&&str(e.id,100)&&str(e.title,80)&&str(e.type,20)&&validateDate(e.date)&&Number.isSafeInteger(e.cents)&&e.cents>0&&e.cents<=9999999999&&ids.has(e.payer)&&array(e.participants,12)&&e.participants.length&&e.participants.every(id=>ids.has(id))&&new Set(e.participants).size===e.participants.length)) return false;
  if (!array(t.checklist,200)||!t.checklist.every(x=>x&&str(x.id,100)&&str(x.title,80)&&str(x.note,500)&&str(x.category,20)&&typeof x.done==='boolean')) return false;
  if (!array(t.favorites,100)||!t.favorites.every(x=>x&&str(x.id,100)&&str(x.title,80)&&str(x.type,20)&&str(x.note,500))) return false;
  const allIds=[...t.members,...t.days,...t.days.flatMap(d=>d.items),...t.expenses,...t.checklist,...t.favorites].map(x=>x.id);
  return allIds.every(Boolean)&&new Set(allIds).size===allIds.length;
}
export function parseBackup(text) {
  if(text.length>2000000) throw new Error('备份文件过大（最多 2 MB）');
  const v=JSON.parse(text);
  if(v.version!==1||!array(v.trips,30)||!v.trips.length||!v.trips.every(validTrip)||new Set(v.trips.map(t=>t.id)).size!==v.trips.length) throw new Error('备份格式无效，未修改当前旅行');
  return {version:1,trips:v.trips,activeId:v.trips.some(t=>t.id===v.activeId)?v.activeId:v.trips[0].id};
}
export function shareSnapshot(t) {
  return { version:1,city:t.city,date:t.date,days:t.days.map(d=>({title:d.title,items:d.items.map(({title,time,duration,type})=>({title,time,duration,type}))})) };
}
export function encodeShare(t) {
  const bytes=new TextEncoder().encode(JSON.stringify(shareSnapshot(t))); let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeShare(value) {
  if(value.length>64000)throw new Error('分享内容过长');
  const normalized=value.replaceAll('-','+').replaceAll('_','/');const bytes=Uint8Array.from(atob(normalized),c=>c.charCodeAt(0));
  const s=JSON.parse(new TextDecoder().decode(bytes));
  if(s.version!==1||!str(s.city,30)||!validateDate(s.date)||!array(s.days,30)||!s.days.length||!s.days.every(d=>str(d.title,80)&&array(d.items,50)&&d.items.every(i=>str(i.title,80)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(i.time)&&str(i.type,20)&&Number.isInteger(i.duration)&&i.duration>=5&&i.duration<=720)))throw new Error('分享内容无效');
  return s;
}
