/* MyTurn Business – sezione Squadra (tappa 1 del progetto "MyTurn Business – Progetto").
   La carica index.html solo per chi gestisce un'azienda (coTeamLoad) e le passa le sue funzioni: t, tn, esc, sbFetch,
   openDlg, unlockPage, toast, ctryName, coLoad, coErr, coFmt, coRoleName, SITE, NATIVE, CAP, loc() e ctrys().
   Tappa 1: persone con ruolo, reparto, ore di contratto, ferie e permessi; inviti con codice e link; dati dell'azienda.
   Tappa 2: turni della squadra (renderPlan): tabella persone × giorni al computer, un giorno alla volta sul telefono,
   turni pronti da mettere con un tocco, bozza, Pubblica, controlli su riposi, ore e persone minime.
   Tutte le scritture passano dalle funzioni del server team_* (supabase/migrations/20261125180000_aziende.sql),
   che controllano di nuovo il ruolo: qui si nasconde solo quello che il server rifiuterebbe.
   Il codice di index.html sta dentro una funzione: le sue funzioni arrivano qui nell'oggetto K (vedi coTeamLoad). */
window.MyTurnTeamInit=function(K){
"use strict";
const {t,tn,esc,sbFetch,openDlg,unlockPage,toast,ctryName,coLoad,coErr,coFmt,coRoleName,SITE,NATIVE,CAP}=K;
const loc=()=>K.loc();
const ROLES=["titolare","responsabile","dipendente"];
let C=null,P=[],INV={},cur=null,arm="",lastCode=null,view="list";

const D=document.createElement("dialog");D.id="tm";D.setAttribute("aria-labelledby","tmTitle");
D.innerHTML='<form class="sheet" method="dialog"><h2 id="tmTitle" style="text-transform:none"></h2><p class="sub" id="tmSub"></p><div id="tmBody"></div><p class="bpst" id="tmStatus" aria-live="polite" hidden></p><div class="actions" id="tmActs"></div></form>';
document.body.appendChild(D);
D.addEventListener("click",ev=>{if(ev.target===D)D.close();});
D.addEventListener("close",()=>{flush();D.classList.remove("tmwide");unlockPage();coLoad();});
D.querySelector("form").addEventListener("submit",ev=>ev.preventDefault());
const q=id=>D.querySelector("#"+id);

const boss=()=>C.role==="titolare";
const canEdit=p=>boss()||p.role==="dipendente";
const num=v=>{v=String(v==null?"":v).trim().replace(",",".");if(!v)return null;const n=Number(v);return isFinite(n)?n:NaN;};
const fmtN=n=>n==null?"":Number(n).toLocaleString(loc(),{maximumFractionDigits:1});
const day=d=>new Date(d).toLocaleDateString(loc(),{day:"numeric",month:"short"});
const countries=sel=>Object.keys(K.ctrys()).map(c=>[c,ctryName(c)]).sort((a,b)=>a[1].localeCompare(b[1],loc()))
  .map(([v,l])=>'<option value="'+esc(v)+'"'+(v===sel?" selected":"")+">"+esc(l)+"</option>").join("");
function stat(msg,cls){const e=q("tmStatus");e.hidden=!msg;e.className="bpst"+(cls?" "+cls:"");e.textContent=msg||"";}
function acts(list){q("tmActs").innerHTML=list.map((a,i)=>'<button type="button" class="btn '+a[1]+'" data-a="'+i+'" style="flex:1">'+esc(a[0])+"</button>").join("");
  q("tmActs").querySelectorAll("[data-a]").forEach(b=>b.onclick=list[+b.dataset.a][2]);}
const close=()=>D.close();

async function load(){const id=encodeURIComponent(C.team_id);
  const [p,i]=await Promise.all([
    sbFetch("/rest/v1/team_members?team_id=eq."+id+"&status=eq.attivo&select=id,user_id,name,email,role,dept,week_hours,leave_days,leave_hours,joined_at&order=name",{method:"GET"}),
    sbFetch("/rest/v1/team_invites?team_id=eq."+id+"&used_at=is.null&select=code,member_id,expires_at",{method:"GET"})]);
  P=(Array.isArray(p)?p:[]).sort((a,b)=>ROLES.indexOf(a.role)-ROLES.indexOf(b.role)||a.name.localeCompare(b.name,loc()));
  INV={};(Array.isArray(i)?i:[]).forEach(x=>{if(new Date(x.expires_at)>new Date())INV[x.member_id]=x;});}

/* stato di una persona: ha l'app, è invitata (fino a quando), oppure niente */
function state(p){const i=INV[p.id];
  return p.user_id?["on",p.email?t("Ha l'app")+" · "+p.email:t("Ha l'app")]:
    i?["inv",t("Invitato, codice valido fino al {d}",{d:day(i.expires_at)})]:["",t("Senza app")];}

function renderList(){cur=null;arm="";view="list";D.classList.remove("tmwide");
  const withApp=P.filter(p=>p.user_id).length;
  q("tmTitle").textContent=C.team;
  q("tmSub").textContent=tn(P.length,"{n} persona, {k} con l'app","{n} persone, {k} con l'app",{k:withApp.toLocaleString(loc())});
  let h='<button type="button" class="btn primary" id="tmPlan">'+esc(t("Turni della squadra"))+'</button><button type="button" class="btn" id="tmAdd">'+esc(t("Aggiungi una persona"))+"</button>";
  h+=P.map((p,k)=>{const [cls,txt]=state(p),meta=[p.dept,p.week_hours!=null?t("{h} h a settimana",{h:fmtN(p.week_hours)}):""].filter(Boolean).join(" · ");
    return '<button type="button" class="tmrow" data-p="'+k+'"><b>'+esc(p.name)+(p.id===C.member_id?" · "+esc(t("tu")):"")+'</b><span class="cotag">'+esc(coRoleName(p.role))+"</span>"+
      (meta?"<small>"+esc(meta)+"</small>":"")+'<small><i class="'+cls+'"></i>'+esc(txt)+"</small></button>";}).join("");
  if(boss())h+='<h3 class="sect">'+esc(t("Azienda"))+'</h3><button type="button" class="btn" id="tmTeam">'+esc(t("Nome e paese dell'azienda"))+"</button>";
  q("tmBody").innerHTML=h;
  q("tmAdd").onclick=()=>{stat("");renderPerson(null);};q("tmPlan").onclick=()=>{stat("");openPlan();};
  q("tmBody").querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{stat("");renderPerson(P[+b.dataset.p]);});
  if(boss())q("tmTeam").onclick=()=>{stat("");renderTeam();};
  acts([[t("Chiudi"),"primary",close]]);}

