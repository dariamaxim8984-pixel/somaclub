// SOMA CLUB — активация промокода на бесплатный доступ (30 дней).  [v2 + welcome]
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY

const crypto = require('crypto');
const { sendWelcome } = require('./_email');

const DAYS = 30;
const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json(500, { error: 'Не настроено' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const token = body.accessToken;
  const code = String(body.code || '').trim().toUpperCase();
  if (!token) return json(401, { error: 'Войдите в аккаунт' });
  if (!code)  return json(400, { error: 'Введите промокод' });

  // 1) Кто активирует — проверяем JWT.
  let user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!r.ok) return json(401, { error: 'Сессия истекла, войдите снова' });
    user = await r.json();
  } catch (e) { return json(401, { error: 'Ошибка авторизации' }); }
  if (!user || !user.id) return json(401, { error: 'Пользователь не найден' });

  // 2) Проверяем промокод (через service role — RLS не мешает).
  let promo;
  try {
    const q = await fetch(
      `${SUPABASE_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&select=code,active,valid_until,tariff`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await q.json();
    promo = Array.isArray(rows) ? rows[0] : null;
  } catch (e) { return json(500, { error: 'Ошибка проверки кода' }); }

  if (!promo || promo.active !== true) return json(404, { error: 'Промокод недействителен' });
  if (promo.valid_until && new Date(promo.valid_until) < new Date())
    return json(410, { error: 'Срок действия промокода истёк' });

  // Какой продукт открывает код (по столбцу tariff; по умолчанию — Поток 1 «solo»).
  const grantTariff = promo.tariff || 'solo';

  // 3) Выдаём доступ: подтверждённый заказ на 30 дней, сумма 0.
  // Для СОМА УТРО генерируем персональный токен для входа в Telegram-бота
  // (как при обычной оплате) — иначе бот не найдёт заказ по /start.
  const tgToken = crypto.randomBytes(24).toString('hex');
  const paidUntil = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000).toISOString();
  const orderId = `promo-${code}-${user.id.slice(0, 8)}-${Date.now()}`;
  try {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        order_id: orderId, user_id: user.id, email: user.email,
        tariff: grantTariff, amount: 0, status: 'confirmed',
        payment_id: 'promo:' + code, paid_until: paidUntil, tg_token: tgToken
      })
    });
    if (!ins.ok) return json(500, { error: 'Не удалось выдать доступ' });
  } catch (e) { return json(500, { error: 'Ошибка базы данных' }); }

  // 4) Welcome-письмо (best-effort — не влияет на выдачу доступа).
  console.log('[promo] v2: доступ выдан (%s), шлём welcome -> %s', grantTariff, user.email);
  await sendWelcome(user.email, grantTariff);

  // Для утро возвращаем токен, чтобы фронт показал ссылку-вход в бота.
  return json(200, { ok: true, tariff: grantTariff, tgToken: (grantTariff === 'utro' ? tgToken : null) });
};
