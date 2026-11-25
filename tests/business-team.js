// MyTurn Business, tappa 1: aziende, persone e inviti con un Supabase finto in memoria (tre account: A titolare, B e C).
// Prova: niente senza ?business=1; il titolare crea l'azienda, aggiunge una persona e crea l'invito; il dipendente apre
// il link, vede cosa vedrà l'azienda ed entra; il titolare lo vede con l'app; il responsabile non può cambiare i ruoli;
// codice sbagliato; senza account; il dipendente esce; il titolare non può uscire se è l'unico; foto a 320 e 430 px.
// Uso: node tests/business-team.js   (serve il server su 8765). Foto in $OUT.
const {chromium}=require('playwright');const path=require('path'),os=require('os'),fs=require('fs');
const OUT=process.env.OUT||path.join(os.tmpdir(),'myturn-tests');fs.mkdirSync(OUT,{recursive:true});
const URL0='http://localhost:8765/index.html';
const USERS={A:{id:'ua',email:'anna@bar.test'},B:{id:'ub',email:'luca@bar.test'},C:{id:'uc',email:'marco@bar.test'}};
const DB={teams:[],members:[],invites:[]};let seq=0;const uuid=()=>'00000000-0000-4000-8000-'+String(++seq).padStart(12,'0');
const role=(team,uid)=>{const m=DB.members.find(m=>m.team_id===team&&m.user_id===uid&&m.status==='attivo');return m?m.role:null;};
const owners=(team,except)=>DB.members.filter(m=>m.team_id===team&&m.role==='titolare'&&m.status==='attivo'&&m.user_id&&m.id!==except).length;
const code=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c='';for(let i=0;i<8;i++)c+=a[Math.floor(Math.random()*32)];return c;};
class E extends Error{}
const RPC={
  team_mine:(u)=>DB.members.filter(m=>m.user_id===u&&m.status==='attivo').map(m=>{const t=DB.teams.find(t=>t.id===m.team_id);
    return {team_id:t.id,team:t.name,country:t.country,region:t.region,member_id:m.id,name:m.name,role:m.role,dept:m.dept,week_hours:m.week_hours,leave_days:m.leave_days,leave_hours:m.leave_hours};}),
  team_create:(u,b)=>{const em=Object.values(USERS).find(x=>x.id===u).email;const t={id:uuid(),name:b.p_name.trim(),country:(b.p_country||'IT').toUpperCase(),region:b.p_region||null};DB.teams.push(t);
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
  team_delete:(u,b)=>{if(role(b.p_team,u)!=='titolare')throw new E('forbidden');DB.teams=DB.teams.filter(t=>t.id!==b.p_team);DB.members=DB.members.filter(m=>m.team_id!==b.p_team);DB.invites=DB.invites.filter(i=>i.team_id!==b.p_team);return null;},
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
  if(u.pathname.startsWith('/rest/v1/rpc/'))return J(null);
  if(u.pathname==='/rest/v1/sync_meta'||u.pathname==='/rest/v1/sync_items')return J([]);
  return J({});}

(async()=>{const b=await chromium.launch();let fail=0;const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)fail++;};
  async function device(who,o={}){const ctx=await b.newContext({viewport:{width:o.w||430,height:932},locale:'it-IT',colorScheme:o.dark?'dark':'light'});const p=await ctx.newPage();
    p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));await p.route('https://test.supabase.co/**',fake);
    await p.addInitScript(([who,U])=>{window.__MYTURN_SUPA={url:'https://test.supabase.co',key:'anon',vapid:'x'};
      if(!localStorage.getItem('myturn-v1')){localStorage.setItem('myturn-tour','1');localStorage.setItem('myturn-lang','it');
        localStorage.setItem('myturn-v1',JSON.stringify({days:{},settings:{setup:1,country:'IT'}}));
        if(who)localStorage.setItem('myturn-auth',JSON.stringify({access_token:who,refresh_token:'R',expires_at:Date.now()/1000+86400,user:{id:U[who].id,email:U[who].email}}));}},[who,USERS]);
    await p.goto(URL0+(o.q||''));await p.waitForTimeout(700);return p;}
  const settings=async p=>{await p.click('#setBtn');await p.waitForTimeout(250);};
  const overflow=(p,sel)=>p.evaluate(sel=>{const r=document.querySelector(sel+' .sheet').getBoundingClientRect();
    return [...document.querySelectorAll(sel+' .sheet *')].filter(e=>{const x=e.getBoundingClientRect();return x.width&&(x.right>r.right+1||x.left<r.left-1);}).map(e=>e.id||e.className||e.tagName).slice(0,5);},sel);

  // --- 0. senza ?business=1 non c'è niente
  {const p=await device('A');await settings(p);ok(await p.isHidden('#coRow'),'nascosto senza ?business=1');ok(!p.errs.length,'nessun errore '+p.errs.join('|'));await p.context().close();}

  // --- 1. il titolare crea l'azienda e aggiunge Luca
  const A=await device('A',{q:'?business=1'});await settings(A);
  ok(await A.isVisible('#coRow')&&/nessuna/.test(await A.textContent('#coLine')),'riga Azienda in Impostazioni: '+await A.textContent('#coLine'));
  ok(!/business=1/.test(await A.evaluate(()=>location.href)),'il parametro sparisce dall\'indirizzo');
  await A.click('#coBtn');await A.waitForTimeout(300);
  ok(await A.isVisible('#coCode')&&await A.isVisible('#coNewBtn'),'La mia azienda: codice e Crea la tua azienda');
  await A.click('#coNewBtn');await A.waitForTimeout(150);
  ok(await A.inputValue('#coCountry')==='IT','paese dell\'app già scelto');
  await A.click('#coCreate');await A.waitForTimeout(200);ok(/nome dell'azienda/.test(await A.textContent('#coStatus')),'nome vuoto: '+await A.textContent('#coStatus'));
  await A.fill('#coTeamName','Bar Centrale');await A.fill('#coMyName','Anna Rossi');await A.screenshot({path:path.join(OUT,'biz_crea.png')});
  await A.click('#coCreate');await A.waitForTimeout(1200);
  ok(await A.evaluate(()=>document.getElementById('tm')&&document.getElementById('tm').open),'si apre la Squadra (team.js caricato a parte) '+await A.textContent('#coStatus')+' '+A.errs.join('|'));
  ok(/Nuova persona/.test(await A.textContent('#tmTitle')),'squadra nuova: chiede subito la prima persona');
  await A.fill('#tmName','Luca Bianchi');await A.fill('#tmDept','Sala');await A.fill('#tmHours','40');await A.fill('#tmLeaveD','26');await A.fill('#tmLeaveH','32');
  await A.screenshot({path:path.join(OUT,'biz_persona.png')});
  await A.click('#tmActs .btn.primary');await A.waitForTimeout(600);
  ok(/Luca Bianchi è nella squadra/.test(await A.textContent('#tmStatus'))&&await A.isVisible('#tmInvite'),'Luca aggiunto, si propone l\'invito');
  const m=DB.members.find(x=>x.name==='Luca Bianchi');ok(m&&m.role==='dipendente'&&m.dept==='Sala'&&m.week_hours===40&&m.leave_days===26&&m.leave_hours===32&&!m.user_id,'sul server: '+JSON.stringify(m));
  await A.click('#tmInvite');await A.waitForTimeout(600);
  const inv=DB.invites.find(i=>i.member_id===m.id);ok(inv&&new RegExp(inv.code.slice(0,4)+' '+inv.code.slice(4)).test(await A.textContent('#tmInv .code')),'codice mostrato: '+await A.textContent('#tmInv .code'));
  ok(/Invitato, codice valido fino al/.test(await A.textContent('#tmSub')),'stato: invitato');
  await A.screenshot({path:path.join(OUT,'biz_invito.png')});
  await A.click('#tmActs .btn.ghost');await A.waitForTimeout(300);
  const rows=await A.$$eval('.tmrow',r=>r.map(x=>x.textContent));ok(rows.length===2&&/Anna Rossi · tu/.test(rows[0])&&/Titolare/.test(rows[0])&&/Luca Bianchi/.test(rows[1])&&/Invitato/.test(rows[1]),'elenco: '+rows.join(' | '));
  ok(/2 persone, 1 con l'app/.test(await A.textContent('#tmSub')),'riepilogo: '+await A.textContent('#tmSub'));
  ok(!(await overflow(A,'#tm')).length,'430: niente esce dalla Squadra');
  await A.screenshot({path:path.join(OUT,'biz_squadra.png')});

  // --- 2. Luca apre il link dell'invito
  const B=await device('B',{q:'?invito='+inv.code});await B.waitForTimeout(1500);
  ok(await B.evaluate(()=>document.getElementById('co').open),'il link apre La mia azienda');
  ok(/Bar Centrale ti ha aggiunto alla squadra come Luca Bianchi/.test(await B.textContent('#coPrev')),'anteprima: '+(await B.textContent('#coPrev')).slice(0,80));
  ok(/L'azienda vedrà/.test(await B.textContent('#coPrev'))&&/stima paga, busta paga/.test(await B.textContent('#coPrev')),'dice cosa vedrà e cosa no');
  ok(!(await overflow(B,'#co')).length,'430: niente esce da La mia azienda');
  await B.screenshot({path:path.join(OUT,'biz_entra.png')});
  await B.click('#coJoin');await B.waitForTimeout(800);
  ok(/Sei entrato in Bar Centrale/.test(await B.textContent('#coStatus')),'entrato: '+await B.textContent('#coStatus'));
  ok(/Bar Centrale/.test(await B.textContent('#coList'))&&/Dipendente/.test(await B.textContent('#coList'))&&!(await B.$('#coList [data-open]')),'scheda azienda, niente Apri la squadra per il dipendente');
  ok(DB.members.find(x=>x.id===m.id).user_id==='ub'&&DB.invites.find(i=>i.code===inv.code).used_at,'sul server Luca è collegato e il codice è usato');
  await B.screenshot({path:path.join(OUT,'biz_dentro.png')});
  // lo stesso codice non vale più
  await B.fill('#coCode',inv.code.toLowerCase());await B.click('#coGo');await B.waitForTimeout(500);
  ok(/non valido o scaduto/.test(await B.textContent('#coStatus')),'codice già usato: '+await B.textContent('#coStatus'));
  await B.click('#coClose');await settings(B);ok(/Azienda: Bar Centrale · Dipendente/.test(await B.textContent('#coLine')),'riga in Impostazioni: '+await B.textContent('#coLine'));

  // --- 3. il titolare vede Luca con l'app; aggiunge Marco come responsabile e lo invita
  await A.evaluate(()=>document.getElementById('tm').close());await A.waitForTimeout(300);
  await A.evaluate(()=>myturnDebug.coOpenTeam(myturnDebug.CO()[0]));await A.waitForTimeout(800);
  const rows2=await A.$$eval('.tmrow',r=>r.map(x=>x.textContent));ok(/Luca Bianchi.*Ha l'app · luca@bar.test/.test(rows2[1]),'Luca ha l\'app: '+rows2[1]);
  await A.click('#tmAdd');await A.waitForTimeout(200);await A.fill('#tmName','Marco Neri');await A.selectOption('#tmRole','responsabile');await A.fill('#tmDept','Cucina');
  await A.click('#tmActs .btn.primary');await A.waitForTimeout(600);await A.click('#tmInvite');await A.waitForTimeout(600);
  const mm=DB.members.find(x=>x.name==='Marco Neri'),inv2=DB.invites.find(i=>i.member_id===mm.id);ok(mm.role==='responsabile'&&inv2,'Marco responsabile, invitato');
  // il titolare non può togliersi il ruolo da solo
  await A.click('#tmActs .btn.ghost');await A.waitForTimeout(300);await A.click('.tmrow[data-p="0"]');await A.waitForTimeout(200);
  ok(await A.isHidden('#tmRemove'),'su se stesso niente Togli dalla squadra');
  await A.selectOption('#tmRole','dipendente');await A.click('#tmActs .btn.primary');await A.waitForTimeout(500);
  ok(/unico titolare/.test(await A.textContent('#tmStatus')),'ultimo titolare: '+await A.textContent('#tmStatus'));
  await A.click('#tmActs .btn.ghost');await A.waitForTimeout(200);

  // --- 4. Marco (responsabile) entra e apre la squadra: niente cambi di ruolo, niente modifiche al titolare
  const Cc=await device('C',{q:'?invito='+inv2.code});await Cc.waitForTimeout(1500);await Cc.click('#coJoin');await Cc.waitForTimeout(800);
  ok(await Cc.isVisible('#coList [data-open]'),'il responsabile ha Apri la squadra');
  await Cc.click('#coList [data-open]');await Cc.waitForTimeout(900);
  ok(await Cc.evaluate(()=>document.getElementById('tm').open)&&await Cc.isHidden('#tmTeam'),'squadra aperta, senza i dati dell\'azienda (solo titolare)');
  await Cc.click('.tmrow[data-p="0"]');await Cc.waitForTimeout(200);
  ok(await Cc.isDisabled('#tmName')&&await Cc.isDisabled('#tmRole'),'il titolare non si modifica');await Cc.click('#tmActs .btn');await Cc.waitForTimeout(200);
  const li=await Cc.$$eval('.tmrow',r=>r.findIndex(x=>/Luca/.test(x.textContent)));await Cc.click('.tmrow[data-p="'+li+'"]');await Cc.waitForTimeout(200);
  ok(await Cc.isDisabled('#tmRole')&&!(await Cc.isDisabled('#tmHours')),'Luca: ore modificabili, ruolo no');
  await Cc.fill('#tmHours','38');await Cc.click('#tmActs .btn.primary');await Cc.waitForTimeout(500);
  ok(DB.members.find(x=>x.id===m.id).week_hours===38,'il responsabile cambia le ore di Luca');
  ok(!Cc.errs.length,'C: nessun errore '+Cc.errs.join('|'));await Cc.context().close();

  // --- 5. senza account e con un codice inventato
  {const p=await device(null,{q:'?invito=ZZZZ2222'});await p.waitForTimeout(1500);
    ok(await p.evaluate(()=>document.getElementById('co').open)&&/serve l'account/.test(await p.textContent('#coNeed')),'senza account: chiede di accedere');
    ok(await p.isHidden('#coBox'),'senza account: niente codice né Crea');await p.context().close();}
  {const p=await device('C',{q:'?business=1'});await settings(p);await p.click('#coBtn');await p.waitForTimeout(400);
    await p.fill('#coCode','zzzz 2222');await p.click('#coGo');await p.waitForTimeout(500);ok(/non valido o scaduto/.test(await p.textContent('#coStatus')),'codice inventato');
    await p.fill('#coCode','ABC');await p.click('#coGo');await p.waitForTimeout(200);ok(/8 caratteri/.test(await p.textContent('#coStatus')),'codice corto');await p.context().close();}

  // --- 6. Luca esce dall'azienda (due tocchi): resta nella squadra senza app
  await B.click('#coBtn');await B.waitForTimeout(500);await B.click('#coList [data-leave]');await B.waitForTimeout(150);
  ok(/Tocca di nuovo/.test(await B.textContent('#coList [data-leave]')),'uscire chiede un secondo tocco');
  await B.click('#coList [data-leave]');await B.waitForTimeout(600);
  ok(/Sei uscito da Bar Centrale/.test(await B.textContent('#coStatus'))&&!(await B.$('#coList .cocard')),'Luca è uscito');
  const lm=DB.members.find(x=>x.id===m.id);ok(lm.status==='attivo'&&!lm.user_id&&!lm.email,'sul server resta nella squadra, senza account né email');
  ok(!B.errs.length,'B: nessun errore '+B.errs.join('|'));await B.context().close();

  // --- 7. il titolare: unico titolare non esce; elimina l'azienda (due tocchi)
  await A.evaluate(()=>document.getElementById('tm').close());await A.waitForTimeout(300);await settings(A);await A.click('#coBtn');await A.waitForTimeout(500);
  await A.click('#coList [data-leave]');await A.click('#coList [data-leave]');await A.waitForTimeout(500);ok(/unico titolare/.test(await A.textContent('#coStatus')),'il titolare unico non esce');
  await A.click('#coList [data-open]');await A.waitForTimeout(900);await A.click('#tmTeam');await A.waitForTimeout(200);
  await A.fill('#tmTName','Bar Centrale Srl');await A.click('#tmActs .btn.primary');await A.waitForTimeout(500);ok(DB.teams[0].name==='Bar Centrale Srl'&&/Bar Centrale Srl/.test(await A.textContent('#tmTitle')),'nome cambiato');
  await A.click('#tmTeam');await A.waitForTimeout(200);await A.click('#tmDelete');ok(/Tocca di nuovo/.test(await A.textContent('#tmDelete')),'eliminare chiede un secondo tocco');
  await A.click('#tmDelete');await A.waitForTimeout(900);ok(!DB.teams.length&&!(await A.evaluate(()=>document.getElementById('tm').open)),'azienda eliminata');
  ok(!A.errs.length,'A: nessun errore '+A.errs.join('|'));await A.context().close();

  // --- 8. 320 px e scuro
  for(const [w,dark] of [[320,false],[320,true]]){DB.teams=[];DB.members=[];DB.invites=[];
    const tid=RPC.team_create('ua',{p_name:'Ristorante Da Michele e Figli',p_country:'IT',p_my_name:'Anna Rossi'});
    const lid=RPC.team_member_save('ua',{p_team:tid,p_name:'Luca Bianchi Esposito',p_role:'dipendente',p_dept:'Sala e terrazza',p_week_hours:40});RPC.team_invite('ua',{p_team:tid,p_member:lid});
    const p=await device('A',{w,dark,q:'?business=1'});await settings(p);await p.click('#coBtn');await p.waitForTimeout(600);
    ok(!(await overflow(p,'#co')).length,w+(dark?' scuro':'')+': La mia azienda dentro lo schermo '+(await overflow(p,'#co')).join(','));
    await p.screenshot({path:path.join(OUT,'biz_co_'+w+(dark?'_dark':'')+'.png')});
    await p.click('#coList [data-open]');await p.waitForTimeout(900);
    ok(!(await overflow(p,'#tm')).length,w+(dark?' scuro':'')+': Squadra dentro lo schermo '+(await overflow(p,'#tm')).join(','));
    await p.screenshot({path:path.join(OUT,'biz_tm_'+w+(dark?'_dark':'')+'.png')});
    await p.click('.tmrow[data-p="1"]');await p.waitForTimeout(300);
    ok(!(await overflow(p,'#tm')).length,w+(dark?' scuro':'')+': scheda della persona dentro lo schermo');
    await p.screenshot({path:path.join(OUT,'biz_tm_persona_'+w+(dark?'_dark':'')+'.png'),fullPage:true});
    ok(!p.errs.length,'nessun errore '+p.errs.join('|'));await p.context().close();}

  console.log(fail?fail+' FALLITI':'tutto ok');await b.close();process.exit(fail?1:0);})();