function renderPerson(p){cur=p;arm="";lastCode=null;view="person";
  const editable=!p||canEdit(p),roles=boss()?ROLES:["dipendente"];
  q("tmTitle").textContent=p?p.name:t("Nuova persona");
  q("tmSub").textContent=p?state(p)[1]:t("Aggiungi chi lavora con te, anche se non ha ancora l'app.");
  const dis=editable?"":" disabled";
  const f=(id,label,val,extra)=>'<div class="field"><label class="eyebrow" for="'+id+'">'+esc(label)+'</label><input type="text" id="'+id+'" value="'+esc(val==null?"":val)+'" '+extra+dis+"></div>";
  const n=(id,label,val)=>f(id,label,fmtN(val),'inputmode="decimal" autocomplete="off"');
  let h=f("tmName",t("Nome e cognome"),p&&p.name,'maxlength="80" autocomplete="off"')+
    '<div class="field"><label class="eyebrow" for="tmRole">'+esc(t("Ruolo"))+'</label><select id="tmRole"'+(editable&&roles.length>1?"":" disabled")+">"+
      (p&&!roles.includes(p.role)?[p.role]:roles).map(r=>'<option value="'+r+'"'+((p?p.role:"dipendente")===r?" selected":"")+">"+esc(coRoleName(r))+"</option>").join("")+"</select></div>"+
    f("tmDept",t("Reparto"),p&&p.dept,'maxlength="40" autocomplete="off"')+
    '<div class="row">'+n("tmHours",t("Ore a settimana"),p&&p.week_hours)+n("tmLeaveD",t("Ferie, giorni all'anno"),p&&p.leave_days)+n("tmLeaveH",t("Permessi, ore all'anno"),p&&p.leave_hours)+"</div>";
  if(p&&!p.user_id&&editable)h+='<div class="tminv" id="tmInv"></div>';
  if(p&&editable&&p.id!==C.member_id)h+='<button type="button" class="linkbtn" id="tmRemove">'+esc(t("Togli dalla squadra"))+"</button>";
  q("tmBody").innerHTML=h;
  if(q("tmInv"))invBox();
  if(q("tmRemove"))q("tmRemove").onclick=remove;
  acts(editable?[[t("Indietro"),"ghost",back],[p?t("Salva"):t("Aggiungi"),"primary",save]]:[[t("Indietro"),"primary",back]]);}

function invBox(){const p=cur,i=INV[p.id],code=lastCode||i&&i.code,box=q("tmInv");
  if(!code){box.innerHTML='<p class="help">'+esc(t("Mandagli un invito: con il link entra nella squadra dal suo MyTurn."))+'</p><button type="button" class="btn primary" id="tmInvite">'+esc(t("Crea l'invito"))+"</button>";
    q("tmInvite").onclick=invite;return;}
  box.innerHTML='<p class="eyebrow">'+esc(t("Codice d'invito"))+'</p><div class="code">'+esc(coFmt(code))+"</div>"+
    '<p class="help">'+esc(t("Vale 14 giorni e una volta sola. Manda il link a {name}: lo apre sul telefono ed entra nella squadra.",{name:p.name}))+"</p>"+
    '<div class="corow"><button type="button" class="btn primary" id="tmShare">'+esc(t("Manda l'invito"))+'</button><button type="button" class="linkbtn" id="tmNewCode">'+esc(t("Nuovo codice"))+"</button></div>";
  q("tmShare").onclick=()=>share(p,code);q("tmNewCode").onclick=invite;}

