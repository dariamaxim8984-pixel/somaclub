-- СОМА УТРО — разграничение доступа по продукту.
-- Запусти это один раз в Supabase → SQL Editor.
--
-- Логика: курс (телесная терапия) = тарифы solo, guided.
--         СОМА УТРО = тариф utro.
-- Чтобы покупка «утра» НЕ открывала курс (и наоборот), доступ проверяется по тарифу.

-- Доступ к КУРСУ: только тарифы курса.
create or replace function has_active_access()
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
      and tariff in ('solo','guided')
  );
$$;

-- Доступ к СОМА УТРО.
create or replace function has_active_access_utro()
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
      and tariff = 'utro'
  );
$$;

grant execute on function has_active_access()      to anon, authenticated;
grant execute on function has_active_access_utro() to anon, authenticated;
