// СОМА УТРО — бесплатный лид-магнит «3 зарядки» → одно живое утро → клуб.
// Общая логика для бота (enroll при /start free3) и крона (free3-drip: зарядки 2–3 и дожим).
// Видео лежат в самом Telegram: их file_id хранятся в таблице free3_config
// (ключи video1/video2/video3). Тексты — ниже, меняются здесь.
// 16.11.2026: зарядка 1 приходит сразу при входе; после зарядки 3 — приглашение на одно живое утро
// (?start=live1, логика в telegram-bot.js); предложение клуба — на 5-й день.
//
// Переменные окружения: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY

const BOT = 'https://t.me/soma_utro_bot';

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
    'Привет! Это Максим из СОМА 🌿\n\n' +
    'Три утра подряд — по одной зарядке на 10–15 минут. Можно прямо в пижаме, без подготовки.\n\n' +
    'Первая — уже ниже 👇 Вторая придёт завтра в 7:00 по Москве.',
  again:
    'Зарядки уже идут тебе в этот чат 🌿 Первая — ниже ещё раз, следующие приходят в 7:00 по Москве.',
  day: {
    1:
      '🌿 <b>Зарядка 1 — разбудить тело</b>\n' +
      'Шея, плечи, спина. Включай и повторяй за нами.\n\n' +
      'После — напиши одним словом, как тело: «легче», «тепло», «спокойнее»?',
    2:
      '🌿 <b>Зарядка 2 — дыхание и энергия</b>\n' +
      'Лучше сразу после пробуждения, до телефона и кофе.\n\n' +
      'Заметь, как меняется дыхание. Напиши пару слов.',
    3:
      '🌿 <b>Зарядка 3 — мягко войти в день</b>\n' +
      'Без спешки и зажатости. Это последняя из трёх 🤍'
  },
  // Сразу после зарядки 3.
  liveInvite:
    'Три зарядки позади. А теперь главное — попробуй, как это вживую.\n\n' +
    'Каждое будничное утро в 7:00 по Москве мы с Дашей выходим в эфир в группе: движение, танец, дыхание, 15–20 минут. Рядом люди, которые встают вместе с тобой.\n\n' +
    '🎁 Одно живое утро — бесплатно. Жми, и я пришлю ссылку в группу 👇',
  // Дожим (дни 4, 5, 7). Ответы людей уходят Даше как отзывы.
  follow: {
    4: 'Привет, это Максим 👋 Как тело после трёх зарядок?\n\n' +
       'Жми кнопку внизу — одно касание. А захочется рассказать больше — пиши, мы с Дашей читаем каждое сообщение.',
    5: 'Многие после зарядок говорят: «хочу так каждый день, но сам не соберусь».\n\n' +
       'Для этого и есть клуб <b>СОМА УТРО</b>: 5 живых утр в неделю в 7:00 по Москве, с нами и группой. Не успел(а) в эфир — запись остаётся.\n\n' +
       '1490 ₽ в месяц — меньше 50 ₽ за утро 👇',
    7: 'Последнее сообщение от нас — дальше не беспокоим 🌿\n\n' +
       'Захочешь вернуться к утрам — клуб по кнопке. А если просто было хорошо эти три утра — это уже много. Спасибо за них.'
  },
  liveNudge: 'Если ещё не был(а) на живом утре — оно ждёт тебя 👇',
  liveButton: { text: 'Хочу живое утро 🌿', url: `${BOT}?start=live1` },
  button: { text: 'Вступить в клуб СОМА УТРО 🌿', url: 'https://somaclub.ru/utro.html' },
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

// Отправить зарядку дня: видео с подписью; если file_id сохранён как файл/гифка — шлём тем же типом;
// если не вышло ничего — текст-фолбэк, чтобы человек не остался без сообщения.
async function sendPractice(token, chatId, fileId, caption, extra) {
  if (fileId) {
    const base = { chat_id: chatId, caption, parse_mode: 'HTML', ...(extra || {}) };
    let r = await tg(token, 'sendVideo', { ...base, video: fileId });
    if (r && r.ok) return r;
    console.error('[free3] sendVideo', r && r.description);
    r = await tg(token, 'sendDocument', { ...base, document: fileId });
    if (r && r.ok) return r;
    console.error('[free3] sendDocument', r && r.description);
    r = await tg(token, 'sendAnimation', { ...base, animation: fileId });
    if (r && r.ok) return r;
    console.error('[free3] sendAnimation', r && r.description);
  }
  return tg(token, 'sendMessage', { chat_id: chatId, text: caption + '\n\n(видео скоро добавим)', parse_mode: 'HTML', ...(extra || {}) });
}