async function invite(){stat(t("Creo l'invito…"));
  try{lastCode=await sbFetch("/rest/v1/rpc/team_invite",{body:{p_team:C.team_id,p_member:cur.id}});await load();stat("");
    cur=P.find(x=>x.id===cur.id)||cur;q("tmSub").textContent=state(cur)[1];invBox();}
  catch(e){stat(coErr(e),"err");}}

async function share(p,code){const link=SITE+"?invito="+code;
  const txt=t("Ciao {name}, ti ho aggiunto alla squadra di {team} su MyTurn. Apri questo link per entrare: {link} (codice {code})",{name:p.name.split(" ")[0],team:C.team,link,code:coFmt(code)});
  try{if(NATIVE&&CAP.Share){await CAP.Share.share({title:"MyTurn",text:txt,dialogTitle:t("Manda l'invito")});return;}
    if(navigator.share){await navigator.share({title:"MyTurn",text:txt});return;}}
  catch(e){if(e&&(e.name==="AbortError"||/cancel/i.test(String(e.message))))return;}
  try{await navigator.clipboard.writeText(txt);toast(t("Invito copiato: incollalo in un messaggio."));}catch(e){toast(t("Copia non disponibile qui."));}}

async function save(){const name=q("tmName").value.trim(),dept=q("tmDept").value.trim(),
    role=boss()?q("tmRole").value:(cur?cur.role:"dipendente"),
    h=num(q("tmHours").value),ld=num(q("tmLeaveD").value),lh=num(q("tmLeaveH").value);
  if(!name){stat(t("Scrivi il nome."),"err");return;}
  if([h,ld,lh].some(x=>Number.isNaN(x))||h!=null&&(h<0||h>80)||ld!=null&&(ld<0||ld>100)||lh!=null&&(lh<0||lh>1000)){
    stat(t("Controlla i numeri: ore da 0 a 80, ferie da 0 a 100 giorni, permessi da 0 a 1000 ore."),"err");return;}
  stat(t("Salvo…"));
  try{const id=await sbFetch("/rest/v1/rpc/team_member_save",{body:{p_team:C.team_id,p_id:cur?cur.id:null,p_name:name,p_role:ROLES.includes(role)?role:"dipendente",p_dept:dept||null,p_week_hours:h,p_leave_days:ld,p_leave_hours:lh}});
    const added=!cur;await load();const p=P.find(x=>x.id===id);
    if(added&&p){renderPerson(p);stat(t("{x} è nella squadra. Ora mandagli l'invito.",{x:p.name}),"ok");}
    else{renderList();stat(t("Salvato."),"ok");}}
  catch(e){stat(coErr(e),"err");}}

async function remove(){const p=cur;
  if(arm!==p.id){arm=p.id;q("tmRemove").textContent=t("Tocca di nuovo per togliere {x}",{x:p.name});
    setTimeout(()=>{if(arm===p.id&&q("tmRemove")){arm="";q("tmRemove").textContent=t("Togli dalla squadra");}},5000);return;}
  arm="";stat(t("Tolgo {x} dalla squadra…",{x:p.name}));
  try{await sbFetch("/rest/v1/rpc/team_member_remove",{body:{p_team:C.team_id,p_id:p.id}});await load();renderList();stat(t("{x} non fa più parte della squadra.",{x:p.name}),"ok");}
  catch(e){stat(coErr(e),"err");}}

function renderTeam(){arm="";view="team";
  q("tmTitle").textContent=t("Azienda");q("tmSub").textContent=t("Il paese decide festività e regole su riposi e ore.");
  q("tmBody").innerHTML='<div class="field"><label class="eyebrow" for="tmTName">'+esc(t("Nome dell'azienda"))+'</label><input type="text" id="tmTName" maxlength="80" autocomplete="off" value="'+esc(C.team)+'"></div>'+
    '<div class="field"><label class="eyebrow" for="tmTCountry">'+esc(t("Paese"))+'</label><select id="tmTCountry">'+countries(C.country)+"</select></div>"+
    '<button type="button" class="linkbtn" id="tmDelete">'+esc(t("Elimina l'azienda"))+"</button>";
  q("tmDelete").onclick=delTeam;
  acts([[t("Indietro"),"ghost",back],[t("Salva"),"primary",saveTeam]]);}

async function saveTeam(){const name=q("tmTName").value.trim(),country=q("tmTCountry").value;
  if(!name){stat(t("Scrivi il nome dell'azienda."),"err");return;}
  stat(t("Salvo…"));
  try{await sbFetch("/rest/v1/rpc/team_update",{body:{p_team:C.team_id,p_name:name,p_country:country,p_region:country===C.country?C.region||null:null}});
    C.team=name;if(country!==C.country){C.country=country;C.region=null;}renderList();stat(t("Salvato."),"ok");}
  catch(e){stat(coErr(e),"err");}}

