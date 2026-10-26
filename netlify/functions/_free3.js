// СОМА УТРО — бесплатный лид-магнит «3 дня утра».
// Общая логика для бота (enroll при /start free3) и крона (free3-drip: дни 2–3).
// Видео лежат в самом Telegram: их file_id хранятся в таблице free3_config
// (ключи video1/video2/video3). Тексты — ниже, меняются здесь.
//
// Переменные окружения: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY

const GAP_HOURS = 20; // минимальный интервал между выдачами (чтобы день 2/3 приходили на след. утро)

function tg(token, method, params) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }).then((r) => r.json()).catch((e) => { console.error('[free3] tg', method, e && e.message); return { ok: false }; });
}

function sbHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

const TEXTS = {
  welcome:
    'Привет! Ты в СОМА УТРО 🌿\n\n' +
    'Следующие три утра, ровно в 7:00 по Москве, я буду присылать тебе по одной короткой практике — 10–15 минут. Делать можно хоть в кровати, без подготовки.\n\n' +
    'Ведём мы — Дарья (психолог, телесный терапевт) и Максим (хореограф). Наша задача — чтобы тело просыпалось живым, а день начинался из ресурса, а не из усталости.\n\n' +
    'Первая практика придёт завтра в 7:00. До встречи утром 🌿',
  day: {
    1:
      '🌿 <b>День 1 — Разбудить тело</b>\n' +
      'Мягко снимаем ночную скованность: шея, плечи, спина. Включай и просто повторяй за нами.\n\n' +
      'После практики напиши одним словом, как тело: «легче», «тепло», «спокойнее»? Так тело запоминает новое состояние.',
    2:
      '🌿 <b>День 2 — Дыхание и энергия</b>\n' +
      'Дыхание — это пульт управления состоянием. Несколько минут — и уходит тяжесть, приходит тонус и ясность. Лучше всего сразу после пробуждения, до телефона и кофе.\n\n' +
      'Задание: заметь, как меняется дыхание за эти минуты — глубже? свободнее? Напиши пару слов.',
    3:
      '🌿 <b>День 3 — Мягкость и спокойствие</b>\n' +
      'Финальная практика — как вернуть телу мягкость и войти в день без спешки и зажатости.\n\n' +
      'Позади все три утра — это уже настоящая забота о себе 🤍'
  },
  offer:
    'Три дня — это только вкус. По-настоящему меняется, когда практика становится привычкой и рядом есть поддержка.\n\n' +
    'В клубе <b>СОМА УТРО</b> мы занимаемся вживую 5 дней в неделю в 7:00 по Москве. Не получилось в эфир — остаётся запись.\n\n' +
    'Всего 1490 ₽ в месяц — меньше 50 ₽ в день.\n' +
    '🎁 Первая неделя — бесплатно.\n\n' +
    'Жми кнопку ниже — доступ в группу откроется сразу, без регистрации и оплаты.',
  // Дожим после трёх утр (дни 4, 5, 7). Ответы людей уходят Даше как отзывы.
  follow: {
    4: 'Привет, это Максим 👋\n\n' +
       'Три утра позади. Как тело сейчас — по сравнению с тем, что было до?\n\n' +
       'Жми кнопку внизу — одно касание. А захочется рассказать больше — пиши, мы с Дашей читаем каждое сообщение.',
    5: 'Многие после трёх утр говорят: «хочу так каждый день, но сам не соберусь».\n\n' +
       'Для этого и есть клуб <b>СОМА УТРО</b>: 5 утр в неделю вживую, в 7:00 по Москве, вместе с нами. Не получилось в эфир — остаётся запись.\n\n' +
       'Первая неделя — бесплатно, одной кнопкой, без регистрации 👇',
    7: 'Последнее сообщение от нас — дальше не беспокоим 🌿\n\n' +
       'Если захочешь вернуться к утренним практикам, бесплатная неделя в клубе ждёт тебя по кнопке.\n\n' +
       'А если просто было хорошо эти три утра — это уже много. Спасибо за них.'
  },
  button: { text: 'Забрать неделю бесплатно 🌿', url: 'https://t.me/soma_utro_bot?start=week' },
  // Быстрые ответы на день 4: нажатие приходит боту обычным текстом и сохраняется как отзыв.
  quickReplies: [['🌿 Легче', '😌 Спокойнее'], ['🤷 Так же', '⏳ Не успел(а)']]
};

