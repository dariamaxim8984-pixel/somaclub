// SOMA CLUB — отправка писем через Resend.
// Файл с префиксом "_" Netlify не публикует как отдельную функцию —
// это общий модуль, который подключают webhook, промокод и брошенная корзина.
//
// Переменная окружения: RESEND_API_KEY (секретный ключ Resend).

const FROM = 'SOMA CLUB <hello@somaclub.ru>';       // отправитель (домен подтверждён в Resend)
const REPLY_TO = 'maxim_nesterovich@mail.ru';        // куда придут ответы клиентов
const SITE = 'https://somaclub.ru';
const TG = 'https://t.me/Daria_its_me_vibe';
// username бота СОМА УТРО (без @).
const UTRO_BOT_USERNAME = 'soma_utro_bot';

// Базовая отправка. Возвращает {ok} или {skipped}. Письмо не критично,
// поэтому ошибки наружу не пробрасываем (оплата/доступ важнее).
async function sendEmail({ to, subject, html }) {
  const KEY = process.env.RESEND_API_KEY;
  console.log('[email] sendEmail to=%s keyPresent=%s', to, !!KEY);
  if (!KEY || !to) { console.log('[email] SKIP (нет ключа или получателя)'); return { skipped: true }; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html })
    });
    const bodyText = await r.text();
    if (!r.ok) { console.error('[email] Resend ERROR', r.status, bodyText); return { ok: false }; }
    console.log('[email] Resend OK', r.status, bodyText);
    return { ok: true };
  } catch (e) {
    console.error('[email] Resend EXCEPTION', e && e.message);
    return { ok: false };
  }
}

// Обёртка письма в единый стиль (сэйдж-палитра сайта).
function wrap(inner) {
  return `<!DOCTYPE html><html lang="ru"><body style="margin:0;background:#faf7f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2c2c2c;line-height:1.6">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:20px;font-weight:700;color:#7a9e7e;letter-spacing:1px;margin-bottom:24px">СОМА КЛУБ · SOMA CLUB</div>
    <div style="background:#fff;border:1px solid #e8e0d5;border-radius:16px;padding:28px 26px">${inner}</div>
    <div style="color:#8a8a8a;font-size:13px;text-align:center;margin-top:22px">
      SOMA CLUB · Нестерович Максим Валерьевич · ИНН 774311560630<br>
      <a href="${SITE}" style="color:#7a9e7e">somaclub.ru</a>
    </div>
  </div></body></html>`;
}

function btn(href, text) {
  return `<a href="${href}" style="display:inline-block;background:#7a9e7e;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600">${text}</a>`;
}

// Welcome — после успешной оплаты или активации промокода.
function welcomeHtml(tariff) {
  const guided = (tariff === 'guided' || tariff === 'potok2_guided')
    ? `<p style="margin:0 0 16px">Вы выбрали тариф <b>«С сопровождением»</b> — в ближайшее время мы свяжемся с вами по поводу обратной связи и видеосозвонов.</p>`
    : '';
  return wrap(`
    <h1 style="font-size:22px;margin:0 0 16px">Добро пожаловать в SOMA CLUB 🌿</h1>
    <p style="margin:0 0 16px">Спасибо за доверие! Ваш доступ к курсу открыт на <b>30 дней</b>.</p>
    <p style="margin:0 0 8px"><b>Как начать:</b></p>
    <p style="margin:0 0 16px">1. Зайдите на сайт и войдите в свой аккаунт.<br>
    2. Начните со вступительного урока.<br>
    3. После каждого занятия оставляйте короткий отклик — он открывает следующий урок.</p>
    ${guided}
    <p style="margin:0 0 24px">Занимайтесь в своём темпе — тело подскажет, когда двигаться дальше.</p>
    <p style="margin:0 0 24px">${btn(SITE, 'Перейти к курсу')}</p>
    <p style="margin:0;color:#6b6b6b;font-size:14px">Вопросы? Напишите нам в <a href="${TG}" style="color:#7a9e7e">Telegram-клуб</a> или ответьте на это письмо.<br><br>С теплом,<br>Дарья и Максим</p>
  `);
}

// Welcome для СОМА УТРО — доступ в закрытую Telegram-группу через бота.
// token — персональный tg_token заказа; по нему бот выдаёт одноразовую ссылку в группу.
function utroWelcomeHtml(token) {
  const botLink = token
    ? `https://t.me/${UTRO_BOT_USERNAME}?start=${token}`
    : `https://t.me/${UTRO_BOT_USERNAME}`;
  return wrap(`
    <h1 style="font-size:22px;margin:0 0 16px">Ты в СОМА УТРО 🌿</h1>
    <p style="margin:0 0 16px">Спасибо за доверие! Доступ открыт на <b>30 дней</b>.</p>
    <p style="margin:0 0 16px">Нажми кнопку — наш бот проверит оплату и пришлёт <b>личную ссылку</b> в закрытую группу. Там <b>5 дней в неделю в 7:00 по Москве</b> проходят онлайн-эфиры. Пропустила — остаётся запись.</p>
    <p style="margin:0 0 24px">${btn(botLink, 'Получить доступ в клуб')}</p>
    <p style="margin:0;color:#6b6b6b;font-size:14px">Если кнопка не открывается — вот ссылка: <a href="${botLink}" style="color:#7a9e7e">${botLink}</a><br><br>До встречи на эфире!<br>Дарья и Максим</p>
  `);
}

async function sendWelcome(to, tariff, token) {
  if (tariff === 'utro') {
    return sendEmail({ to, subject: 'Ты в СОМА УТРО 🌿 — ссылка на клуб', html: utroWelcomeHtml(token) });
  }
  return sendEmail({ to, subject: 'Добро пожаловать в SOMA CLUB 🌿', html: welcomeHtml(tariff) });
}

// Брошенная корзина — зарегался, но не оплатил (шлётся один раз).
function abandonedHtml(name) {
  const hi = name ? `${name}, ` : '';
  return wrap(`
    <h1 style="font-size:22px;margin:0 0 16px">Ваше тело ждёт вас 🌿</h1>
    <p style="margin:0 0 16px">${hi}вы завели аккаунт в SOMA CLUB, но ещё не открыли доступ к курсу.</p>
    <p style="margin:0 0 16px">8 занятий по 15–20 минут, чтобы снять хронические зажимы, вернуть энергию и спокойное дыхание. Заниматься можно дома и в своём темпе — без опыта и подготовки.</p>
    <p style="margin:0 0 24px">Стартовая цена ещё действует — самое время начать.</p>
    <p style="margin:0 0 24px">${btn(SITE, 'Открыть доступ')}</p>
    <p style="margin:0;color:#8a8a8a;font-size:13px">Это разовое напоминание — больше писем-напоминаний не будет. Чтобы отписаться, просто ответьте на это письмо словом «стоп».</p>
  `);
}

async function sendAbandoned(to, name) {
  return sendEmail({ to, subject: 'Вы почти в SOMA CLUB 🌿', html: abandonedHtml(name) });
}

module.exports = { sendEmail, sendWelcome, sendAbandoned, wrap, btn };