async function delTeam(){
  if(arm!=="team"){arm="team";q("tmDelete").textContent=t("Tocca di nuovo per eliminare l'azienda e tutta la squadra");
    setTimeout(()=>{if(arm==="team"&&q("tmDelete")){arm="";q("tmDelete").textContent=t("Elimina l'azienda");}},5000);return;}
  arm="";stat(t("Elimino l'azienda…"));
  try{await sbFetch("/rest/v1/rpc/team_delete",{body:{p_team:C.team_id}});D.close();toast(t("Azienda eliminata."));}
  catch(e){stat(coErr(e),"err");}}

/* ---------- tappa 2: turni della squadra (bozza e Pubblica) ----------
   PUB = turni pubblicati, DRA = bozza ({v}; v null = giorno da svuotare), per persona e giorno; eff() = quello che si vede.
   Ogni modifica va in coda (Q) e parte dopo mezzo secondo con team_draft_set; Pubblica manda la bozza della settimana
   con team_publish (supabase/migrations/20261125210000_turni_squadra.sql). */
const {presets,stdHours,keyOf,dateOf,addDays,monday,toMin,kshort,kind,slot,fWDd,fWDM,lawWeek}=K;
let W=null,PUB={},DRA={},SET={},ALLD=[],Q=new Map(),qT=null,brush="",dayIx=0,pArm="";
const ks7=()=>[...Array(7)].map((_,i)=>keyOf(addDays(W,i)));
const eff=(m,k)=>DRA[m]&&k in DRA[m]?DRA[m][k].v:(PUB[m]&&PUB[m][k])||null;
const isDraft=(m,k)=>!!(DRA[m]&&k in DRA[m]);
const jkey=o=>o?JSON.stringify(Object.keys(o).sort().map(k=>[k,o[k]])):"",same=(a,b)=>jkey(a)===jkey(b);  /* il server ordina le chiavi a modo suo */
const hh=m=>{m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");};
const cut=x=>x.endsWith(":00")?x.slice(0,2):x;
const dur=v=>v&&v.k==="w"?(+v.d||8)+(v.s2?(+v.d2||4):0):0;
const endMin=v=>{const a=toMin(v.s)+Math.round((+v.d||8)*60);if(!v.s2)return a;let b=toMin(v.s2);if(b<toMin(v.s))b+=1440;return Math.max(a,b+Math.round((+v.d2||4)*60));};
function txt(v){if(!v)return "";if(v.k!=="w")return kshort(v.k);let s=cut(v.s)+"–"+cut(hh(toMin(v.s)+Math.round((+v.d||8)*60)));
  if(v.s2)s+=" "+cut(v.s2)+"–"+cut(hh(toMin(v.s2)+Math.round((+v.d2||4)*60)));return s;}
const cls=v=>!v?"":v.k==="w"?"t-"+slot(v.s):v.k==="f"?"t-f":"t-x";
const lbl=v=>!v?t("vuoto"):v.k==="w"?txt(v):kind(v.k);
function brushes(){const b=presets().map((p,i)=>({id:"p"+i,label:p.n,sub:txt({k:"w",s:p.t,d:p.d||8,s2:p.t2,d2:p.d2}),dot:slot(p.t),
    v:k=>{const o={k:"w",s:p.t,d:p.d||stdHours(k)};if(p.t2){o.s2=p.t2;o.d2=p.d2||4;}return o;}}));
  ["r","f","p","m"].forEach(x=>b.push({id:x,label:kind(x),dot:x==="f"?"f":"x",v:()=>({k:x})}));
  b.push({id:"clear",label:t("Svuota"),dot:"",v:()=>null});return b;}

async function loadWeek(){const id=encodeURIComponent(C.team_id),a=keyOf(addDays(W,-1)),b=keyOf(addDays(W,6));
  const [s,d,tm,all]=await Promise.all([
    sbFetch("/rest/v1/team_shifts?team_id=eq."+id+"&day=gte."+a+"&day=lte."+b+"&select=member_id,day,v",{method:"GET"}),
    sbFetch("/rest/v1/team_draft?team_id=eq."+id+"&day=gte."+a+"&day=lte."+b+"&select=member_id,day,v",{method:"GET"}),
    sbFetch("/rest/v1/teams?id=eq."+id+"&select=settings",{method:"GET"}),
    sbFetch("/rest/v1/team_draft?team_id=eq."+id+"&select=day",{method:"GET"})]);  /* per dire se c'è bozza in altre settimane */
  PUB={};DRA={};(Array.isArray(s)?s:[]).forEach(r=>{(PUB[r.member_id]=PUB[r.member_id]||{})[r.day]=r.v;});
  (Array.isArray(d)?d:[]).forEach(r=>{(DRA[r.member_id]=DRA[r.member_id]||{})[r.day]={v:r.v};});
  SET=Array.isArray(tm)&&tm[0]&&tm[0].settings||{};ALLD=(Array.isArray(all)?all:[]).map(r=>r.day);
  Q.forEach((v,key)=>{const [m,k]=key.split("|");(DRA[m]=DRA[m]||{})[k]={v};});}
function setCell(m,k,v){(DRA[m]=DRA[m]||{})[k]={v};Q.set(m+"|"+k,v);clearTimeout(qT);qT=setTimeout(flush,500);}
/* le modifiche partono una dopo l'altra (fl), così una risposta vecchia non copre una casella appena cambiata */
let fl=Promise.resolve(true);
function flush(){clearTimeout(qT);qT=null;fl=fl.then(flush1,flush1);return fl;}
async function flush1(){if(!Q.size)return true;
  const items=[...Q].map(([key,v])=>{const [m,d]=key.split("|");return {m,d,v};});Q.clear();
  try{await sbFetch("/rest/v1/rpc/team_draft_set",{body:{p_team:C.team_id,p_items:items}});await loadWeek();if(D.open&&view==="plan")renderPlan();return true;}
  catch(e){stat(coErr(e),"err");try{await loadWeek();}catch(x){}if(D.open&&view==="plan")renderPlan();return false;}}

/* controlli: riposo minimo tra un turno e il successivo, ore della settimana (legge del paese), persone minime al giorno */
function checks(){const ks=ks7(),prev=keyOf(addDays(W,-1)),r=(K.ctrys()[C.country]||{}).rules||{},rest=r.rest||11,maxW=lawWeek(r),min=+SET.min||0;
  const warn={},msgs=[],hours={},count=ks.map(()=>0);
  P.forEach(p=>{let h=0,a=eff(p.id,prev);
    ks.forEach((k,i)=>{const v=eff(p.id,k);
      if(v&&v.k==="w"){h+=dur(v);count[i]++;
        if(a&&a.k==="w"){const gap=(1440+toMin(v.s)-endMin(a))/60;
          if(gap<rest){warn[p.id+"|"+k]=1;msgs.push(t("{name}: tra {a} e {b} riposa {h} ore, il minimo è {n}.",{name:p.name,a:fWDd(dateOf(i?ks[i-1]:prev)),b:fWDd(dateOf(k)),h:fmtN(Math.max(0,gap)),n:fmtN(rest)}));}}}
      a=v;});
    hours[p.id]=h;if(h>maxW)msgs.push(t("{name}: {h} ore in settimana, sopra le {n} di legge.",{name:p.name,h:fmtN(h),n:fmtN(maxW)}));});
  if(min)ks.forEach((k,i)=>{if(count[i]<min){warn["day|"+k]=1;msgs.push(t("{d}: in servizio {n}, il minimo è {m}.",{d:fWDd(dateOf(k)),n:count[i],m:min}));}});
  return {warn,msgs,hours,count,min};}

function weekLabel(){const b=addDays(W,6);
  try{return new Intl.DateTimeFormat(loc(),{day:"numeric",month:"short",year:"numeric"}).formatRange(W,b).replace(/\b0(\d)\b/g,"$1");}  /* in italiano ICU scrive 07–13 */
  catch(e){const f=d=>d.toLocaleDateString(loc(),{day:"numeric",month:"short"});return f(W)+" – "+f(b)+" "+b.getFullYear();}}
function renderPlan(){view="plan";D.classList.add("tmwide");
  const ks=ks7(),wide=window.innerWidth>=700,c=checks(),today=keyOf(new Date());
  const nd=P.reduce((n,p)=>n+ks.filter(k=>isDraft(p.id,k)).length,0);
  q("tmTitle").textContent=t("Turni della squadra");q("tmSub").textContent=C.team;
  let h='<div class="plnav"><button type="button" class="btn round" id="plPrev" aria-label="'+esc(t("Settimana prima"))+'">‹</button><b>'+esc(weekLabel())+
    '</b><button type="button" class="btn round" id="plNext" aria-label="'+esc(t("Settimana dopo"))+'">›</button>'+(ks.includes(today)?"":'<button type="button" class="linkbtn" id="plToday">'+esc(t("Questa settimana"))+"</button>")+"</div>";
  const other=ALLD.filter(d=>d<ks[0]||d>ks[6]).length;
  h+='<p class="bpst'+(nd?" err":"")+'">'+esc((nd?tn(nd,"Bozza: {n} modifica non ancora pubblicata.","Bozza: {n} modifiche non ancora pubblicate."):t("Tutto pubblicato: i dipendenti vedono questa settimana così."))+
    (other?" "+tn(other,"In un'altra settimana c'è {n} modifica da pubblicare.","In altre settimane ci sono {n} modifiche da pubblicare."):""))+"</p>";
  h+='<div class="plbrush" role="toolbar" aria-label="'+esc(t("Turni pronti"))+'">'+brushes().map(b=>'<button type="button" class="chip'+(b.id==="clear"?" erase":"")+'" data-b="'+b.id+'" aria-pressed="'+(brush===b.id)+'"><i class="d-'+b.dot+'"></i>'+esc(b.label)+(b.sub?" <small>"+esc(b.sub)+"</small>":"")+"</button>").join("")+"</div>";
  h+='<p class="help">'+esc(brush?t("Tocca le caselle per mettere il turno scelto; toccalo di nuovo qui sopra per smettere."):t("Scegli un turno qui sopra e tocca le caselle, oppure tocca una casella per modificarla."))+"</p>";
  h+=wide?gridHtml(ks,c,today):dayHtml(ks,c);
  if(c.msgs.length)h+='<div class="plwarn"><p class="eyebrow">'+esc(tn(c.msgs.length,"{n} avviso","{n} avvisi"))+"</p><ul>"+c.msgs.map(m=>"<li>"+esc(m)+"</li>").join("")+"</ul></div>";
  h+='<div class="corow placts"><button type="button" class="btn" id="plCopy">'+esc(pArm==="copy"?t("Tocca di nuovo per copiare"):t("Copia la settimana prima"))+"</button>"+
    (nd?'<button type="button" class="linkbtn" id="plDiscard">'+esc(pArm==="discard"?t("Tocca di nuovo per buttare la bozza"):t("Butta la bozza"))+"</button>":"")+
    (boss()?'<button type="button" class="linkbtn" id="plMin">'+esc(c.min?t("Persone minime al giorno: {n}",{n:c.min}):t("Persone minime al giorno"))+"</button>":"")+"</div>";
  q("tmBody").innerHTML=h;
  q("plPrev").onclick=()=>goWeek(-7);q("plNext").onclick=()=>goWeek(7);if(q("plToday"))q("plToday").onclick=()=>goWeek(0);
  q("tmBody").querySelectorAll("[data-b]").forEach(b=>b.onclick=()=>{brush=brush===b.dataset.b?"":b.dataset.b;renderPlan();});
  q("tmBody").querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>cellTap(P[+b.dataset.m],b.dataset.k));
  q("tmBody").querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{dayIx=+b.dataset.day;renderPlan();});
  q("plCopy").onclick=copyPrev;if(q("plDiscard"))q("plDiscard").onclick=discard;if(q("plMin"))q("plMin").onclick=renderMin;
  acts([[t("Indietro"),"ghost",async()=>{await flush();brush="";stat("");renderList();}],[nd?tn(nd,"Pubblica {n} modifica","Pubblica {n} modifiche"):t("Pubblica"),"primary",publish]]);
  const pb=q("tmActs").querySelector(".primary");if(pb)pb.disabled=!nd;}
