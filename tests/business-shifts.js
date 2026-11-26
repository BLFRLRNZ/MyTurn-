// MyTurn Business, tappa 2: turni della squadra con il Supabase finto di tests/business-fake.js.
// Squadra "Bar Centrale": Anna (A, titolare), Marco (C, responsabile), Luca (B, dipendente con l'app), Sara (senza app).
// Prova: tabella della settimana al computer, turni pronti, bozza salvata sul server, avviso sul riposo, ore della settimana,
// persone minime al giorno, casella con nota, Pubblica; Luca riceve i turni nel calendario (segno dell'azienda, non si
// cambiano, la sua nota sì); cambio e giorno tolto dopo la pubblicazione; butta la bozza; copia la settimana prima;
// il responsabile; Luca esce dall'azienda e i giorni restano suoi; telefono a 430 e 320 px, anche scuro.
// Uso: node tests/business-shifts.js   (serve il server su 8765). Foto in $OUT.
const {chromium}=require('playwright');const path=require('path'),os=require('os'),fs=require('fs');
const OUT=process.env.OUT||path.join(os.tmpdir(),'myturn-tests');fs.mkdirSync(OUT,{recursive:true});
const URL0='http://localhost:8765/index.html';
const {USERS,DB,RPC,fake}=require('./business-fake');

// la settimana di prova: la prima, da lunedì prossimo in poi, che sta tutta in un mese (così il calendario la mostra intera)
const pad=n=>String(n).padStart(2,'0'),key=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const add=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
const now=new Date(),mon0=add(now,-((now.getDay()+6)%7));let N=1;while(add(mon0,7*N).getMonth()!==add(mon0,7*N+6).getMonth())N++;
const MON=add(mon0,7*N),K=[...Array(7)].map((_,i)=>key(add(MON,i))),K2=[...Array(7)].map((_,i)=>key(add(MON,7+i)));
const MONTHS=(MON.getFullYear()-now.getFullYear())*12+MON.getMonth()-now.getMonth();

const PAST=key(add(now,-3));
// la squadra sul server finto
const tid=RPC.team_create('ua',{p_name:'Bar Centrale',p_country:'IT',p_my_name:'Anna Rossi'});
const luca=RPC.team_member_save('ua',{p_team:tid,p_name:'Luca Bianchi',p_role:'dipendente',p_dept:'Sala',p_week_hours:40});
const marco=RPC.team_member_save('ua',{p_team:tid,p_name:'Marco Neri',p_role:'responsabile',p_dept:'Cucina',p_week_hours:40});
const sara=RPC.team_member_save('ua',{p_team:tid,p_name:'Sara Verdi',p_role:'dipendente',p_dept:'Sala',p_week_hours:24});
RPC.team_join('ub',{p_code:RPC.team_invite('ua',{p_team:tid,p_member:luca})});
RPC.team_join('uc',{p_code:RPC.team_invite('ua',{p_team:tid,p_member:marco})});
const anna=DB.members.find(m=>m.user_id==='ua').id;
// un giorno già passato, pubblicato prima che Luca apra l'app (lui l'aveva segnato in un altro modo)
RPC.team_draft_set('ua',{p_team:tid,p_items:[{m:luca,d:PAST,v:{k:'w',s:'06:00',d:8}}]});RPC.team_publish('ua',{p_team:tid,p_from:PAST,p_to:PAST});
DB.push.add('ub');  // Luca ha le notifiche attive
// nella tabella: titolare, responsabile, dipendenti per nome
const ROW={[anna]:0,[marco]:1,[luca]:2,[sara]:3};
const cell=(m,k)=>'.plc[data-m="'+ROW[m]+'"][data-k="'+k+'"]';
const draft=(m,k)=>DB.draft.find(s=>s.member_id===m&&s.day===k);
const pub=(m,k)=>DB.shifts.find(s=>s.member_id===m&&s.day===k);

