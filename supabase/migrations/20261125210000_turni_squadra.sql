-- MyTurn Business, tappa 2: turni della squadra.
-- team_draft = la bozza del titolare o del responsabile (la vede solo chi gestisce);
-- team_shifts = i turni pubblicati (ognuno vede i propri, chi gestisce tutti). Un turno per persona e giorno.
-- Il valore v è lo stesso di un giorno di MyTurn, ridotto: {k:'w'|'r'|'f'|'p'|'m', s, d, s2?, d2?, h?, n?}.
-- Le scritture passano dalle funzioni qui sotto, che controllano il ruolo.
-- Quando si pubblica, chi ha l'app e le notifiche attive riceve un avviso: una riga 'co' nella tabella dei promemoria
-- (shifts), che parte con il cron dei promemoria (send-reminders), nella lingua dell'app (profiles.lang).

create table if not exists public.team_shifts(
  team_id uuid not null references public.teams on delete cascade,
  member_id uuid not null references public.team_members on delete cascade,
  day date not null,
  v jsonb not null check (jsonb_typeof(v) = 'object' and pg_column_size(v) < 2000),
  version int not null default 1,
  pub_at timestamptz not null default now(),
  primary key (member_id, day)
);
create index if not exists team_shifts_team_day on public.team_shifts(team_id, day);

create table if not exists public.team_draft(
  team_id uuid not null references public.teams on delete cascade,
  member_id uuid not null references public.team_members on delete cascade,
  day date not null,
  v jsonb check (v is null or (jsonb_typeof(v) = 'object' and pg_column_size(v) < 2000)),  -- null = giorno da svuotare
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  primary key (member_id, day)
);
create index if not exists team_draft_team_day on public.team_draft(team_id, day);

-- la persona member è chi chiama?
create or replace function public.team_is_me(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from team_members where id = p_member and user_id = auth.uid() and status = 'attivo')
$$;

alter table public.team_shifts enable row level security;
alter table public.team_draft enable row level security;
create policy "turni: i miei, tutti se gestisco" on public.team_shifts for select to authenticated
  using (public.team_is_me(member_id) or public.team_role(team_id) in ('titolare','responsabile'));
create policy "bozza: chi gestisce" on public.team_draft for select to authenticated
  using (public.team_role(team_id) in ('titolare','responsabile'));
revoke all on public.team_shifts, public.team_draft from anon;
revoke insert, update, delete, truncate on public.team_shifts, public.team_draft from authenticated;
grant select on public.team_shifts, public.team_draft to authenticated;