// Запись на 3 зарядки: приветствие + зарядка 1 сразу. Повторный вход прогресс не сбрасывает.
// Возвращает true, если человек новый.
async function enroll(env, chatId, userId, username) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN } = env;
  const H = sbHeaders(SUPABASE_SERVICE_KEY);
  let existing = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/free3_members?telegram_user_id=eq.${userId}&select=telegram_user_id,day_sent&limit=1`, { headers: H });
    const rows = await r.json();
    existing = Array.isArray(rows) ? rows[0] : null;
  } catch (e) { console.error('[free3] enroll lookup', e && e.message); }

  const vids = await getVideos(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // Кто проходил зарядки давно (до 16.11 и закончил цепочку) — начинаем заново.
  const isNew = !existing || existing.day_sent >= 7;
  if (isNew) {
    const now = new Date().toISOString();
    // day_sent = 1: зарядка 1 выдана сейчас; крон пришлёт зарядку 2 завтра в 7:00.
    await fetch(`${SUPABASE_URL}/rest/v1/free3_members`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ telegram_user_id: userId, chat_id: chatId, username, day_sent: 1, started_at: now, last_sent_at: now })
    });
    await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: TEXTS.welcome, parse_mode: 'HTML', disable_web_page_preview: true });
  } else {
    await tg(TELEGRAM_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: TEXTS.again, parse_mode: 'HTML', disable_web_page_preview: true });
  }
  await sendPractice(TELEGRAM_BOT_TOKEN, chatId, vids[1], TEXTS.day[1]);
  return isNew;
}

// Ежедневная выдача зарядок 2 и 3 и дожима (дни 4–7) тем, у кого пришло время.
async function drip(env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN } = env;
  const H = sbHeaders(SUPABASE_SERVICE_KEY);
  // Порог — начало сегодняшнего дня по Москве (UTC+3). Выдаём следующий шаг тем,
  // чья прошлая активность была вчера или раньше — один шаг в день.
  const mskNow = new Date(Date.now() + 3 * 3600 * 1000);
  const thresholdMs = Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate()) - 3 * 3600 * 1000;
  const threshold = new Date(thresholdMs).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/free3_members?day_sent=lt.7&last_sent_at=lt.${encodeURIComponent(threshold)}&select=telegram_user_id,chat_id,day_sent&limit=1000`;
  let rows = [];
  try { const r = await fetch(url, { headers: H }); rows = await r.json(); } catch (e) { console.error('[free3] drip query', e && e.message); return { sent: 0, error: true }; }
  if (!Array.isArray(rows)) return { sent: 0 };
  const vids = await getVideos(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let sent = 0;
  // Кто сейчас в клубе (оплатил или на живом утре) — тому дожим не шлём.
  // Кто уже брал бесплатное утро — тому не предлагаем его повторно.
  let inClub = new Set();
  let hadTrial = new Set();
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/utro_members?select=telegram_user_id,active,trial_until&limit=5000`, { headers: H });
    const j = await r.json();
    if (Array.isArray(j)) j.forEach((x) => {
      if (x.active) inClub.add(String(x.telegram_user_id));
      if (x.trial_until) hadTrial.add(String(x.telegram_user_id));
    });
  } catch (e) {}
  const patch = (id, day) => fetch(`${SUPABASE_URL}/rest/v1/free3_members?telegram_user_id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ day_sent: day, last_sent_at: new Date().toISOString() })
  });
  const say = (chatId, text, markup) => tg(TELEGRAM_BOT_TOKEN, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {})
  });

  for (const m of rows) {
    const id = String(m.telegram_user_id);
    let next = m.day_sent + 1;
    if (next >= 4) {
      // Дожим: 4 — «как тело» + живое утро, 5 — клуб, 6 — пауза, 7 — последнее сообщение.
      if (inClub.has(id)) next = 7;
      else if (TEXTS.follow[next]) {
        sent++;
        if (next === 4) {
          await say(m.chat_id, TEXTS.follow[4], { keyboard: TEXTS.quickReplies, resize_keyboard: true, one_time_keyboard: true });
          if (!hadTrial.has(id)) await say(m.chat_id, TEXTS.liveNudge, { inline_keyboard: [[TEXTS.liveButton]] });
        } else {
          await say(m.chat_id, TEXTS.follow[next], { inline_keyboard: [[TEXTS.button]] });
        }
      }
      await patch(m.telegram_user_id, next);
      continue;
    }
    await sendPractice(TELEGRAM_BOT_TOKEN, m.chat_id, vids[next], TEXTS.day[next]);
    if (next === 3 && !inClub.has(id)) {
      // Брал бесплатное утро раньше — сразу предлагаем клуб, иначе — живое утро.
      if (hadTrial.has(id)) await say(m.chat_id, TEXTS.follow[5], { inline_keyboard: [[TEXTS.button]] });
      else await say(m.chat_id, TEXTS.liveInvite, { inline_keyboard: [[TEXTS.liveButton]] });
    }
    await patch(m.telegram_user_id, next);
    sent++;
  }
  return { sent };
}

module.exports = { TEXTS, tg, getVideos, sendPractice, enroll, drip };
