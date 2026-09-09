// SOMA CLUB — серверная отправка отклика в Telegram.
// Токен и chat_id берутся из переменных окружения Netlify.
//   BOT_TOKEN, CHAT_ID
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
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
