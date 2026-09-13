// SOMA CLUB — серверная отправка отклика в Telegram.
// Токен и chat_id берутся из переменных окружения:
//   BOT_TOKEN, CHAT_ID
//
// Важно: российский хостинг (Timeweb) не может достучаться до api.telegram.org.
// Поэтому если функция выполняется НЕ на Netlify — она пересылает запрос на
// Netlify-копию (somaclub.netlify.app), а та уже отправляет сообщение в Telegram.
// Заголовок x-soma-forward защищает от зацикливания.
const FORWARD_URL = 'https://somaclub.netlify.app/.netlify/functions/notify';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = event.headers || {};
  const alreadyForwarded = (headers['x-soma-forward'] || headers['X-Soma-Forward']) === '1';
  const onNetlify = !!process.env.NETLIFY;

  // Не на Netlify и запрос ещё не переслан — пересылаем на Netlify.
  if (!onNetlify && !alreadyForwarded) {
    try {
      const resp = await fetch(FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-soma-forward': '1' },
        body: event.body || '{}'
      });
      return { statusCode: resp.ok ? 200 : 502, body: resp.ok ? JSON.stringify({ ok: true }) : 'Forward failed' };
    } catch (e) {
      return { statusCode: 502, body: 'Forward error' };
    }
  }

  // На Netlify (или это уже пересланный запрос) — шлём напрямую в Telegram.
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) {
    return { statusCode: 500, body: 'Not configured' };
  }
  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch (e) { data = {}; }
  const text = String(data.text || '').slice(0, 3500);
  if (!text) { return { statusCode: 400, body: 'No text' }; }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text })
    });
    if (!resp.ok) { return { statusCode: 502, body: 'Telegram error' }; }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 502, body: 'Send failed' };
  }
};