// Достаём file_id трёх видео из free3_config.
async function getVideos(SUPABASE_URL, KEY) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/free3_config?key=in.(video1,video2,video3)&select=key,value`, { headers: sbHeaders(KEY) });
    const rows = await r.json();
    const m = {};
    (Array.isArray(rows) ? rows : []).forEach((x) => { m[x.key] = x.value; });
    return { 1: m.video1 || null, 2: m.video2 || null, 3: m.video3 || null };
  } catch (e) { console.error('[free3] getVideos', e && e.message); return { 1: null, 2: null, 3: null }; }
}

// Отправить практику дня: видео с подписью (если file_id есть) или текст-фолбэк.
async function sendPractice(token, chatId, fileId, caption, extra) {
  if (fileId) {
    return tg(token, 'sendVideo', { chat_id: chatId, video: fileId, caption, parse_mode: 'HTML', ...(extra || {}) });
  }
  return tg(token, 'sendMessage', { chat_id: chatId, text: caption + '\n\n(видео скоро добавим)', parse_mode: 'HTML', ...(extra || {}) });
}

// Запись на бесплатные 3 дня: приветствие + Практика 1.
async function enroll(env, chatId, userId, username) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN } = env;
  const H = sbHeaders(SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();
  // upsert участника (перезапуск сбрасывает прогресс). Практики шлёт крон по утрам в 7:00.
  // last_sent_at = сейчас, чтобы первая практика пришла ЗАВТРА утром, а не сегодня.
  await fetch(`${SUPABASE_URL}/rest/v1/free3_members`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ telegram_user_id: userId, chat_id: chatId, username, day_sent: 0, started_at: now, last_sent_at: now })
  });
  // При входе — только приветствие.
  await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: TEXTS.welcome, parse_mode: 'HTML', disable_web_page_preview: true });
}

// Ежедневная выдача практик 2 и 3 и дожима (дни 4–7) тем, у кого пришло время.
async function drip(env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN } = env;
  const H = sbHeaders(SUPABASE_SERVICE_KEY);
  // Порог — начало сегодняшнего дня по Москве (UTC+3). Выдаём следующую практику тем,
  // чья прошлая активность (вход или прошлая практика) была вчера или раньше — один шаг в день.
  const mskNow = new Date(Date.now() + 3 * 3600 * 1000);
  const thresholdMs = Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate()) - 3 * 3600 * 1000;
  const threshold = new Date(thresholdMs).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/free3_members?day_sent=lt.7&last_sent_at=lt.${encodeURIComponent(threshold)}&select=telegram_user_id,chat_id,day_sent&limit=1000`;
  let rows = [];
  try { const r = await fetch(url, { headers: H }); rows = await r.json(); } catch (e) { console.error('[free3] drip query', e && e.message); return { sent: 0, error: true }; }
  if (!Array.isArray(rows)) return { sent: 0 };
  const vids = await getVideos(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let sent = 0;
  // Кто уже в клубе — тому дожим не шлём.
  let inClub = new Set();
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/utro_members?active=eq.true&select=telegram_user_id`, { headers: H });
    const j = await r.json(); if (Array.isArray(j)) inClub = new Set(j.map((x) => String(x.telegram_user_id)));
  } catch (e) {}
  for (const m of rows) {
    let next = m.day_sent + 1;
    if (next >= 4) {
      // Дожим: 4 — вопрос «как ты», 5 — приглашение, 6 — пауза, 7 — последнее мягкое напоминание.
      if (inClub.has(String(m.telegram_user_id))) next = 7;
      else if (TEXTS.follow[next]) {
        sent++;
        const markup = next === 4
          ? { keyboard: TEXTS.quickReplies, resize_keyboard: true, one_time_keyboard: true }
          : { inline_keyboard: [[TEXTS.button]] };
        await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
          chat_id: m.chat_id, text: TEXTS.follow[next], parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: markup
        });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/free3_members?telegram_user_id=eq.${m.telegram_user_id}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ day_sent: next, last_sent_at: new Date().toISOString() })
      });
      continue;
    }
    await sendPractice(TELEGRAM_BOT_TOKEN, m.chat_id, vids[next], TEXTS.day[next]);
    if (next === 3) {
      await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: m.chat_id, text: TEXTS.offer, parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[TEXTS.button]] }
      });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/free3_members?telegram_user_id=eq.${m.telegram_user_id}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ day_sent: next, last_sent_at: new Date().toISOString() })
    });
    sent++;
  }
  return { sent };
}

module.exports = { TEXTS, tg, getVideos, sendPractice, enroll, drip };
