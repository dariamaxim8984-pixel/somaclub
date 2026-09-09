-- Промокоды: теперь код может открывать любой продукт (Поток 1 / Поток 2 / утро).
-- Запусти ОДИН РАЗ в Supabase → SQL Editor.

-- Добавляем столбец «какой продукт открывает код». Существующие коды остаются на Поток 1 (solo).
alter table promo_codes add column if not exists tariff text default 'solo';

-- Примеры (раскомментируй нужное):
-- Код на Поток 2 (тариф «Самостоятельно»):
-- insert into promo_codes (code, active, tariff) values ('SOMA2FREE', true, 'potok2_solo');
-- Код на Поток 2 с сопровождением:
-- insert into promo_codes (code, active, tariff) values ('SOMA2VIP', true, 'potok2_guided');
-- Существующий код перевести на Поток 2:
-- update promo_codes set tariff = 'potok2_solo' where code = 'ВАШ_КОД';