function gridHtml(ks,c,today){
  let h='<div class="plgrid"><div class="plh"></div>'+ks.map(k=>'<div class="plh'+(k===today?" today":"")+'">'+esc(fWDd(dateOf(k)))+"</div>").join("")+'<div class="plh">'+esc(t("Ore"))+"</div>";
  P.forEach((p,pi)=>{h+='<div class="plname"><b>'+esc(p.name)+"</b>"+(p.dept?"<small>"+esc(p.dept)+"</small>":"")+"</div>";
    ks.forEach(k=>{const v=eff(p.id,k);h+='<button type="button" class="plc '+cls(v)+(isDraft(p.id,k)?" dr":"")+(c.warn[p.id+"|"+k]?" wr":"")+'" data-m="'+pi+'" data-k="'+k+'" aria-label="'+esc(p.name+", "+fWDd(dateOf(k))+": "+lbl(v))+'">'+esc(txt(v))+(v&&v.n?'<i class="nt"></i>':"")+"</button>";});
    const ov=p.week_hours!=null&&(c.hours[p.id]||0)>p.week_hours;
    h+='<div class="plhrs'+(ov?" ov":"")+'"'+(ov?' title="'+esc(t("Più ore del contratto"))+'"':"")+">"+esc(fmtN(c.hours[p.id]||0)+(p.week_hours!=null?"/"+fmtN(p.week_hours):"")+" h")+"</div>";});
  h+='<div class="plfoot lab">'+esc(t("In servizio"))+"</div>"+ks.map((k,i)=>'<div class="plfoot n'+(c.warn["day|"+k]?" wr":"")+'">'+c.count[i]+(c.min?"/"+c.min:"")+"</div>").join("")+'<div class="plfoot"></div></div>';
  return h;}
