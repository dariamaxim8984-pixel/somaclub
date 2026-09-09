// SOMA CLUB — приём уведомлений об оплате от Тинькофф (Notification).  [v2 + welcome]
// Банк присылает сюда POST после каждой смены статуса платежа.
// NotificationURL в кабинете эквайринга: https://somaclub.ru/.netlify/functions/payment-webhook
//
// Переменные окружения:
//   TINKOFF_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY
//   RESEND_API_KEY — для welcome-письма (необязательно; без него письмо не шлётся)

const crypto = require('crypto');
const { sendWelcome } = require('./_email');

const ACCESS_DAYS = 30; // срок доступа после оплаты

// Проверка подписи: все корневые поля кроме Token, плюс Password,
// сортировка по ключу, склейка значений, SHA-256.
function checkToken(payload, password) {
  const received = payload.Token;
  const data = {};
  for (const k of Object.keys(payload)) {
    if (k === 'Token') continue;
    const v = payload[k];
    if (v === null || typeof v === 'object') continue;
    data[k] = typeof v === 'boolean' ? String(v) : v;
  }
  data.Password = password;
  const sign = crypto.createHash('sha256')
    .update(Object.keys(data).sort().map((k) => data[k]).join(''))
    .digest('hex');
  return sign === received;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { TINKOFF_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!TINKOFF_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: 'Not configured' };
  }

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: 'Bad body' };
  }

  // 1) Проверяем подпись — защита от поддельных уведомлений.
  if (!checkToken(payload, TINKOFF_PASSWORD)) {
    return { statusCode: 403, body: 'Bad token' };
  }

  const orderId = payload.OrderId;
  const status = payload.Status;
  const paymentId = payload.PaymentId ? String(payload.PaymentId) : null;
  if (!orderId) return { statusCode: 400, body: 'No OrderId' };

  const authHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
  const enc = encodeURIComponent(orderId);

  // 2) CONFIRMED — открываем доступ и шлём welcome (один раз).
  if (status === 'CONFIRMED') {
    const until = new Date(Date.now() + ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const patch = { status: 'confirmed', payment_id: paymentId, paid_until: until, updated_at: new Date().toISOString() };
    try {
      // Обновляем только если заказ ещё НЕ подтверждён — письмо уйдёт единожды,
      // даже если банк пришлёт CONFIRMED повторно. return=representation вернёт строку.
      const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${enc}&status=neq.confirmed`, {
        method: 'PATCH',
        headers: { ...authHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
      if (!r.ok) { const t = await r.text(); return { statusCode: 500, body: 'DB update failed: ' + t }; }
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const order = rows[0];
        console.log('[webhook] оплата подтверждена, шлём welcome ->', order.email);
        await sendWelcome(order.email, order.tariff, order.tg_token);
      }
    } catch (e) {
      return { statusCode: 500, body: 'DB error' };
    }
    return { statusCode: 200, body: 'OK' };
  }

  // 3) Прочие финальные статусы — обновляем без письма.
  let patch;
  if (status === 'REJECTED' || status === 'CANCELED' || status === 'AUTH_FAIL') {
    patch = { status: 'rejected', payment_id: paymentId, updated_at: new Date().toISOString() };
  } else if (status === 'REFUNDED' || status === 'PARTIAL_REFUNDED' || status === 'REVERSED') {
    // Возврат/отмена — закрываем доступ: помечаем заказ отклонённым и ставим срок в прошлое.
    patch = { status: 'rejected', payment_id: paymentId, paid_until: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString() };
  } else {
    return { statusCode: 200, body: 'OK' };
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${enc}`, {
      method: 'PATCH',
      headers: { ...authHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (!r.ok) { const t = await r.text(); return { statusCode: 500, body: 'DB update failed: ' + t }; }
  } catch (e) {
    return { statusCode: 500, body: 'DB error' };
  }

  return { statusCode: 200, body: 'OK' };
};