(async()=>{const b=await chromium.launch();let fail=0;const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)fail++;};
  async function device(who,o={}){const ctx=await b.newContext({viewport:{width:o.w||430,height:o.h||932},locale:'it-IT',colorScheme:o.dark?'dark':'light'});const p=await ctx.newPage();
    p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));await p.route('https://test.supabase.co/**',fake);
    await p.addInitScript(([who,U,D])=>{window.__MYTURN_SUPA={url:'https://test.supabase.co',key:'anon',vapid:'x'};
      if(!localStorage.getItem('myturn-v1')){localStorage.setItem('myturn-tour','1');localStorage.setItem('myturn-lang','it');
        localStorage.setItem('myturn-v1',JSON.stringify({days:D||{},settings:{setup:1,country:'IT'}}));
        localStorage.setItem('myturn-auth',JSON.stringify({access_token:who,refresh_token:'R',expires_at:Date.now()/1000+86400,user:{id:U[who].id,email:U[who].email}}));}},[who,USERS,o.days]);
    await p.goto(URL0+(o.q==null?'?business=1':o.q));await p.waitForTimeout(2200);return p;}
  const overflow=(p,sel)=>p.evaluate(sel=>{const r=document.querySelector(sel+' .sheet').getBoundingClientRect();
    return [...document.querySelectorAll(sel+' .sheet *')].filter(e=>{const x=e.getBoundingClientRect();return x.width&&(x.right>r.right+1||x.left<r.left-1);}).map(e=>e.id||e.className||e.tagName).slice(0,5);},sel);
  const txt=(p,sel)=>p.textContent(sel).then(x=>(x||'').replace(/\s+/g,' ').trim());
  const plan=async(p,weeks)=>{await p.evaluate(()=>myturnDebug.coOpenTeam(myturnDebug.CO()[0]));await p.waitForTimeout(700);
    await p.click('#tmPlan');await p.waitForTimeout(700);for(let i=0;i<weeks;i++){await p.click('#plNext');await p.waitForTimeout(500);}};
  const settle=p=>p.waitForTimeout(1400);  // mezzo secondo prima di salvare, poi la settimana si ricarica
  const toastAfter=async(p,re,ms=5000)=>{for(let t=0;t<ms;t+=150){const x=await p.evaluate(()=>{const e=document.getElementById('toast');return e.hidden?'':e.textContent;});if(re.test(x))return x;await p.waitForTimeout(150);}
    return await p.evaluate(()=>document.getElementById('toast').textContent);};

  // --- 1. Anna al computer prepara la settimana
  const A=await device('A',{w:1280,h:900});await plan(A,0);
  ok(await A.isVisible('.plgrid')&&await A.evaluate(()=>document.getElementById('tm').classList.contains('tmwide')),'al computer: tabella persone × giorni, pannello largo');
  ok(/Turni della squadra/.test(await txt(A,'#tmTitle'))&&/Tutto pubblicato/.test(await txt(A,'#tmBody')),'titolo e stato: '+(await txt(A,'#tmBody .bpst')));
  ok(await A.isDisabled('#tmActs .btn.primary'),'niente da pubblicare: Pubblica spento');
  for(let i=0;i<N;i++){await A.click('#plNext');await A.waitForTimeout(500);}
  ok((await A.$$eval('.plc',c=>c.length))===28&&await A.$(cell(luca,K[0])),'4 persone × 7 giorni, settimana del '+K[0]);
  await A.click('#tm .plbrush [data-b="p0"]');await A.waitForTimeout(150);
  ok(await A.getAttribute('#tm .plbrush [data-b="p0"]','aria-pressed')==='true'&&/Tocca le caselle/.test(await txt(A,'#tmBody .help')),'turno pronto Mattina scelto');
  for(const k of K.slice(0,5))await A.click(cell(luca,k));
  ok((await A.$$eval('.plc.dr',c=>c.length))===5&&/06–14/.test(await txt(A,cell(luca,K[0]))),'5 caselle in bozza: '+await txt(A,cell(luca,K[0])));
  await settle(A);
  ok(DB.draft.length===5&&K.slice(0,5).every(k=>{const d=draft(luca,k);return d&&d.v.k==='w'&&d.v.s==='06:00'&&d.v.d===8;}),'la bozza è sul server: '+JSON.stringify(DB.draft[0]&&DB.draft[0].v));
  ok(/Bozza: 5 modifiche/.test(await txt(A,'#tmBody .bpst'))&&/Pubblica 5 modifiche/.test(await txt(A,'#tmActs .btn.primary'))&&!(await A.isDisabled('#tmActs .btn.primary')),'Pubblica 5 modifiche');
  // notte di martedì e mattina di mercoledì: zero ore di riposo
  await A.click('#tm .plbrush [data-b="p2"]');await A.click(cell(luca,K[1]));await settle(A);
  ok(await A.$(cell(luca,K[2])+'.wr')&&/Luca Bianchi: tra .* riposa 0 ore, il minimo è 11/.test(await txt(A,'.plwarn')),'avviso sul riposo: '+(await A.$('.plwarn')?await txt(A,'.plwarn'):'nessuno'));
  await A.click('#tm .plbrush [data-b="r"]');await A.click(cell(luca,K[2]));await settle(A);
  ok(!(await A.$('.plc.wr'))&&!(await A.$('.plwarn')),'con il riposo di mercoledì l\'avviso sparisce');
  // Sara il pomeriggio da lunedì a mercoledì
  await A.click('#tm .plbrush [data-b="p1"]');for(const k of K.slice(0,3))await A.click(cell(sara,k));await settle(A);
  const hrs=await A.$$eval('.plhrs',c=>c.map(x=>x.textContent));
  ok(hrs[ROW[luca]]==='32/40 h'&&hrs[ROW[sara]]==='24/24 h','ore della settimana: Luca '+hrs[ROW[luca]]+', Sara '+hrs[ROW[sara]]);
  // persone minime al giorno (solo il titolare)
  await A.click('#plMin');await A.waitForTimeout(200);await A.fill('#plMinN','2');await A.click('#tmActs .btn.primary');await A.waitForTimeout(500);
  ok(DB.teams[0].settings.min===2&&/minime al giorno: 2/.test(await txt(A,'#plMin')),'minimo 2 persone salvato sul server');
  const foot=await A.$$eval('.plfoot.n',c=>c.map(x=>x.textContent+(x.classList.contains('wr')?'!':'')));
  ok(foot.join(' ')==='2/2 2/2 1/2! 1/2! 1/2! 0/2! 0/2!'&&/in servizio 1, il minimo è 2/.test(await txt(A,'.plwarn')),'in servizio: '+foot.join(' '));
  // una casella a mano: giovedì di Luca dalle 9 per 6 ore, con una nota
  await A.click('#tm .plbrush [data-b="p1"]');await A.waitForTimeout(100);ok(!(await A.$('.plbrush [aria-pressed="true"]')),'toccando di nuovo il turno pronto si smette');
  await A.click(cell(luca,K[3]));await A.waitForTimeout(200);
  ok(/Luca Bianchi/.test(await txt(A,'#tmTitle'))&&await A.isVisible('#plS'),'la casella si apre');
  await A.fill('#plS','09:00');await A.fill('#plD','6');await A.fill('#plN','Porta le chiavi');await A.click('#tmActs .btn.primary');await settle(A);
  ok(/09–15/.test(await txt(A,cell(luca,K[3])))&&await A.$(cell(luca,K[3])+' .nt'),'giovedì 09–15 con la nota');
  const dth=draft(luca,K[3]);ok(dth&&dth.v.s==='09:00'&&dth.v.d===6&&dth.v.n==='Porta le chiavi','sul server: '+JSON.stringify(dth&&dth.v));
  ok(!(await overflow(A,'#tm')).length,'1280: la tabella sta nel pannello '+(await overflow(A,'#tm')).join(','));
  await A.screenshot({path:path.join(OUT,'biz_turni_1280.png')});
  await A.click('#tmActs .btn.primary');await A.waitForTimeout(900);
  const wk=DB.shifts.filter(x=>x.day>=K[0]&&x.day<=K[6]).length;ok(wk===8&&!DB.draft.length,'pubblicati 8 giorni, bozza vuota ('+wk+', '+DB.draft.length+')');
  ok(DB.notices.length===1&&DB.notices[0].user_id==='ub'&&DB.notices[0].title==='Bar Centrale'&&/turni nuovi o cambiati/.test(DB.notices[0].body),'avviso solo a Luca (notifiche attive), non a chi pubblica: '+JSON.stringify(DB.notices));
  ok(/Pubblicati 8 giorni/.test(await txt(A,'#tmStatus'))&&/Tutto pubblicato/.test(await txt(A,'#tmBody .bpst'))&&await A.isDisabled('#tmActs .btn.primary'),'stato: '+await txt(A,'#tmStatus'));

  // --- 2. Luca li trova nel calendario. Aveva già segnato martedì (uguale), venerdì (diverso) e un giorno passato (diverso)
  const B=await device('B',{days:{[K[1]]:{k:'w',s:'22:00'},[K[4]]:{k:'w',s:'07:00',n:'Dal foglio'},[PAST]:{k:'w',s:'09:00'}}});
  const tb=await toastAfter(B,/Ricevuti/);
  ok(/Ricevuti da Bar Centrale i turni di 5 giorni\. Un giorno l'avevi segnato tu in un altro modo: con Annulla lo tieni\./.test(tb),'avviso: '+tb);
  ok(DB.profiles.ub==='it','la lingua dell\'app è sul server, per l\'avviso');
  const d0=await B.evaluate(()=>myturnDebug.S.days);
  ok(d0[K[4]].s==='06:00'&&d0[K[4]].co&&d0[K[4]].n==='Dal foglio','venerdì: vince l\'azienda, la nota resta');
  await B.click('#toastUndo');await B.waitForTimeout(300);
  const days=await B.evaluate(()=>myturnDebug.S.days);
  ok(days[K[4]].s==='07:00'&&!days[K[4]].co&&/Tenuto il giorno che avevi segnato tu/.test(await B.evaluate(()=>document.getElementById('toast').textContent)),'con Annulla venerdì torna quello di Luca');
  ok(await B.evaluate(()=>myturnDebug.coPull())===0&&(await B.evaluate(k=>myturnDebug.S.days[k].s,K[4]))==='07:00','alla prossima lettura venerdì resta suo');
  ok(days[K[1]].co&&days[K[1]].s==='22:00','martedì era uguale: prende il segno dell\'azienda');
  ok(days[PAST].s==='09:00'&&!days[PAST].co,'il giorno passato segnato da Luca non si tocca');
  ok(days[K[0]]&&days[K[0]].k==='w'&&days[K[0]].s==='06:00'&&days[K[0]].co&&days[K[0]].co.t===tid&&days[K[0]].co.v===1,'lunedì: '+JSON.stringify(days[K[0]]));
  ok(days[K[2]]&&days[K[2]].k==='r'&&days[K[2]].co&&days[K[3]].s==='09:00'&&days[K[3]].co.n==='Porta le chiavi'&&!days[K[5]],'riposo, giovedì con la nota dell\'azienda, sabato vuoto');
  for(let i=0;i<MONTHS;i++){await B.click('#next');await B.waitForTimeout(250);}
  ok((await B.$$eval('#grid .day.co',d=>d.length))===4&&await B.$('#grid .day[data-k="'+K[0]+'"] .cob'),'4 giorni con il segno dell\'azienda (venerdì è di Luca)');
  await B.screenshot({path:path.join(OUT,'biz_turni_calendario.png')});
  // non si cambiano con l'inserimento rapido
  await B.click('#chips [data-b="r"]');await B.click('#grid .day[data-k="'+K[0]+'"]');
  const tl=await toastAfter(B,/azienda/,2000);ok(/È un turno dell'azienda/.test(tl)&&(await B.evaluate(k=>myturnDebug.S.days[k].k,K[0]))==='w','inserimento rapido bloccato: '+tl);
  await B.click('#chips [data-b="r"]');await B.waitForTimeout(150);
  // la scheda del giorno: orari bloccati, la nota di Luca sì
  await B.click('#grid .day[data-k="'+K[3]+'"]');await B.waitForTimeout(400);
  ok(await B.evaluate(()=>document.getElementById('edForm').classList.contains('colock'))&&await B.isDisabled('#edStart')&&await B.isHidden('#edDel'),'scheda: orari bloccati, niente Svuota');
  ok(/Turno di Bar Centrale: lo decide l'azienda/.test(await txt(B,'#edCo'))&&/Nota dell'azienda: Porta le chiavi/.test(await txt(B,'#edCo')),'scheda: '+await txt(B,'#edCo'));
  await B.fill('#edNote','Cambio con Sara');await B.waitForTimeout(900);
  await B.screenshot({path:path.join(OUT,'biz_turni_scheda.png')});
  await B.click('#edSave');await B.waitForTimeout(400);
  const th=await B.evaluate(k=>myturnDebug.S.days[k],K[3]);ok(th.n==='Cambio con Sara'&&th.s==='09:00'&&th.d===6&&th.co&&th.co.t===tid,'nota di Luca salvata, il turno resta: '+JSON.stringify(th));

  // --- 2b. l'app sulla Home dell'iPhone non ha ?business=1: chi è in un'azienda la ritrova da solo (coFind); con ?business=0 no
  const H=await device('B',{q:''});await H.waitForTimeout(3500);
  const hd=await H.evaluate(()=>({biz:myturnDebug.BIZ(),co:Object.values(myturnDebug.S.days).filter(e=>e.co).length}));
  ok(hd.biz&&hd.co===6,'app sulla Home: MyTurn Business si accende da solo e arrivano i turni ('+hd.co+' giorni, con quello passato)');
  ok(!H.errs.length,'app sulla Home: nessun errore '+H.errs.join('|'));await H.context().close();
  const H0=await device('B',{q:'?business=0'});await H0.waitForTimeout(3500);
  ok(!(await H0.evaluate(()=>myturnDebug.BIZ())),'con ?business=0 resta spento');await H0.context().close();

  // --- 3. Anna cambia lunedì e toglie giovedì; Luca riceve le modifiche
  await A.click('#tm .plbrush [data-b="p1"]');await A.click(cell(luca,K[0]));await A.click('#tm .plbrush [data-b="clear"]');await A.click(cell(luca,K[3]));await settle(A);
  ok(/Pubblica 2 modifiche/.test(await txt(A,'#tmActs .btn.primary')),'2 modifiche dopo la pubblicazione');
  await A.click('#tmActs .btn.primary');await A.waitForTimeout(900);
  ok(pub(luca,K[0]).v.s==='14:00'&&pub(luca,K[0]).version===2&&!pub(luca,K[3]),'sul server: lunedì versione 2, giovedì tolto');
  const n2=await B.evaluate(()=>myturnDebug.coPull());const t2=await toastAfter(B,/cambiato/,2000);
  ok(n2===2&&/Bar Centrale ha cambiato 2 giorni nei tuoi turni/.test(t2),'avviso: '+t2);
  const d2=await B.evaluate(()=>myturnDebug.S.days);
  ok(d2[K[0]].s==='14:00'&&d2[K[0]].co.v===2&&d2[K[3]]&&d2[K[3]].k==='r'&&d2[K[3]].n==='Cambio con Sara'&&!d2[K[3]].co,'lunedì alle 14; giovedì tolto ma la nota di Luca resta');
  ok(await B.$('#grid .day.conew[data-k="'+K[0]+'"]'),'lunedì evidenziato come nuovo');
  ok(DB.notices.length===2,'secondo avviso a Luca');
  await B.click('#grid .day[data-k="'+K[0]+'"]');await B.waitForTimeout(300);
  ok(/Prima era: turno 06:00–14:00\./.test(await txt(B,'#edCo')),'la scheda dice com\'era prima: '+await txt(B,'#edCo'));
  await B.click('#edSave');await B.waitForTimeout(300);
  ok(!(await B.$('#grid .day.conew[data-k="'+K[0]+'"]')),'aperto il giorno, non è più evidenziato');

  // --- 4. butta la bozza (due tocchi)
  await A.click('#tm .plbrush [data-b="p2"]');await A.click(cell(sara,K[3]));await settle(A);ok(DB.draft.length===1,'una modifica in bozza');
  await A.click('#plDiscard');await A.waitForTimeout(150);ok(/Tocca di nuovo/.test(await txt(A,'#plDiscard')),'buttare la bozza chiede un secondo tocco');
  await A.click('#plDiscard');await A.waitForTimeout(700);
  ok(!DB.draft.length&&/Bozza buttata/.test(await txt(A,'#tmStatus'))&&!(await txt(A,cell(sara,K[3]))),'bozza buttata: '+await txt(A,'#tmStatus'));

  // --- 5. copia la settimana prima
  await A.click('#tm .plbrush [data-b="p2"]');await A.waitForTimeout(100);  // smette di mettere turni
  await A.click('#plNext');await A.waitForTimeout(600);await A.click('#plCopy');await A.waitForTimeout(150);
  ok(/Tocca di nuovo per copiare/.test(await txt(A,'#plCopy')),'copiare chiede un secondo tocco');
  await A.click('#plCopy');await A.waitForTimeout(1500);
  const cp=DB.draft.filter(s=>s.day>=K2[0]);
  ok(cp.length===7&&draft(luca,K2[0]).v.s==='14:00'&&draft(luca,K2[2]).v.k==='r'&&draft(sara,K2[1]).v.s==='14:00'&&!draft(luca,K2[3]),'copiati 7 giorni in bozza ('+cp.length+')');
  ok(/Copiati 7 giorni dalla settimana prima/.test(await txt(A,'#tmStatus')),'stato: '+await txt(A,'#tmStatus'));
  await A.click('#plCopy');await A.click('#plCopy');await A.waitForTimeout(1200);
  ok(/uguale a questa/.test(await txt(A,'#tmStatus'))&&DB.draft.length===7,'copiando di nuovo non cambia niente');
  ok(!A.errs.length,'A: nessun errore '+A.errs.join('|'));

  // --- 6. il responsabile: prepara i turni, non cambia il minimo
  const Cc=await device('C',{w:1280,h:900});await plan(Cc,N+1);
  ok(/Bozza: 7 modifiche/.test(await txt(Cc,'#tmBody .bpst'))&&!(await Cc.$('#plMin')),'vede la bozza di Anna; niente persone minime');
  await Cc.click('#tm .plbrush [data-b="p0"]');await Cc.click(cell(sara,K2[5]));await settle(Cc);
  ok(draft(sara,K2[5])&&draft(sara,K2[5]).updated_by==='uc','il responsabile scrive nella bozza');
  ok(!Cc.errs.length,'C: nessun errore '+Cc.errs.join('|'));await Cc.context().close();

  // --- 7. Luca esce dall'azienda: i giorni restano nel suo calendario, senza il segno
  await B.click('#setBtn');await B.waitForTimeout(250);await B.click('#coBtn');await B.waitForTimeout(500);
  await B.click('#coList [data-leave]');await B.click('#coList [data-leave]');await B.waitForTimeout(900);
  const d3=await B.evaluate(()=>myturnDebug.S.days);
  ok(Object.values(d3).every(e=>!e.co)&&d3[K[0]].s==='14:00'&&d3[K[1]].s==='22:00','uscito: i giorni restano, senza segno');
  await B.click('#coClose');await B.waitForTimeout(200);await B.keyboard.press('Escape');await B.waitForTimeout(200);
  ok(!(await B.$$eval('#grid .day.co',d=>d.length)),'calendario senza segni dell\'azienda');
  ok(!B.errs.length,'B: nessun errore '+B.errs.join('|'));await B.context().close();
  await A.context().close();

  // --- 8. al telefono: un giorno alla volta (430 e 320, anche scuro)
  for(const [w,dark] of [[430,false],[320,false],[320,true]]){
    const p=await device('A',{w,dark});await plan(p,N);const tag=w+(dark?' scuro':'');
    ok(!(await p.$('.plgrid'))&&await p.isVisible('.pldays')&&(await p.$$eval('.plrow',r=>r.length))===4,tag+': giorni in alto, 4 persone');
    await p.click('.pldays [data-day="0"]');await p.waitForTimeout(150);
    ok(/14–22/.test(await txt(p,'.plrow[data-m="'+ROW[luca]+'"]'))&&/Luca Bianchi/.test(await txt(p,'.plrow[data-m="'+ROW[luca]+'"]')),tag+': lunedì Luca 14–22');
    ok(!(await overflow(p,'#tm')).length,tag+': niente esce '+(await overflow(p,'#tm')).join(','));
    await p.screenshot({path:path.join(OUT,'biz_turni_'+w+(dark?'_dark':'')+'.png')});
    await p.evaluate(()=>{const d=document.getElementById('tm');d.scrollTop=d.scrollHeight;});await p.waitForTimeout(150);
    await p.screenshot({path:path.join(OUT,'biz_turni_'+w+(dark?'_dark':'')+'_fine.png')});
    if(w===430){ok(/In altre settimane ci sono 8 modifiche da pubblicare/.test(await txt(p,'#tmBody .bpst')),'430: avvisa della bozza in altre settimane');
      await p.click('#tm .plbrush [data-b="p0"]');await p.click('.plrow[data-m="'+ROW[anna]+'"]');await settle(p);
      ok(draft(anna,K[0])&&draft(anna,K[0]).v.s==='06:00','430: Anna si mette la mattina di lunedì');await p.click('#tm .plbrush [data-b="p0"]');}
    await p.click('.plrow[data-m="'+ROW[sara]+'"]');await p.waitForTimeout(250);
    ok(await p.isVisible('#plS')&&await p.isVisible('#plClear')&&!(await overflow(p,'#tm')).length,tag+': casella dentro lo schermo, con Svuota la casella');
    await p.screenshot({path:path.join(OUT,'biz_turni_casella_'+w+(dark?'_dark':'')+'.png')});
    ok(!p.errs.length,tag+': nessun errore '+p.errs.join('|'));await p.context().close();}

  console.log(fail?fail+' FALLITI':'tutto ok');await b.close();process.exit(fail?1:0);})();
