/* MyTurn Business – sezione Squadra (tappa 1 del progetto "MyTurn Business – Progetto").
   La carica index.html solo per chi gestisce un'azienda (coTeamLoad) e le passa le sue funzioni: t, tn, esc, sbFetch,
   openDlg, unlockPage, toast, ctryName, coLoad, coErr, coFmt, coRoleName, SITE, NATIVE, CAP, loc() e ctrys().
   Tappa 1: persone con ruolo, reparto, ore di contratto, ferie e permessi; inviti con codice e link; dati dell'azienda.
   Tutte le scritture passano dalle funzioni del server team_* (supabase/migrations/20261125180000_aziende.sql),
   che controllano di nuovo il ruolo: qui si nasconde solo quello che il server rifiuterebbe.
   Il codice di index.html sta dentro una funzione: le sue funzioni arrivano qui nell'oggetto K (vedi coTeamLoad). */
window.MyTurnTeamInit=function(K){
"use strict";
const {t,tn,esc,sbFetch,openDlg,unlockPage,toast,ctryName,coLoad,coErr,coFmt,coRoleName,SITE,NATIVE,CAP}=K;
const loc=()=>K.loc();
const ROLES=["titolare","responsabile","dipendente"];
let C=null,P=[],INV={},cur=null,arm="",lastCode=null;

const D=document.createElement("dialog");D.id="tm";D.setAttribute("aria-labelledby","tmTitle");
D.innerHTML='<form class="sheet" method="dialog"><h2 id="tmTitle" style="text-transform:none"></h2><p class="sub" id="tmSub"></p><div id="tmBody"></div><p class="bpst" id="tmStatus" aria-live="polite" hidden></p><div class="actions" id="tmActs"></div></form>';
document.body.appendChild(D);
D.addEventListener("click",ev=>{if(ev.target===D)D.close();});
D.addEventListener("close",()=>{unlockPage();coLoad();});
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

function renderList(){cur=null;arm="";
  const withApp=P.filter(p=>p.user_id).length;
  q("tmTitle").textContent=C.team;
  q("tmSub").textContent=tn(P.length,"{n} persona, {k} con l'app","{n} persone, {k} con l'app",{k:withApp.toLocaleString(loc())});
  let h='<button type="button" class="btn primary" id="tmAdd">'+esc(t("Aggiungi una persona"))+"</button>";
  h+=P.map((p,k)=>{const [cls,txt]=state(p),meta=[p.dept,p.week_hours!=null?t("{h} h a settimana",{h:fmtN(p.week_hours)}):""].filter(Boolean).join(" · ");
    return '<button type="button" class="tmrow" data-p="'+k+'"><b>'+esc(p.name)+(p.id===C.member_id?" · "+esc(t("tu")):"")+'</b><span class="cotag">'+esc(coRoleName(p.role))+"</span>"+
      (meta?"<small>"+esc(meta)+"</small>":"")+'<small><i class="'+cls+'"></i>'+esc(txt)+"</small></button>";}).join("");
  if(boss())h+='<h3 class="sect">'+esc(t("Azienda"))+'</h3><button type="button" class="btn" id="tmTeam">'+esc(t("Nome e paese dell'azienda"))+"</button>";
  q("tmBody").innerHTML=h;
  q("tmAdd").onclick=()=>{stat("");renderPerson(null);};
  q("tmBody").querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{stat("");renderPerson(P[+b.dataset.p]);});
  if(boss())q("tmTeam").onclick=()=>{stat("");renderTeam();};
  acts([[t("Chiudi"),"primary",close]]);}

function renderPerson(p){cur=p;arm="";lastCode=null;
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

function renderTeam(){arm="";
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

function back(){stat("");renderList();}

async function open(c,fresh){C=Object.assign({},c);P=[];INV={};stat("");
  q("tmTitle").textContent=C.team;q("tmSub").textContent="";q("tmBody").innerHTML='<p class="help">'+esc(t("Carico la squadra…"))+"</p>";
  acts([[t("Chiudi"),"primary",close]]);openDlg(D);
  try{await load();renderList();if(fresh&&P.length<=1)renderPerson(null);}
  catch(e){stat(coErr(e),"err");}}

return {open};
};
