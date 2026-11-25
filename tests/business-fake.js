// Supabase finto in memoria per i test di MyTurn Business (tests/business-team.js e tests/business-shifts.js):
// le stesse regole delle funzioni team_* del server (supabase/migrations/20261125180000_aziende.sql e 20261125210000_turni_squadra.sql).
// Tre account: A, B e C (il token è la lettera). Si usa con page.route('https://test.supabase.co/**',fake).
const USERS={A:{id:'ua',email:'anna@bar.test'},B:{id:'ub',email:'luca@bar.test'},C:{id:'uc',email:'marco@bar.test'}};
const DB={teams:[],members:[],invites:[],shifts:[],draft:[],profiles:{},push:new Set(),notices:[]};let seq=0;const uuid=()=>'00000000-0000-4000-8000-'+String(++seq).padStart(12,'0');
const role=(team,uid)=>{const m=DB.members.find(m=>m.team_id===team&&m.user_id===uid&&m.status==='attivo');return m?m.role:null;};
const owners=(team,except)=>DB.members.filter(m=>m.team_id===team&&m.role==='titolare'&&m.status==='attivo'&&m.user_id&&m.id!==except).length;
const code=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c='';for(let i=0;i<8;i++)c+=a[Math.floor(Math.random()*32)];return c;};
class E extends Error{}
// i turni come li tiene Postgres (jsonb ordina le chiavi: prima le più corte) e come li ripulisce team_shift_clean
const jb=o=>Object.fromEntries(Object.keys(o).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)).map(k=>[k,o[k]]));
const same=(a,b)=>JSON.stringify(a&&jb(a))===JSON.stringify(b&&jb(b));
const HM=/^([01][0-9]|2[0-3]):[0-5][0-9]$/,lim=(x,d)=>Math.min(16,Math.max(0.5,x==null||x===''?d:+x));
function clean(v){const k=v&&v.k;if(!['w','r','f','p','m'].includes(k))throw new E('bad shift');const o={k};
  if(k==='w'){if(!HM.test(v.s||''))throw new E('bad shift');o.s=v.s;o.d=lim(v.d,8);if(HM.test(v.s2||'')){o.s2=v.s2;o.d2=lim(v.d2,4);}}
  else if(k==='p'&&v.h!=null&&v.h!=='')o.h=lim(v.h,8);
  if(String(v.n||'').trim())o.n=String(v.n).trim().slice(0,120);return jb(o);}
const notice=l=>({it:'Ci sono turni nuovi o cambiati per te. Apri MyTurn per vederli.'}[String(l||'it').toLowerCase().split('-')[0]]||'You have new or changed shifts. Open MyTurn to see them.');
// filtri di PostgREST usati dall'app: colonna=eq.x, day=gte.x, day=lte.x
const filt=u=>{const F=[];for(const [c,v] of u.searchParams){const m=/^(eq|gte|lte)\.(.*)$/.exec(v);if(!m||['select','order','limit'].includes(c))continue;
  F.push(s=>m[1]==='eq'?String(s[c])===m[2]:m[1]==='gte'?s[c]>=m[2]:s[c]<=m[2]);}return s=>F.every(f=>f(s));};

