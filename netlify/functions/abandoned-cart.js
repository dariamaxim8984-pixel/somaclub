// SOMA CLUB — брошенная корзина. Запускается по расписанию (см. netlify.toml).
// Раз в день находит тех, кто зарегался ≥24ч назад, дал согласие, не оплатил
// и ещё не получал напоминание — и шлёт им одно письмо.
//
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY

const { sendAbandoned } = require('./_email');

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[abandoned] нет SUPABASE_URL / SUPABASE_SERVICE_KEY');
    return { statusCode: 500, body: 'Not configured' };
  }

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  // 1) Кандидаты (SQL-функция abandoned_cart_candidates).
  let rows = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/abandoned_cart_candidates`, {
      method: 'POST', headers, body: '{}'
    });
    if (!r.ok) { console.error('[abandoned] rpc error', r.status, await r.text()); return { statusCode: 500, body: 'rpc error' }; }
    rows = await r.json();
  } catch (e) {
    console.error('[abandoned] rpc exception', e && e.message);
    return { statusCode: 500, body: 'rpc exception' };
  }

  console.log('[abandoned] кандидатов:', Array.isArray(rows) ? rows.length : 0);
  if (!Array.isArray(rows) || rows.length === 0) return { statusCode: 200, body: 'no candidates' };

  // 2) Шлём письмо и отмечаем в журнале (чтобы не повторять).
  let sent = 0;
  for (const row of rows) {
    const res = await sendAbandoned(row.email, row.name);
    if (res && res.ok) {
      sent++;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/email_log`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: row.user_id, type: 'abandoned' })
        });
      } catch (e) { console.error('[abandoned] log insert error', e && e.message); }
    }
  }

  console.log('[abandoned] отправлено писем:', sent);
  return { statusCode: 200, body: `sent ${sent}` };
};