function dayHtml(ks,c){if(dayIx<0||dayIx>6)dayIx=0;const k=ks[dayIx];
  const today=keyOf(new Date()),bad=x=>!!c.warn["day|"+x]||P.some(p=>c.warn[p.id+"|"+x]);
  let h='<div class="pldays">'+ks.map((x,i)=>{const d=dateOf(x),f=fWDd(d);
    return '<button type="button" class="plwd'+(x===today?" today":"")+'" data-day="'+i+'" aria-pressed="'+(i===dayIx)+'" aria-label="'+esc(fWDM(d)+(bad(x)?", "+t("da controllare"):""))+'"><small>'+esc(f.slice(0,f.lastIndexOf(" ")))+"</small><b>"+d.getDate()+"</b>"+(bad(x)?'<i class="w"></i>':"")+"</button>";}).join("")+"</div>";
  h+='<div class="plday">'+P.map((p,pi)=>{const v=eff(p.id,k);
    return '<button type="button" class="plrow" data-m="'+pi+'" data-k="'+k+'" aria-label="'+esc(p.name+", "+fWDd(dateOf(k))+": "+lbl(v))+'"><span><b>'+esc(p.name)+"</b><small>"+esc([p.dept,fmtN(c.hours[p.id]||0)+(p.week_hours!=null?"/"+fmtN(p.week_hours):"")+" h"].filter(Boolean).join(" · "))+
      '</small></span><span class="plc '+cls(v)+(isDraft(p.id,k)?" dr":"")+(c.warn[p.id+"|"+k]?" wr":"")+'">'+esc(txt(v)||"—")+"</span></button>";}).join("")+"</div>";
  return h+'<p class="help">'+esc(t("In servizio: {n}",{n:c.count[dayIx]+(c.min?"/"+c.min:"")}))+"</p>";}
