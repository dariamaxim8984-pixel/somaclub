// СОМА УТРО — Telegram-бот (вебхук). Выдаёт доступ в закрытую группу после оплаты.
// Netlify публикует функцию по адресу:
//   https://somaclub.ru/.netlify/functions/telegram-bot
// Вебхук ставится один раз (см. инструкцию по деплою).
//
// Переменные окружения:
//   TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
//   UTRO_CHAT_ID        — id закрытой группы (напр. -1001234567890)
//   TG_WEBHOOK_SECRET   — произвольная строка; та же передаётся в setWebhook (secret_token)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

async function tg(token, method, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return await r.json();
  } catch (e) {
    console.error('[bot] tg error', method, e && e.message);
    return { ok: false };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' };

  const {
    TELEGRAM_BOT_TOKEN, UTRO_CHAT_ID, TG_WEBHOOK_SECRET,
    SUPABASE_URL, SUPABASE_SERVICE_KEY
  } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !UTRO_CHAT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[bot] not configured');
    return { statusCode: 200, body: 'not configured' };
  }

  // Проверяем секрет вебхука (Telegram шлёт его заголовком).
  if (TG_WEBHOOK_SECRET) {
    const h = event.headers || {};
    const got = h['x-telegram-bot-api-secret-token'] || h['X-Telegram-Bot-Api-Secret-Token'];
    if (got !== TG_WEBHOOK_SECRET) return { statusCode: 401, body: 'bad secret' };
  }

  let update = {};
  try { update = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 200, body: 'ok' }; }

  const msg = update.message || update.edited_message;
  // Реагируем только на текст в личке с ботом.
  if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.text) {
    return { statusCode: 200, body: 'ok' };
  }

  const chatId = msg.chat.id;
  const fromId = msg.from && msg.from.id;
  const username = msg.from && msg.from.username ? '@' + msg.from.username : null;
  const text = msg.text.trim();

  const authHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
  const say = (t, extra) => tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
    chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: true, ...(extra || {})
  });

  // --- /start [token] ---
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) {
      await say('Привет! Это бот клуба <b>СОМА УТРО</b> 🌿\n\nЧтобы получить доступ, открой персональную ссылку из письма после оплаты (или со страницы «спасибо»). Если оплатил(а), а ссылки нет — напиши сюда, поможем.');
      return { statusCode: 200, body: 'ok' };
    }

    // Ищем заказ по токену.
    let order = null;
    try {
      const url = `${SUPABASE_URL}/rest/v1/orders?tg_token=eq.${encodeURIComponent(token)}&tariff=eq.utro&select=order_id,user_id,email,status,paid_until&limit=1`;
      const r = await fetch(url, { headers: authHeaders });
      const rows = await r.json();
      order = Array.isArray(rows) ? rows[0] : null;
    } catch (e) { console.error('[bot] lookup error', e && e.message); }

    if (!order) {
      await say('Не получилось распознать ссылку 🤔 Открой её целиком из письма. Если не помогает — напиши сюда, выдадим доступ вручную.');
      return { statusCode: 200, body: 'ok' };
    }

    const active = order.status === 'confirmed' && order.paid_until && new Date(order.paid_until) > new Date();
    if (!active) {
      await say('Пока не вижу активной оплаты по этой ссылке. Если только что оплатил(а) — подожди минуту и нажми ссылку ещё раз. Вопросы — пиши сюда.');
      return { statusCode: 200, body: 'ok' };
    }

    // Персональная одноразовая ссылка в группу.
    let invite = null;
    const res = await tg(TELEGRAM_BOT_TOKEN, 'createChatInviteLink', {
      chat_id: UTRO_CHAT_ID,
      member_limit: 1,
      name: `utro ${order.order_id}`.slice(0, 32)
    });
    if (res && res.ok && res.result) invite = res.result.invite_link;

    // Фиксируем/обновляем участника (upsert по telegram_user_id).
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/utro_members`, {
        method: 'POST',
        headers: { ...authHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          telegram_user_id: fromId,
          telegram_username: username,
          user_id: order.user_id,
          email: order.email,
          active: true,
          removed_at: null,
          updated_at: new Date().toISOString()
        })
      });
    } catch (e) { console.error('[bot] member upsert error', e && e.message); }

    if (invite) {
      await say('Доступ открыт ✅\n\nТы в клубе <b>СОМА УТРО</b>. Эфиры — 5 дней в неделю в 7:00 по Москве.\n\nЖми кнопку, чтобы войти в закрытую группу 👇', {
        reply_markup: { inline_keyboard: [[{ text: 'Войти в группу', url: invite }]] }
      });
    } else {
      await say('Оплата подтверждена ✅, но не удалось создать ссылку на группу. Напиши сюда — вышлем вручную в течение дня.');
    }
    return { statusCode: 200, body: 'ok' };
  }

  // --- любое другое сообщение ---
  await say('Я бот клуба <b>СОМА УТРО</b> 🌿 Чтобы получить доступ, открой персональную ссылку из письма после оплаты. Нужна помощь — опиши, что случилось, мы ответим.');
  return { statusCode: 200, body: 'ok' };
};
