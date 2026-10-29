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
  // Принимаем значение из переменной окружения ИЛИ текущее значение вебхука
  // (страховка на случай, если env не подхватился при деплое; можно убрать позже).
  {
    const h = event.headers || {};
    const got = h['x-telegram-bot-api-secret-token'] || h['X-Telegram-Bot-Api-Secret-Token'];
    const allowed = [TG_WEBHOOK_SECRET, '2c449e44302e47c3a8080ffdfdb1a050fd453dafd636740f067a665dbfbcf8cb'].filter(Boolean);
    if (allowed.length && !allowed.includes(got)) return { statusCode: 401, body: 'bad secret' };
  }

  let update = {};
  try { update = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 200, body: 'ok' }; }

  const msg = update.message || update.edited_message;

  // Приём видео (от вас) для лид-магнита: бот возвращает file_id ролика,
  // чтобы записать его в free3_config. Обрабатываем ДО текстового фильтра ниже.
  if (msg && msg.chat && msg.chat.type === 'private' && !msg.text) {
    const media = msg.video || msg.animation || msg.document || msg.video_note;
    if (media && media.file_id) {
      await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: msg.chat.id,
        text: 'file_id этого видео:\n<code>' + media.file_id + '</code>\n\nСкопируй и пришли Claude, чтобы вставить в бесплатные «3 дня».',
        parse_mode: 'HTML'
      });
      return { statusCode: 200, body: 'ok' };
    }
  }

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

    // Бесплатный лид-магнит «3 дня утра». С 29.10.2026 бесплатных недель нет:
    // старые ссылки ?start=week тоже ведут сюда (кроме тех, кто уже в клубе — им ниже свежая ссылка в группу).
    let isPaidForWeek = false;
    if (token === 'week') {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/utro_members?telegram_user_id=eq.${fromId}&active=eq.true&select=user_id,trial_until&limit=1`, { headers: authHeaders });
        const rows = await r.json();
        const m = Array.isArray(rows) ? rows[0] : null;
        isPaidForWeek = !!(m && (m.user_id || (m.trial_until && new Date(m.trial_until) > new Date())));
      } catch (e) { console.error('[bot] week paid check', e && e.message); }
    }
    if (token === 'free3' || (token === 'week' && !isPaidForWeek)) {
      try {
        const free3 = require('./_free3');
        await free3.enroll(process.env, chatId, fromId, username);
      } catch (e) {
        console.error('[bot] free3 enroll', e && e.message);
        await say('Упс, что-то пошло не так 🤔 Напиши сюда — поможем.');
      }
      return { statusCode: 200, body: 'ok' };
    }

    // Бесплатная неделя в клубе — одной кнопкой, без сайта и регистрации.
    // Один раз на Telegram-аккаунт: срок храним в utro_members.trial_until.
    if (token === 'week') {
      const SITE = 'https://somaclub.ru';
      let m = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/utro_members?telegram_user_id=eq.${fromId}&select=telegram_user_id,active,trial_until,user_id&limit=1`, { headers: authHeaders });
        const rows = await r.json();
        m = Array.isArray(rows) ? rows[0] : null;
      } catch (e) { console.error('[bot] week lookup', e && e.message); }

      const now = Date.now();
      const paidMember = m && m.active && m.user_id;
      const trialEnd = m && m.trial_until ? new Date(m.trial_until) : null;
      const trialActive = trialEnd && trialEnd.getTime() > now;

      if (!paidMember && trialEnd && !trialActive) {
        await say('Бесплатная неделя у тебя уже была 🌿\n\nЧтобы вернуться в утренние эфиры — продли доступ: 1490 ₽ в месяц, 5 живых утр в неделю в 7:00 по Москве.', {
          reply_markup: { inline_keyboard: [[{ text: 'Продолжить в клубе', url: `${SITE}/utro.html` }]] }
        });
        return { statusCode: 200, body: 'ok' };
      }

      const isNew = !paidMember && !trialActive;
      const until = isNew ? new Date(now + 7 * 24 * 60 * 60 * 1000) : trialEnd;
      if (isNew) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/utro_members`, {
            method: 'POST',
            headers: { ...authHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              telegram_user_id: fromId,
              telegram_username: username,
              active: true,
              removed_at: null,
              trial_until: until.toISOString(),
              updated_at: new Date().toISOString()
            })
          });
        } catch (e) { console.error('[bot] week upsert', e && e.message); }
      }

      let invite = null;
      const res = await tg(TELEGRAM_BOT_TOKEN, 'createChatInviteLink', {
        chat_id: UTRO_CHAT_ID, member_limit: 1, name: `week ${fromId}`.slice(0, 32)
      });
      if (res && res.ok && res.result) invite = res.result.invite_link;

      const till = until && !paidMember
        ? until.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }) : null;
      if (invite) {
        await say(
          paidMember
            ? 'Ты уже в клубе <b>СОМА УТРО</b> ✅ Вот свежая ссылка в группу 👇'
            : `Неделя в клубе <b>СОМА УТРО</b> открыта ✅\nДоступ до ${till}.\n\n` +
              'Живые эфиры — 5 дней в неделю в 7:00 по Москве: движение, дыхание, тело. 15–20 минут.\n' +
              'Не получилось в эфир — запись остаётся в группе.\n\n' +
              'Жми, чтобы войти 👇',
          { reply_markup: { inline_keyboard: [[{ text: 'Войти в группу', url: invite }]] } }
        );
      } else {
        await say('Доступ открыт ✅, но не получилось создать ссылку в группу. Напиши сюда — пришлём вручную.');
      }

      // Сообщаем Даше о новом участнике пробной недели.
      if (isNew && process.env.OWNER_CHAT_ID) {
        await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
          chat_id: process.env.OWNER_CHAT_ID,
          text: `🌿 Новый участник на бесплатной неделе: ${username || fromId} (до ${till})`
        });
      }
      return { statusCode: 200, body: 'ok' };
    }

    if (!token) {
      await say('Привет! Это бот клуба <b>СОМА УТРО</b> 🌿\n\nЖивые утренние эфиры 5 дней в неделю в 7:00 по Москве. Начни с трёх бесплатных утр — по короткой практике каждое утро 👇\n\nЕсли ты уже оплатил(а) — открой персональную ссылку из письма; нет ссылки — напиши сюда, поможем.', {
        reply_markup: { inline_keyboard: [[{ text: '3 утра бесплатно 🌿', url: 'https://t.me/soma_utro_bot?start=free3' }]] }
      });
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

  // --- любое другое сообщение: отзыв участника или обращение ---
  const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID; // личка Даши (куда слать отзывы)

  // участник ли бесплатных «3 дней»?
  let isFree3 = false;
  let free3Day = 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/free3_members?telegram_user_id=eq.${fromId}&select=telegram_user_id,day_sent&limit=1`, { headers: authHeaders });
    const rows = await r.json();
    isFree3 = Array.isArray(rows) && rows.length > 0;
    if (isFree3) free3Day = rows[0].day_sent || 0;
  } catch (e) { console.error('[bot] free3 check', e && e.message); }

  // сохраняем отзыв/сообщение в базу (история + материал для сторис)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/free3_feedback`, {
      method: 'POST',
      headers: { ...authHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ telegram_user_id: fromId, username, text, is_free3: isFree3 })
    });
  } catch (e) { console.error('[bot] feedback save', e && e.message); }

  // пересылаем Даше в личку
  if (OWNER_CHAT_ID) {
    const who = username || ('id ' + fromId);
    const tag = isFree3 ? '🌿 Отзыв (3 дня)' : '✉️ Сообщение боту';
    await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
      chat_id: OWNER_CHAT_ID,
      text: `${tag}\nОт: ${who}\n\n${text}`,
      disable_web_page_preview: true
    });
  }

  // тёплый ответ человеку
  if (isFree3) {
    const hide = { reply_markup: { remove_keyboard: true } }; // убираем кнопки быстрых ответов дня 4
    if (/не успел/i.test(text)) {
      await say('Ничего страшного 🌿 Все три практики остаются в этом чате выше — сделай любую завтра утром, до телефона и кофе. Расскажешь, как прошло?', hide);
    } else {
      await say(free3Day >= 3
        ? 'Спасибо, что делишься 🌿 Мы с Дашей читаем каждое сообщение — это для нас очень ценно.'
        : 'Спасибо, что делишься 🌿 Тело запоминает новое состояние, когда ты его называешь. До встречи завтра утром!', hide);
    }
  } else {
    await say('Я бот клуба <b>СОМА УТРО</b> 🌿 Чтобы получить доступ, открой персональную ссылку из письма после оплаты. Нужна помощь — опиши, что случилось, мы ответим.');
  }
  return { statusCode: 200, body: 'ok' };
};