function cellTap(p,k){if(!p)return;
  if(brush){const b=brushes().find(x=>x.id===brush);if(b){setCell(p.id,k,b.v(k));renderPlan();}return;}
  stat("");renderCell(p,k);}

/* una casella: tipo di giornata, inizio e ore, nota per la persona */
function renderCell(p,k){view="cell";D.classList.remove("tmwide");const v=eff(p.id,k),p0=presets()[0];
  q("tmTitle").textContent=p.name;q("tmSub").textContent=fWDM(dateOf(k));
  const kinds=[["w",t("Turno")],["r",kind("r")],["f",kind("f")],["p",kind("p")],["m",kind("m")]],k0=v?v.k:"w";
  q("tmBody").innerHTML='<div class="seg" role="radiogroup" aria-label="'+esc(t("Tipo di giornata"))+'">'+kinds.map(([x,l])=>'<label><input type="radio" name="plk" value="'+x+'"'+(k0===x?" checked":"")+"><span>"+esc(l)+"</span></label>").join("")+"</div>"+
    '<div class="row" id="plW"><div class="field"><label class="eyebrow" for="plS">'+esc(t("Inizio"))+'</label><input type="time" id="plS" step="300" value="'+esc(v&&v.k==="w"?v.s:p0?p0.t:"08:00")+'"></div>'+
    '<div class="field"><label class="eyebrow" for="plD">'+esc(t("Ore"))+'</label><input type="number" id="plD" min="0.5" max="16" step="0.5" value="'+esc(v&&v.k==="w"?v.d:stdHours(k))+'"></div></div>'+
    '<div class="field"><label class="eyebrow" for="plN">'+esc(t("Nota per {name}",{name:p.name.split(" ")[0]}))+'</label><input type="text" id="plN" maxlength="120" autocomplete="off" value="'+esc(v&&v.n||"")+'"></div>'+
    (v?'<button type="button" class="linkbtn" id="plClear">'+esc(t("Svuota la casella"))+"</button>":"");
  if(q("plClear"))q("plClear").onclick=()=>{setCell(p.id,k,null);stat("");renderPlan();};
  const sync=()=>{q("plW").hidden=(q("tmBody").querySelector("input[name=plk]:checked")||{}).value!=="w";};
  q("tmBody").querySelectorAll("input[name=plk]").forEach(r=>r.onchange=sync);sync();
  acts([[t("Indietro"),"ghost",()=>{stat("");renderPlan();}],[t("Salva"),"primary",()=>saveCell(p,k,v)]]);}
function saveCell(p,k,old){const x=(q("tmBody").querySelector("input[name=plk]:checked")||{}).value||"",n=q("plN").value.trim();let v=null;
  if(x==="w"){const s=q("plS").value,d=num(q("plD").value);
    if(!/^\d\d:\d\d$/.test(s)||!d||d<0.5||d>16){stat(t("Controlla l'inizio e le ore del turno."),"err");return;}
    v={k:"w",s,d};if(old&&old.k==="w"&&old.s2){v.s2=old.s2;v.d2=old.d2;}}
  else if(x)v={k:x};
  if(v&&n)v.n=n;setCell(p.id,k,v);stat("");renderPlan();}

async function goWeek(n){await flush();W=n?addDays(W,n):monday(new Date());pArm="";stat(t("Carico la settimana…"));
  try{await loadWeek();stat("");}catch(e){stat(coErr(e),"err");}renderPlan();}
