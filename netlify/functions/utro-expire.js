// СОМА УТРО — ежедневная проверка подписок.
// Убирает из закрытой группы тех, у кого доступ закончился, и напоминает за 3 дня.
// Расписание задаётся в netlify.toml. Запуск вручную (для теста):
//   https://somaclub.ru/.netlify/functions/utro-expire
//
// Переменные окружения:
//   TELEGRAM_BOT_TOKEN, UTRO_CHAT_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY
//   SITE_URL (необязательно; по умолчанию https://somaclub.ru)

async function tg(token, method, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return await r.json();
  } catch (e) {
    console.error('[expire] tg error', method, e && e.message);
    return { ok: false };
  }
}

exports.handler = async () => {
  const {
    TELEGRAM_BOT_TOKEN, UTRO_CHAT_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY
  } = process.env;
  const SITE = process.env.SITE_URL || 'https://somaclub.ru';
  if (!TELEGRAM_BOT_TOKEN || !UTRO_CHAT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[expire] not configured');
    return { statusCode: 200, body: 'not configured' };
  }

  const authHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
  const now = Date.now();
  const REMIND_MS = 3 * 24 * 60 * 60 * 1000;
  const renewKb = { inline_keyboard: [[{ text: 'Продлить доступ', url: `${SITE}/utro.html` }]] };

  // Все активные участники.
  let members = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/utro_members?active=eq.true&select=telegram_user_id,user_id,reminded_until`, { headers: authHeaders });
    members = await r.json();
    if (!Array.isArray(members)) members = [];
  } catch (e) {
    console.error('[expire] members fetch error', e && e.message);
    return { statusCode: 500, body: 'db error' };
  }

  let removed = 0, reminded = 0;

  for (const m of members) {
    // Текущий срок доступа = самый поздний paid_until по подтверждённым utro-заказам.
    let paidUntil = null;
    try {
      const url = `${SUPABASE_URL}/rest/v1/orders?user_id=eq.${m.user_id}&tariff=eq.utro&status=eq.confirmed&select=paid_until&order=paid_until.desc&limit=1`;
      const r = await fetch(url, { headers: authHeaders });
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0] && rows[0].paid_until) paidUntil = new Date(rows[0].paid_until).getTime();
    } catch (e) { console.error('[expire] order fetch error', e && e.message); continue; }

    const expired = !paidUntil || paidUntil <= now;

    if (expired) {
      // Убираем из группы: ban + unban (чтобы мог вернуться после новой оплаты).
      await tg(TELEGRAM_BOT_TOKEN, 'banChatMember', { chat_id: UTRO_CHAT_ID, user_id: m.telegram_user_id });
      await tg(TELEGRAM_BOT_TOKEN, 'unbanChatMember', { chat_id: UTRO_CHAT_ID, user_id: m.telegram_user_id, only_if_banned: true });
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/utro_members?telegram_user_id=eq.${m.telegram_user_id}`, {
          method: 'PATCH', headers: { ...authHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ active: false, removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
      } catch (e) { console.error('[expire] deactivate error', e && e.message); }
      await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: m.telegram_user_id, parse_mode: 'HTML', disable_web_page_preview: true,
        text: 'Твой доступ в <b>СОМА УТРО</b> закончился 🌿 Будем рады видеть снова — продлить можно здесь:',
        reply_markup: renewKb
      });
      removed++;
      continue;
    }

    // Напоминание за 3 дня — один раз на цикл (сравниваем с reminded_until).
    const soon = paidUntil - now <= REMIND_MS;
    const alreadyReminded = m.reminded_until && new Date(m.reminded_until).getTime() >= paidUntil;
    if (soon && !alreadyReminded) {
      await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: m.telegram_user_id, parse_mode: 'HTML', disable_web_page_preview: true,
        text: 'Напоминаем: доступ в <b>СОМА УТРО</b> заканчивается через пару дней. Чтобы не потерять эфиры — продли заранее 👇',
        reply_markup: renewKb
      });
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/utro_members?telegram_user_id=eq.${m.telegram_user_id}`, {
          method: 'PATCH', headers: { ...authHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ reminded_until: new Date(paidUntil).toISOString(), updated_at: new Date().toISOString() })
        });
      } catch (e) { console.error('[expire] remind mark error', e && e.message); }
      reminded++;
    }
  }

  console.log(`[utro-expire] checked=${members.length} removed=${removed} reminded=${reminded}`);
  return { statusCode: 200, body: `ok checked=${members.length} removed=${removed} reminded=${reminded}` };
};
