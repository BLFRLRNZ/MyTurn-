-- MyTurn Business, tappa 2: prova delle funzioni team_draft_set, team_publish (con l'avviso), team_draft_discard,
-- team_settings_set e team_notice su un Postgres locale. Uso: tests/sql/run.sh tests/sql/turni-squadra.sql
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists tt; grant usage on schema tt to anon, authenticated;
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','anna@bar.test'),('00000000-0000-0000-0000-0000000000b1','luca@bar.test'),('00000000-0000-0000-0000-0000000000c1','marco@bar.test')
  on conflict do nothing;
create or replace function tt.ok(c boolean, m text) returns void language plpgsql as $$ begin raise notice '%', (case when c then 'ok   ' else 'FAIL ' end) || m; end $$;
-- come utente: claims + ruolo authenticated, per il resto del blocco
create or replace function tt.as_user(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; end $$;
select set_config('t.a','00000000-0000-0000-0000-0000000000a1',false), set_config('t.b','00000000-0000-0000-0000-0000000000b1',false), set_config('t.c','00000000-0000-0000-0000-0000000000c1',false);
select set_config('t.d1',(current_date+7)::text,false), set_config('t.d2',(current_date+8)::text,false), set_config('t.d3',(current_date+9)::text,false);


-- 1. squadra: Anna titolare, Luca dipendente, Marco responsabile, Sara senza app
do $$ declare tid uuid; l uuid; m uuid; s uuid; c text; begin
  perform tt.as_user(current_setting('t.a'));
  tid := team_create('Bar Centrale','IT',null,'Anna Rossi');
  l := team_member_save(tid,null,'Luca Bianchi','dipendente','Sala',40,null,null);
  m := team_member_save(tid,null,'Marco Neri','responsabile','Cucina',40,null,null);
  s := team_member_save(tid,null,'Sara Verdi','dipendente','Sala',24,null,null);
  perform set_config('t.tid',tid::text,false);perform set_config('t.l',l::text,false);perform set_config('t.m',m::text,false);perform set_config('t.s',s::text,false);
  perform set_config('t.cl',team_invite(tid,l),false);perform set_config('t.cm',team_invite(tid,m),false);
end $$;
do $$ begin perform tt.as_user(current_setting('t.b')); perform team_join(current_setting('t.cl')); end $$;
do $$ begin perform tt.as_user(current_setting('t.c')); perform team_join(current_setting('t.cm')); end $$;
insert into push_subs(user_id,endpoint,p256dh,auth) values (current_setting('t.b')::uuid,'https://push.test/luca','k','a');

-- 2. bozza: pulizia dei valori, errori, chi può scrivere
do $$ declare tid uuid := current_setting('t.tid'); n int; e text; v jsonb; begin
  perform tt.as_user(current_setting('t.a'));
  n := team_draft_set(tid, jsonb_build_array(
    jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d1'),'v',jsonb_build_object('k','w','s','06:00','d',8,'x','?')),
    jsonb_build_object('m',current_setting('t.s'),'d',current_setting('t.d1'),'v',jsonb_build_object('k','w','s','14:00','n','  Chiavi  ')),
    jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d2'),'v',jsonb_build_object('k','r','n','  '))));
  perform tt.ok(n=3 and (select count(*) from team_draft)=3,'bozza: 3 righe');
  select d.v into v from team_draft d where member_id=current_setting('t.s')::uuid;
  perform tt.ok(v = '{"k":"w","s":"14:00","d":8,"n":"Chiavi"}'::jsonb,'turno ripulito: '||v::text);
  select d.v into v from team_draft d where member_id=current_setting('t.l')::uuid and day=current_setting('t.d2')::date;
  perform tt.ok(v = '{"k":"r"}'::jsonb,'riposo senza nota vuota: '||v::text);
  begin perform team_draft_set(tid,jsonb_build_array(jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d1'),'v',jsonb_build_object('k','x'))));e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='bad shift','tipo sbagliato: '||e);
  begin perform team_draft_set(tid,jsonb_build_array(jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d1'),'v',jsonb_build_object('k','w','s','25:00'))));e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='bad shift','ora sbagliata: '||e);
  begin perform team_draft_set(tid,jsonb_build_array(jsonb_build_object('m',current_setting('t.l'),'d',(current_date-70)::text,'v',jsonb_build_object('k','r'))));e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='bad range','troppo indietro: '||e);
  begin perform team_draft_set(tid,jsonb_build_array(jsonb_build_object('m',gen_random_uuid(),'d',current_setting('t.d1'),'v',jsonb_build_object('k','r'))));e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='not found','persona di un''altra squadra: '||e);
end $$;
do $$ declare e text; n int; begin perform tt.as_user(current_setting('t.b'));
  begin perform team_draft_set(current_setting('t.tid')::uuid,'[]'::jsonb);e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='forbidden','il dipendente non scrive la bozza: '||e);
  select count(*) into n from team_draft;perform tt.ok(n=0,'il dipendente non vede la bozza ('||n||')');
  begin perform team_publish(current_setting('t.tid')::uuid,current_date,current_date+10);e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='forbidden','il dipendente non pubblica: '||e);
end $$;
do $$ declare n int; begin perform tt.as_user(current_setting('t.c'));
  n := team_draft_set(current_setting('t.tid')::uuid, jsonb_build_array(jsonb_build_object('m',current_setting('t.s'),'d',current_setting('t.d3'),'v',jsonb_build_object('k','w','s','22:00','d',8))));
  select count(*) into n from team_draft;perform tt.ok(n=4,'il responsabile scrive e vede la bozza ('||n||')');
end $$;

-- 3. Pubblica: turni, bozza vuota, avviso solo a chi ha le notifiche (non a chi pubblica)
do $$ declare n int; begin perform tt.as_user(current_setting('t.a'));
  n := team_publish(current_setting('t.tid')::uuid, current_setting('t.d1')::date, current_setting('t.d3')::date);
  perform tt.ok(n=4,'pubblicati 4 giorni ('||n||')');
  perform tt.ok((select count(*) from team_shifts)=4 and (select count(*) from team_draft)=0 and (select bool_and(version=1) from team_shifts),'4 turni versione 1, bozza vuota');
end $$;
select tt.ok(count(*)=1 and min(title)='Bar Centrale' and min(body) like 'Ci sono turni nuovi o cambiati%' and min(kind)='co','un avviso per Luca: '||coalesce(string_agg(title||' / '||body,', '),'nessuno'))
  from shifts where user_id=current_setting('t.b')::uuid;
select tt.ok(count(*)=0,'nessun avviso ad Anna e Marco') from shifts where user_id<>current_setting('t.b')::uuid;
select tt.ok(count(*)=1,'il promemoria parte con il cron (due_reminders)') from due_reminders() where kind='co';

-- 4. il dipendente vede solo i suoi turni
do $$ declare n int; m int; begin perform tt.as_user(current_setting('t.b'));
  select count(*), count(*) filter (where member_id=current_setting('t.l')::uuid) into n, m from team_shifts;
  perform tt.ok(n=2 and m=2,'Luca vede i suoi 2 turni e basta ('||n||')');
end $$;

-- 5. modifica dopo la pubblicazione: uguale = niente bozza; cambiato = versione 2; tolto = cancellato
do $$ declare tid uuid := current_setting('t.tid'); n int; begin perform tt.as_user(current_setting('t.a'));
  perform team_draft_set(tid, jsonb_build_array(jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d1'),'v',jsonb_build_object('d',8,'s','06:00','k','w'))));
  perform tt.ok((select count(*) from team_draft)=0,'uguale al pubblicato: nessuna bozza');
  perform team_draft_set(tid, jsonb_build_array(jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d1'),'v',jsonb_build_object('k','w','s','14:00','d',8)),
    jsonb_build_object('m',current_setting('t.l'),'d',current_setting('t.d2'),'v',null)));
  n := team_publish(tid, current_setting('t.d1')::date, current_setting('t.d3')::date);
  perform tt.ok(n=2,'pubblicate 2 modifiche ('||n||')');
  perform tt.ok((select version from team_shifts where member_id=current_setting('t.l')::uuid and day=current_setting('t.d1')::date)=2
    and not exists(select 1 from team_shifts where member_id=current_setting('t.l')::uuid and day=current_setting('t.d2')::date),'lunedì versione 2, martedì tolto');
  perform team_draft_set(tid, jsonb_build_array(jsonb_build_object('m',current_setting('t.s'),'d',current_setting('t.d2'),'v',jsonb_build_object('k','f'))));
  perform team_draft_discard(tid, current_setting('t.d1')::date, current_setting('t.d3')::date);
  perform tt.ok((select count(*) from team_draft)=0,'bozza buttata');
  perform team_settings_set(tid,'{"min":99,"x":1}'::jsonb);
  perform tt.ok((select settings from teams where id=tid)='{"min":50}'::jsonb,'persone minime: al massimo 50, niente altro');
end $$;
select tt.ok(count(*)=1,'stesso minuto: sempre un solo avviso per Luca ('||count(*)||')') from shifts where user_id=current_setting('t.b')::uuid and kind='co';
do $$ declare e text; begin perform tt.as_user(current_setting('t.c'));
  begin perform team_settings_set(current_setting('t.tid')::uuid,'{"min":1}'::jsonb);e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e='forbidden','il responsabile non cambia il minimo: '||e);
  begin perform team_notice('it');e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e like 'permission denied%','team_notice solo per il server: '||e);
  begin perform team_shift_clean('{"k":"r"}');e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e like 'permission denied%','team_shift_clean solo per il server: '||e);
end $$;

-- 6. la lingua dell'avviso (profiles.lang, scritta dall'app con un upsert)
do $$ begin perform tt.as_user(current_setting('t.b'));
  insert into profiles(user_id,lang) values (current_setting('t.b')::uuid,'pt-BR') on conflict (user_id) do update set lang=excluded.lang;
end $$;
select tt.ok(team_notice(lang) like 'Você tem%','Luca in brasiliano: '||team_notice(lang)) from profiles where user_id=current_setting('t.b')::uuid;
select tt.ok(team_notice('de') like 'Es gibt%' and team_notice('fr') like 'Vous avez%' and team_notice('pl') like 'You have%' and team_notice(null) like 'Ci sono%','tedesco, francese, altre lingue in inglese, senza lingua in italiano');
do $$ declare e text; begin
  begin insert into shifts(user_id,start_at,kind,remind_at) values (current_setting('t.b')::uuid,now()+interval '1 day','xx',now());e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e like '%shifts_kind_check%','la tabella dei promemoria rifiuta tipi sconosciuti');
end $$;
select tt.ok(count(*)=1,'un solo controllo sul tipo in shifts') from pg_constraint where conrelid='public.shifts'::regclass and contype='c';
-- 7. chi non ha l'account non chiama niente
do $$ declare e text; begin execute 'set local role anon';
  begin perform team_publish(current_setting('t.tid')::uuid,current_date,current_date);e:='nessun errore';exception when others then e:=sqlerrm;end;
  perform tt.ok(e like 'permission denied%','anon: '||e);
end $$;