async function openPlan(){W=monday(new Date());dayIx=Math.max(0,ks7().indexOf(keyOf(new Date())));brush="";pArm="";stat(t("Carico la settimana…"));
  try{await loadWeek();stat("");}catch(e){stat(coErr(e),"err");}renderPlan();}
async function publish(){if(!(await flush()))return;const ks=ks7();stat(t("Pubblico…"));
  try{const n=+(await sbFetch("/rest/v1/rpc/team_publish",{body:{p_team:C.team_id,p_from:ks[0],p_to:ks[6]}}))||0;await loadWeek();renderPlan();
    stat(n?tn(n,"Pubblicato {n} giorno: chi ha l'app lo trova nel suo calendario.","Pubblicati {n} giorni: chi ha l'app li trova nel suo calendario."):t("Niente da pubblicare."),"ok");}
  catch(e){stat(coErr(e),"err");}}
async function discard(){
  if(pArm!=="discard"){pArm="discard";renderPlan();setTimeout(()=>{if(pArm==="discard"){pArm="";if(view==="plan")renderPlan();}},5000);return;}
  pArm="";Q.clear();clearTimeout(qT);const ks=ks7();stat(t("Butto la bozza…"));
  try{await sbFetch("/rest/v1/rpc/team_draft_discard",{body:{p_team:C.team_id,p_from:ks[0],p_to:ks[6]}});await loadWeek();renderPlan();stat(t("Bozza buttata: resta quello che era pubblicato."),"ok");}
  catch(e){stat(coErr(e),"err");}}
async function copyPrev(){
  if(pArm!=="copy"){pArm="copy";renderPlan();setTimeout(()=>{if(pArm==="copy"){pArm="";if(view==="plan")renderPlan();}},5000);return;}
  pArm="";await flush();const ks=ks7(),id=encodeURIComponent(C.team_id),a=keyOf(addDays(W,-7)),b=keyOf(addDays(W,-1));stat(t("Copio la settimana prima…"));
  try{const [s,d]=await Promise.all([sbFetch("/rest/v1/team_shifts?team_id=eq."+id+"&day=gte."+a+"&day=lte."+b+"&select=member_id,day,v",{method:"GET"}),
      sbFetch("/rest/v1/team_draft?team_id=eq."+id+"&day=gte."+a+"&day=lte."+b+"&select=member_id,day,v",{method:"GET"})]);
    const prev={};(Array.isArray(s)?s:[]).forEach(r=>{prev[r.member_id+"|"+r.day]=r.v;});(Array.isArray(d)?d:[]).forEach(r=>{prev[r.member_id+"|"+r.day]=r.v;});
    let n=0;P.forEach(p=>ks.forEach((k,i)=>{const v=prev[p.id+"|"+keyOf(addDays(W,i-7))]||null;if(!same(v,eff(p.id,k))){setCell(p.id,k,v);n++;}}));
    await flush();renderPlan();stat(n?tn(n,"Copiato {n} giorno dalla settimana prima: è in bozza.","Copiati {n} giorni dalla settimana prima: sono in bozza."):t("La settimana prima è uguale a questa."),"ok");}
  catch(e){stat(coErr(e),"err");}}
function renderMin(){view="min";D.classList.remove("tmwide");q("tmTitle").textContent=t("Persone minime al giorno");q("tmSub").textContent=t("Se in un giorno lavorano meno persone, la tabella lo segnala.");
  q("tmBody").innerHTML='<div class="field"><label class="eyebrow" for="plMinN">'+esc(t("Persone"))+'</label><input type="number" id="plMinN" min="0" max="50" step="1" inputmode="numeric" value="'+esc(+SET.min||0)+'"></div><p class="help">'+esc(t("0 vuol dire nessun minimo."))+"</p>";
  acts([[t("Indietro"),"ghost",()=>{stat("");renderPlan();}],[t("Salva"),"primary",saveMin]]);}
async function saveMin(){const n=num(q("plMinN").value)||0;if(n<0||n>50||n!==Math.round(n)){stat(t("Scrivi un numero intero da 0 a 50."),"err");return;}
  try{await sbFetch("/rest/v1/rpc/team_settings_set",{body:{p_team:C.team_id,p_settings:{min:n}}});SET.min=n;stat("");renderPlan();}catch(e){stat(coErr(e),"err");}}
let rzT=null;window.addEventListener("resize",()=>{clearTimeout(rzT);rzT=setTimeout(()=>{if(D.open&&view==="plan")renderPlan();},200);});

function back(){stat("");renderList();}

async function open(c,fresh){C=Object.assign({},c);P=[];INV={};stat("");
  q("tmTitle").textContent=C.team;q("tmSub").textContent="";q("tmBody").innerHTML='<p class="help">'+esc(t("Carico la squadra…"))+"</p>";
  acts([[t("Chiudi"),"primary",close]]);openDlg(D);
  try{await load();renderList();if(fresh&&P.length<=1)renderPerson(null);}
  catch(e){stat(coErr(e),"err");}}

return {open};
};