-- controlla e ripulisce un turno; errore se non è valido
create or replace function public.team_shift_clean(v jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text := v->>'k'; o jsonb; hm text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if k is null or k not in ('w','r','f','p','m') then raise exception 'bad shift'; end if;
  o := jsonb_build_object('k', k);
  if k = 'w' then
    if coalesce(v->>'s', '') !~ hm then raise exception 'bad shift'; end if;
    o := o || jsonb_build_object('s', v->>'s', 'd', least(16, greatest(0.5, coalesce((v->>'d')::numeric, 8))));
    if coalesce(v->>'s2', '') ~ hm then
      o := o || jsonb_build_object('s2', v->>'s2', 'd2', least(16, greatest(0.5, coalesce((v->>'d2')::numeric, 4))));
    end if;
  elsif k = 'p' and coalesce(v->>'h', '') <> '' then
    o := o || jsonb_build_object('h', least(16, greatest(0.5, (v->>'h')::numeric)));
  end if;
  if coalesce(btrim(v->>'n'), '') <> '' then o := o || jsonb_build_object('n', left(btrim(v->>'n'), 120)); end if;
  return o;
end $$;

-- scrive nella bozza: items = [{"m": persona, "d": "2026-11-30", "v": {...} oppure null per svuotare}], al massimo 500.
-- Una bozza uguale al turno pubblicato non serve: si toglie, così il numero di modifiche da pubblicare è giusto.
create or replace function public.team_draft_set(p_team uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare me text := public.team_role(p_team); x jsonb; v jsonb; mid uuid; d date; n int := 0;
begin
  if me is null or me = 'dipendente' then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'bad items'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    mid := (x->>'m')::uuid; d := (x->>'d')::date;
    if not exists (select 1 from team_members where id = mid and team_id = p_team and status = 'attivo') then raise exception 'not found'; end if;
    if d < current_date - 62 or d > current_date + 400 then raise exception 'bad range'; end if;
    v := case when x->'v' is null or jsonb_typeof(x->'v') = 'null' then null else public.team_shift_clean(x->'v') end;
    if v is not distinct from (select s.v from team_shifts s where s.member_id = mid and s.day = d) then
      delete from team_draft where member_id = mid and day = d;
    else
      insert into team_draft(team_id, member_id, day, v, updated_by) values (p_team, mid, d, v, auth.uid())
        on conflict (member_id, day) do update set v = excluded.v, updated_by = excluded.updated_by, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- testo dell'avviso, nella lingua dell'app; le altre lingue in inglese finché MyTurn Business non esce (3.0)
create or replace function public.team_notice(p_lang text) returns text
language sql immutable set search_path = public as $$
  select case split_part(lower(coalesce(p_lang, 'it')), '-', 1)
    when 'it' then 'Ci sono turni nuovi o cambiati per te. Apri MyTurn per vederli.'
    when 'fr' then 'Vous avez des postes nouveaux ou modifiés. Ouvrez MyTurn pour les voir.'
    when 'de' then 'Es gibt neue oder geänderte Schichten für dich. Öffne MyTurn, um sie zu sehen.'
    when 'es' then 'Tienes turnos nuevos o cambiados. Abre MyTurn para verlos.'
    when 'pt' then case when lower(p_lang) = 'pt-br' then 'Você tem turnos novos ou alterados. Abra o MyTurn para vê-los.'
                        else 'Tem turnos novos ou alterados. Abra o MyTurn para os ver.' end
    else 'You have new or changed shifts. Open MyTurn to see them.' end
$$;

-- la tabella dei promemoria accetta anche gli avvisi dell'azienda (kind 'co')
do $$ declare c text; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.shifts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.shifts drop constraint %I', c);
  end loop;
end $$;
alter table public.shifts add constraint shifts_kind_check check (kind in ('w','j2','oc','co'));

-- pubblica la bozza di un periodo (al massimo 62 giorni): i dipendenti la ricevono. Restituisce i giorni cambiati.
create or replace function public.team_publish(p_team uuid, p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare me text := public.team_role(p_team); r record; n int := 0; k int; who uuid[] := '{}';
begin
  if me is null or me = 'dipendente' then raise exception 'forbidden'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'bad range'; end if;
  for r in select * from team_draft where team_id = p_team and day between p_from and p_to loop
    if r.v is null then
      delete from team_shifts where member_id = r.member_id and day = r.day;
    else
      insert into team_shifts(team_id, member_id, day, v) values (p_team, r.member_id, r.day, r.v)
        on conflict (member_id, day) do update set v = excluded.v, version = team_shifts.version + 1, pub_at = now()
        where team_shifts.v is distinct from excluded.v;
    end if;
    get diagnostics k = row_count;
    if k > 0 then
      n := n + 1;
      if not (r.member_id = any(who)) then who := who || r.member_id; end if;
    end if;
  end loop;
  delete from team_draft where team_id = p_team and day between p_from and p_to;
  -- un avviso per persona (non a chi pubblica), solo a chi ha le notifiche attive; più pubblicazioni nello stesso minuto = un avviso
  insert into shifts(user_id, start_at, kind, remind_at, title, body)
    select m.user_id, date_trunc('minute', now()), 'co', now(), left(t.name, 120), public.team_notice(p.lang)
    from team_members m join teams t on t.id = m.team_id left join profiles p on p.user_id = m.user_id
    where m.id = any(who) and m.status = 'attivo' and m.user_id is not null and m.user_id is distinct from auth.uid()
      and exists (select 1 from push_subs s where s.user_id = m.user_id)
  on conflict (user_id, start_at, kind) do nothing;
  return n;
end $$;

-- butta la bozza di un periodo
create or replace function public.team_draft_discard(p_team uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.team_role(p_team) is null or public.team_role(p_team) = 'dipendente' then raise exception 'forbidden'; end if;
  delete from team_draft where team_id = p_team and day between p_from and p_to;
end $$;

-- impostazioni dell'azienda (per ora: persone minime al giorno), solo il titolare
create or replace function public.team_settings_set(p_team uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := '{}'::jsonb;
begin
  if public.team_role(p_team) is distinct from 'titolare' then raise exception 'forbidden'; end if;
  if p_settings ? 'min' then s := s || jsonb_build_object('min', least(50, greatest(0, coalesce((p_settings->>'min')::int, 0)))); end if;
  update teams set settings = settings || s where id = p_team;
end $$;

revoke all on function public.team_is_me(uuid), public.team_shift_clean(jsonb), public.team_notice(text), public.team_draft_set(uuid, jsonb),
  public.team_publish(uuid, date, date), public.team_draft_discard(uuid, date, date), public.team_settings_set(uuid, jsonb) from public, anon;
revoke all on function public.team_shift_clean(jsonb), public.team_notice(text) from authenticated;
grant execute on function public.team_is_me(uuid), public.team_draft_set(uuid, jsonb), public.team_publish(uuid, date, date),
  public.team_draft_discard(uuid, date, date), public.team_settings_set(uuid, jsonb) to authenticated;
