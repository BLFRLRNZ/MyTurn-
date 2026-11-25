-- MyTurn Business, tappa 1: aziende, persone e inviti.
-- Decisione 2 del progetto: i dati dell'azienda NON sono cifrati end-to-end. Li leggono solo le persone
-- dell'azienda, secondo il ruolo; i dati personali di MyTurn (sincronizzazione) restano cifrati come prima.
-- Le tabelle si leggono con le regole di accesso (RLS); tutte le scritture passano dalle funzioni qui sotto,
-- che controllano il ruolo di chi chiama.

-- ---------- tabelle ----------
create table if not exists public.teams(
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  country text not null default 'IT' check (country ~ '^[A-Z]{2}$'),
  region text check (region is null or char_length(region) <= 16),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- una riga per persona: chi non ha ancora l'app ha user_id vuoto (il titolare la aggiunge con il nome)
create table if not exists public.team_members(
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  email text check (email is null or char_length(email) <= 254),
  role text not null default 'dipendente' check (role in ('titolare','responsabile','dipendente')),
  dept text check (dept is null or char_length(dept) <= 40),
  week_hours numeric(4,1) check (week_hours is null or week_hours between 0 and 80),
  leave_days numeric(4,1) check (leave_days is null or leave_days between 0 and 100),
  leave_hours numeric(5,1) check (leave_hours is null or leave_hours between 0 and 1000),
  status text not null default 'attivo' check (status in ('attivo','uscito')),
  joined_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists team_members_one_per_user on public.team_members(team_id, user_id) where user_id is not null;
create index if not exists team_members_user on public.team_members(user_id);
create index if not exists team_members_team on public.team_members(team_id);

-- inviti personali: un codice di 8 caratteri per una persona, valido 14 giorni, usabile una volta
create table if not exists public.team_invites(
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  team_id uuid not null references public.teams on delete cascade,
  member_id uuid not null references public.team_members on delete cascade,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references auth.users on delete set null
);
create index if not exists team_invites_member on public.team_invites(member_id);
create index if not exists team_invites_team on public.team_invites(team_id);

-- ---------- regole di accesso ----------
-- ruolo di chi chiama in quell'azienda (null se non ne fa parte); security definer: legge team_members senza RLS
create or replace function public.team_role(p_team uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from team_members
  where team_id = p_team and user_id = auth.uid() and status = 'attivo' limit 1
$$;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

-- l'azienda la vede chi ne fa parte; le persone: ognuno la propria riga, tutte chi gestisce; gli inviti: chi gestisce
create policy "aziende di cui faccio parte" on public.teams for select to authenticated
  using (public.team_role(id) is not null);
create policy "persone: la mia riga, tutte se gestisco" on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or public.team_role(team_id) in ('titolare','responsabile'));
create policy "inviti: chi gestisce" on public.team_invites for select to authenticated
  using (public.team_role(team_id) in ('titolare','responsabile'));

revoke all on public.teams, public.team_members, public.team_invites from anon;
revoke insert, update, delete, truncate on public.teams, public.team_members, public.team_invites from authenticated;
grant select on public.teams, public.team_members, public.team_invites to authenticated;

-- ---------- funzioni ----------
-- codice d'invito: 8 caratteri senza quelli che si confondono (0 e O, 1 e I)
create or replace function public.team_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := uuid_send(gen_random_uuid()); c text := ''; i int;
begin
  foreach i in array array[0,1,2,3,4,5,10,11] loop   -- byte del uuid tutti casuali (non versione né variante)
    c := c || substr(a, 1 + get_byte(b, i) % 32, 1);
  end loop;
  return c;
end $$;

-- crea l'azienda; chi la crea ne è il titolare (al massimo 3 aziende come titolare)
create or replace function public.team_create(p_name text, p_country text, p_region text default null, p_my_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); em text; tid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from team_members where user_id = uid and role = 'titolare' and status = 'attivo') >= 3 then
    raise exception 'too many teams';
  end if;
  select email into em from auth.users where id = uid;
  insert into teams(name, country, region, created_by)
    values (btrim(p_name), upper(coalesce(p_country, 'IT')), nullif(btrim(coalesce(p_region, '')), ''), uid)
    returning id into tid;
  insert into team_members(team_id, user_id, name, email, role, joined_at)
    values (tid, uid, coalesce(nullif(btrim(coalesce(p_my_name, '')), ''), split_part(coalesce(em, '?'), '@', 1)), em, 'titolare', now());
  return tid;
end $$;

-- nome, paese e regione (per le festività): solo il titolare
create or replace function public.team_update(p_team uuid, p_name text, p_country text, p_region text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.team_role(p_team) is distinct from 'titolare' then raise exception 'forbidden'; end if;
  update teams set name = btrim(p_name), country = upper(p_country), region = nullif(btrim(coalesce(p_region, '')), '')
    where id = p_team;
end $$;

-- aggiunge (p_id vuoto) o modifica una persona. Il responsabile gestisce solo i dipendenti;
-- l'ultimo titolare con l'app non può smettere di esserlo
create or replace function public.team_member_save(p_team uuid, p_id uuid, p_name text, p_role text default 'dipendente',
  p_dept text default null, p_week_hours numeric default null, p_leave_days numeric default null, p_leave_hours numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me text := public.team_role(p_team); cur team_members%rowtype; mid uuid;
begin
  if me is null or me = 'dipendente' then raise exception 'forbidden'; end if;
  if p_role is null or p_role not in ('titolare','responsabile','dipendente') then raise exception 'bad role'; end if;
  if me = 'responsabile' and p_role <> 'dipendente' then raise exception 'forbidden'; end if;
  if p_id is null then
    if (select count(*) from team_members where team_id = p_team and status = 'attivo') >= 200 then raise exception 'team full'; end if;
    insert into team_members(team_id, name, role, dept, week_hours, leave_days, leave_hours)
      values (p_team, btrim(p_name), p_role, nullif(btrim(coalesce(p_dept, '')), ''), p_week_hours, p_leave_days, p_leave_hours)
      returning id into mid;
    return mid;
  end if;
  select * into cur from team_members where id = p_id and team_id = p_team and status = 'attivo';
  if not found then raise exception 'not found'; end if;
  if me = 'responsabile' and cur.role <> 'dipendente' then raise exception 'forbidden'; end if;
  if cur.role = 'titolare' and p_role <> 'titolare' and not exists (
       select 1 from team_members where team_id = p_team and role = 'titolare' and status = 'attivo'
         and user_id is not null and id <> p_id) then
    raise exception 'last owner';
  end if;
  update team_members set name = btrim(p_name), role = p_role, dept = nullif(btrim(coalesce(p_dept, '')), ''),
    week_hours = p_week_hours, leave_days = p_leave_days, leave_hours = p_leave_hours
    where id = p_id;
  return p_id;
end $$;

-- toglie una persona dalla squadra: la riga resta (servirà allo storico dei turni) ma non è più collegata a nessuno
create or replace function public.team_member_remove(p_team uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me text := public.team_role(p_team); cur team_members%rowtype;
begin
  if me is null or me = 'dipendente' then raise exception 'forbidden'; end if;
  select * into cur from team_members where id = p_id and team_id = p_team and status = 'attivo';
  if not found then raise exception 'not found'; end if;
  if me = 'responsabile' and cur.role <> 'dipendente' then raise exception 'forbidden'; end if;
  if cur.role = 'titolare' and not exists (
       select 1 from team_members where team_id = p_team and role = 'titolare' and status = 'attivo'
         and user_id is not null and id <> p_id) then
    raise exception 'last owner';
  end if;
  delete from team_invites where member_id = p_id and used_at is null;
  update team_members set status = 'uscito', user_id = null, email = null where id = p_id;
end $$;

-- nuovo codice d'invito per una persona che non ha ancora l'app (quello vecchio non vale più)
create or replace function public.team_invite(p_team uuid, p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me text := public.team_role(p_team); cur team_members%rowtype; c text; n int := 0;
begin
  if me is null or me = 'dipendente' then raise exception 'forbidden'; end if;
  select * into cur from team_members where id = p_member and team_id = p_team and status = 'attivo';
  if not found then raise exception 'not found'; end if;
  if cur.user_id is not null then raise exception 'already joined'; end if;
  if me = 'responsabile' and cur.role <> 'dipendente' then raise exception 'forbidden'; end if;
  delete from team_invites where member_id = p_member and used_at is null;
  loop
    c := public.team_new_code(); n := n + 1;
    begin
      insert into team_invites(code, team_id, member_id, created_by) values (c, p_team, p_member, auth.uid());
      exit;
    exception when unique_violation then
      if n >= 5 then raise; end if;
    end;
  end loop;
  return c;
end $$;

-- prima di entrare: azienda, nome e ruolo dietro un codice, senza entrare
create or replace function public.team_join_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select t.name as team, t.country, m.name, m.role, m.dept into r
    from team_invites i join teams t on t.id = i.team_id join team_members m on m.id = i.member_id
    where i.code = upper(btrim(p_code)) and i.used_at is null and i.expires_at > now()
      and m.status = 'attivo' and m.user_id is null;
  if not found then raise exception 'invalid code'; end if;
  return jsonb_build_object('team', r.team, 'country', r.country, 'name', r.name, 'role', r.role, 'dept', r.dept);
end $$;

-- entra nell'azienda con il codice: la persona preparata dal titolare diventa questo account
create or replace function public.team_join(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv team_invites%rowtype; em text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into inv from team_invites
    where code = upper(btrim(p_code)) and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid code'; end if;
  if exists (select 1 from team_members where team_id = inv.team_id and user_id = uid and status = 'attivo') then
    raise exception 'already member';
  end if;
  if (select count(*) from team_members where user_id = uid and status = 'attivo') >= 5 then raise exception 'too many teams'; end if;
  select email into em from auth.users where id = uid;
  update team_members set user_id = uid, email = em, joined_at = now()
    where id = inv.member_id and status = 'attivo' and user_id is null;
  if not found then raise exception 'invalid code'; end if;
  update team_invites set used_at = now(), used_by = uid where code = inv.code;
  return inv.team_id;
end $$;

-- esce dall'azienda da questo account: la persona resta nella squadra, ma senza app (e senza email)
create or replace function public.team_leave(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur team_members%rowtype;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into cur from team_members where team_id = p_team and user_id = uid and status = 'attivo';
  if not found then return; end if;
  if cur.role = 'titolare' and not exists (
       select 1 from team_members where team_id = p_team and role = 'titolare' and status = 'attivo'
         and user_id is not null and id <> cur.id) then
    raise exception 'last owner';
  end if;
  update team_members set user_id = null, email = null, joined_at = null where id = cur.id;
end $$;

-- elimina l'azienda con tutte le sue persone e gli inviti: solo il titolare
create or replace function public.team_delete(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.team_role(p_team) is distinct from 'titolare' then raise exception 'forbidden'; end if;
  delete from teams where id = p_team;
end $$;

-- le mie aziende, per l'app (con le regole di accesso di chi chiama)
create or replace function public.team_mine()
returns table(team_id uuid, team text, country text, region text, member_id uuid, name text, role text, dept text,
  week_hours numeric, leave_days numeric, leave_hours numeric)
language sql stable security invoker set search_path = public as $$
  select t.id, t.name, t.country, t.region, m.id, m.name, m.role, m.dept, m.week_hours, m.leave_days, m.leave_hours
  from team_members m join teams t on t.id = m.team_id
  where m.user_id = auth.uid() and m.status = 'attivo'
  order by m.joined_at
$$;

revoke all on function public.team_role(uuid), public.team_new_code(), public.team_create(text, text, text, text),
  public.team_update(uuid, text, text, text), public.team_member_save(uuid, uuid, text, text, text, numeric, numeric, numeric),
  public.team_member_remove(uuid, uuid), public.team_invite(uuid, uuid), public.team_join_preview(text), public.team_join(text),
  public.team_leave(uuid), public.team_delete(uuid), public.team_mine() from public, anon;
revoke all on function public.team_new_code() from authenticated;
grant execute on function public.team_role(uuid), public.team_create(text, text, text, text),
  public.team_update(uuid, text, text, text), public.team_member_save(uuid, uuid, text, text, text, numeric, numeric, numeric),
  public.team_member_remove(uuid, uuid), public.team_invite(uuid, uuid), public.team_join_preview(text), public.team_join(text),
  public.team_leave(uuid), public.team_delete(uuid), public.team_mine() to authenticated;
