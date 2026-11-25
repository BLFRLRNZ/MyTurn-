#!/bin/bash
# Prova le migrazioni del server su un Postgres 16 locale, senza toccare Supabase.
# Uso (da root, nella cartella del progetto): tests/sql/run.sh tests/sql/turni-squadra.sql
# Crea al primo uso un database di prova in /var/lib/postgresql/myturn-test (utente postgres, porta 5499),
# lo ricrea a ogni lancio con uno schema "auth" finto (auth.users, auth.uid() dai claims) e i ruoli anon e authenticated
# come su Supabase, applica le migrazioni e stampa le righe "ok" / "FAIL" dello script.
set -e
BIN=/usr/lib/postgresql/16/bin; DIR=/var/lib/postgresql/myturn-test; SOCK=/var/run/postgresql
if ! su postgres -s /bin/bash -c "$BIN/pg_isready -q -h $SOCK -p 5499"; then
  [ -d $DIR/data ] || su postgres -s /bin/bash -c "mkdir -p $DIR && $BIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
  su postgres -s /bin/bash -c "$BIN/pg_ctl -D $DIR/data -o '-p 5499 -k $SOCK' -l $DIR/log.txt start >/dev/null"; sleep 1
fi
P="psql -h $SOCK -p 5499 -U postgres -q"
$P -c "drop database if exists myturn" -c "create database myturn" >/dev/null
$P -d myturn -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $f$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
SQL
for f in 20261111000000_account_promemoria 20261125180000_aziende 20261125210000_turni_squadra; do
  $P -d myturn -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql 2>&1 | grep -v "NOTICE:  policy" || true; done
$P -d myturn -f "$1" 2>&1 | sed -e 's/^psql:[^:]*:[0-9]*: //' | grep -E "NOTICE|ERROR|FAIL" | sed 's/^NOTICE:  //'