const RPC={
  team_mine:(u)=>DB.members.filter(m=>m.user_id===u&&m.status==='attivo').map(m=>{const t=DB.teams.find(t=>t.id===m.team_id);
    return {team_id:t.id,team:t.name,country:t.country,region:t.region,member_id:m.id,name:m.name,role:m.role,dept:m.dept,week_hours:m.week_hours,leave_days:m.leave_days,leave_hours:m.leave_hours};}),
  team_create:(u,b)=>{const em=Object.values(USERS).find(x=>x.id===u).email;const t={id:uuid(),name:b.p_name.trim(),country:(b.p_country||'IT').toUpperCase(),region:b.p_region||null,settings:{}};DB.teams.push(t);
    DB.members.push({id:uuid(),team_id:t.id,user_id:u,name:(b.p_my_name||'').trim()||em.split('@')[0],email:em,role:'titolare',dept:null,week_hours:null,leave_days:null,leave_hours:null,status:'attivo'});return t.id;},
  team_update:(u,b)=>{if(role(b.p_team,u)!=='titolare')throw new E('forbidden');const t=DB.teams.find(t=>t.id===b.p_team);t.name=b.p_name.trim();t.country=b.p_country;return null;},
  team_member_save:(u,b)=>{const me=role(b.p_team,u);if(!me||me==='dipendente')throw new E('forbidden');if(me==='responsabile'&&b.p_role!=='dipendente')throw new E('forbidden');
    const v={name:b.p_name.trim(),role:b.p_role,dept:b.p_dept,week_hours:b.p_week_hours,leave_days:b.p_leave_days,leave_hours:b.p_leave_hours};
    if(!b.p_id){const m=Object.assign({id:uuid(),team_id:b.p_team,user_id:null,email:null,status:'attivo'},v);DB.members.push(m);return m.id;}
    const cur=DB.members.find(m=>m.id===b.p_id&&m.team_id===b.p_team&&m.status==='attivo');if(!cur)throw new E('not found');
    if(me==='responsabile'&&cur.role!=='dipendente')throw new E('forbidden');if(cur.role==='titolare'&&b.p_role!=='titolare'&&!owners(b.p_team,cur.id))throw new E('last owner');
    Object.assign(cur,v);return cur.id;},
  team_member_remove:(u,b)=>{const me=role(b.p_team,u);if(!me||me==='dipendente')throw new E('forbidden');const cur=DB.members.find(m=>m.id===b.p_id);
    if(me==='responsabile'&&cur.role!=='dipendente')throw new E('forbidden');if(cur.role==='titolare'&&!owners(b.p_team,cur.id))throw new E('last owner');
    DB.invites=DB.invites.filter(i=>i.member_id!==cur.id||i.used_at);Object.assign(cur,{status:'uscito',user_id:null,email:null});return null;},
  team_invite:(u,b)=>{const me=role(b.p_team,u);if(!me||me==='dipendente')throw new E('forbidden');const cur=DB.members.find(m=>m.id===b.p_member);
    if(cur.user_id)throw new E('already joined');if(me==='responsabile'&&cur.role!=='dipendente')throw new E('forbidden');
    DB.invites=DB.invites.filter(i=>i.member_id!==cur.id||i.used_at);const c=code();DB.invites.push({code:c,team_id:b.p_team,member_id:cur.id,expires_at:new Date(Date.now()+14*864e5).toISOString(),used_at:null});return c;},
  team_join_preview:(u,b)=>{const i=DB.invites.find(i=>i.code===b.p_code.toUpperCase()&&!i.used_at);const m=i&&DB.members.find(m=>m.id===i.member_id&&!m.user_id);if(!m)throw new E('invalid code');
    const t=DB.teams.find(t=>t.id===i.team_id);return {team:t.name,country:t.country,name:m.name,role:m.role,dept:m.dept};},
  team_join:(u,b)=>{const i=DB.invites.find(i=>i.code===b.p_code.toUpperCase()&&!i.used_at);if(!i)throw new E('invalid code');
    if(role(i.team_id,u))throw new E('already member');const m=DB.members.find(m=>m.id===i.member_id&&!m.user_id);if(!m)throw new E('invalid code');
    Object.assign(m,{user_id:u,email:Object.values(USERS).find(x=>x.id===u).email});i.used_at=new Date().toISOString();return i.team_id;},
  team_leave:(u,b)=>{const m=DB.members.find(m=>m.team_id===b.p_team&&m.user_id===u&&m.status==='attivo');if(!m)return null;
    if(m.role==='titolare'&&!owners(b.p_team,m.id))throw new E('last owner');Object.assign(m,{user_id:null,email:null});return null;},
  team_delete:(u,b)=>{if(role(b.p_team,u)!=='titolare')throw new E('forbidden');DB.teams=DB.teams.filter(t=>t.id!==b.p_team);DB.members=DB.members.filter(m=>m.team_id!==b.p_team);DB.invites=DB.invites.filter(i=>i.team_id!==b.p_team);
    DB.shifts=DB.shifts.filter(s=>s.team_id!==b.p_team);DB.draft=DB.draft.filter(s=>s.team_id!==b.p_team);return null;},
  // tappa 2 (supabase/migrations/20261125210000_turni_squadra.sql)
  team_draft_set:(u,b)=>{const me=role(b.p_team,u);if(!me||me==='dipendente')throw new E('forbidden');if(!Array.isArray(b.p_items)||b.p_items.length>500)throw new E('bad items');
    b.p_items.forEach(x=>{if(!DB.members.some(m=>m.id===x.m&&m.team_id===b.p_team&&m.status==='attivo'))throw new E('not found');
      const dd=(new Date(x.d)-new Date(new Date().toISOString().slice(0,10)))/864e5;if(!(dd>=-62&&dd<=400))throw new E('bad range');
      const v=x.v==null?null:clean(x.v),pub=DB.shifts.find(s=>s.member_id===x.m&&s.day===x.d);DB.draft=DB.draft.filter(s=>!(s.member_id===x.m&&s.day===x.d));
      if(!same(v,pub?pub.v:null))DB.draft.push({team_id:b.p_team,member_id:x.m,day:x.d,v,updated_by:u});});return b.p_items.length;},
  team_publish:(u,b)=>{const me=role(b.p_team,u);if(!me||me==='dipendente')throw new E('forbidden');if(b.p_to<b.p_from||(new Date(b.p_to)-new Date(b.p_from))/864e5>62)throw new E('bad range');
    const inR=s=>s.team_id===b.p_team&&s.day>=b.p_from&&s.day<=b.p_to;let n=0;const who=new Set();
    DB.draft.filter(inR).forEach(r=>{const i=DB.shifts.findIndex(s=>s.member_id===r.member_id&&s.day===r.day);let k=0;
      if(r.v==null){if(i>=0){DB.shifts.splice(i,1);k=1;}}
      else if(i<0){DB.shifts.push({team_id:b.p_team,member_id:r.member_id,day:r.day,v:r.v,version:1});k=1;}
      else if(!same(DB.shifts[i].v,r.v)){Object.assign(DB.shifts[i],{v:r.v,version:DB.shifts[i].version+1});k=1;}
      if(k){n++;who.add(r.member_id);}});
    DB.draft=DB.draft.filter(s=>!inR(s));
    // avviso a chi ha le notifiche attive, non a chi pubblica (team_notice)
    const t=DB.teams.find(t=>t.id===b.p_team);
    DB.members.filter(m=>who.has(m.id)&&m.status==='attivo'&&m.user_id&&m.user_id!==u&&DB.push.has(m.user_id))
      .forEach(m=>DB.notices.push({user_id:m.user_id,title:t.name,body:notice(DB.profiles[m.user_id])}));
    return n;},
  team_draft_discard:(u,b)=>{const me=role(b.p_team,u);if(!me||me==='dipendente')throw new E('forbidden');DB.draft=DB.draft.filter(s=>!(s.team_id===b.p_team&&s.day>=b.p_from&&s.day<=b.p_to));return null;},
  team_settings_set:(u,b)=>{if(role(b.p_team,u)!=='titolare')throw new E('forbidden');const t=DB.teams.find(t=>t.id===b.p_team);
    if('min' in b.p_settings)t.settings=Object.assign({},t.settings,{min:Math.min(50,Math.max(0,parseInt(b.p_settings.min)||0))});return null;},
};
const CALLS=[];
async function fake(r){const req=r.request(),u=new URL(req.url()),tok=(req.headers()['authorization']||'').replace(/^Bearer /,''),uid=USERS[tok]&&USERS[tok].id;
  const J=(o,st=200)=>r.fulfill({status:st,contentType:'application/json',body:JSON.stringify(o)});
  const fn=u.pathname.startsWith('/rest/v1/rpc/')&&u.pathname.slice(13);
  if(fn&&RPC[fn]){CALLS.push(fn);if(!uid)return J({code:'P0001',message:'not authenticated'},400);
    try{return J(RPC[fn](uid,JSON.parse(req.postData()||'{}')));}catch(e){if(e instanceof E)return J({code:'P0001',message:e.message},400);throw e;}}
  if(u.pathname==='/rest/v1/team_members'){const team=(u.searchParams.get('team_id')||'').slice(3),me=role(team,uid);
    return J(DB.members.filter(m=>m.team_id===team&&m.status==='attivo'&&(m.user_id===uid||me==='titolare'||me==='responsabile')).sort((a,b)=>a.name.localeCompare(b.name)));}
  if(u.pathname==='/rest/v1/team_invites'){const team=(u.searchParams.get('team_id')||'').slice(3),me=role(team,uid);
    return J(me==='titolare'||me==='responsabile'?DB.invites.filter(i=>i.team_id===team&&!i.used_at):[]);}
  if(u.pathname==='/rest/v1/team_shifts'||u.pathname==='/rest/v1/team_draft'){const draft=u.pathname.endsWith('draft'),f=filt(u);
    return J((draft?DB.draft:DB.shifts).filter(s=>f(s)&&(['titolare','responsabile'].includes(role(s.team_id,uid))||!draft&&DB.members.some(m=>m.id===s.member_id&&m.user_id===uid&&m.status==='attivo')))
      .sort((a,b)=>a.day<b.day?-1:1).map(s=>({member_id:s.member_id,day:s.day,v:s.v,version:s.version})));}
  if(u.pathname==='/rest/v1/profiles'&&req.method()==='POST'){if(uid)DB.profiles[uid]=JSON.parse(req.postData()||'{}').lang;return r.fulfill({status:201,body:''});}
  if(u.pathname==='/rest/v1/teams'){const id=(u.searchParams.get('id')||'').slice(3);return J(DB.teams.filter(t=>t.id===id&&role(id,uid)).map(t=>({settings:t.settings||{}})));}
  if(u.pathname.startsWith('/rest/v1/rpc/'))return J(null);
  if(u.pathname==='/rest/v1/sync_meta'||u.pathname==='/rest/v1/sync_items')return J([]);
  return J({});}

module.exports={USERS,DB,RPC,fake,CALLS,E,same};
