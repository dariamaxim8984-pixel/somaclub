-- SOMA CLUB — Поток 2: доступ и разрешение новых тарифов.
-- Запусти ОДИН РАЗ в Supabase → SQL Editor.

-- 1) Разрешаем тарифы Потока 2 в таблице orders.
--    Без этого оплата Потока 2 упадёт (как было с утром) — ограничение отклонит tariff.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'orders'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%tariff%'
   limit 1;
  if c is not null then
    execute format('alter table orders drop constraint %I', c);
  end if;
end $$;

alter table orders
  add constraint orders_tariff_check
  check (tariff = any (array['solo','guided','utro','potok2_solo','potok2_guided']));

-- 2) Доступ к ПОТОКУ 2 — независим от Потока 1 и от утра.
--    (Поток 1 = has_active_access() по тарифам solo/guided — не меняем.)
create or replace function has_active_access_potok2()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from orders
    where user_id = auth.uid()
      and status = 'confirmed'
      and coalesce(paid_until, to_timestamp(0)) > now()
      and tariff in ('potok2_solo','potok2_guided')
  );
$$;

grant execute on function has_active_access_potok2() to anon, authenticated;
