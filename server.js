// SOMA CLUB — автономный сервер для российского хостинга (замена Netlify).
// Отдаёт статику сайта и те же функции по тем же адресам /.netlify/functions/<name>.
// Плюс «второй слой» для РФ:
//   - /vendor/supabase.min.js — библиотека Supabase со своего домена (не jsDelivr);
//   - /sb/*  — прокси к Supabase, чтобы браузер не ходил на *.supabase.co напрямую.
// Зависимостей нет — только встроенные модули Node 18+. Запуск: node server.js
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Мини-загрузчик .env (без сторонних пакетов).
(function loadEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
})();

const ROOT = __dirname;
const FN_DIR = path.join(ROOT, 'netlify', 'functions');
const PORT = process.env.PORT || 8080;

const HANDLERS = {};
for (const n of ['create-payment', 'payment-webhook', 'telegram-bot', 'redeem-promo', 'notify', 'utro-expire', 'abandoned-cart']) {
  try { HANDLERS[n] = require(path.join(FN_DIR, n + '.js')).handler; }
  catch (e) { console.error('[load] не удалось загрузить', n, e && e.message); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b)); });

function serveFile(file, res) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// --- Прокси к Supabase: /sb/<путь> -> ${SUPABASE_URL}/<путь> (стримом, без чтения тела) ---
function proxySupabase(req, res, rest, search) {
  const base = process.env.SUPABASE_URL;
  if (!base) { res.writeHead(500); return res.end('SUPABASE_URL not set'); }
  const target = new URL(base);
  const headers = { ...req.headers, host: target.hostname };
  delete headers['accept-encoding']; // пусть придёт без сжатия — проще и надёжнее
  const preq = https.request({
    hostname: target.hostname, port: 443,
    path: '/' + rest + (search || ''),
    method: req.method, headers
  }, (pres) => {
    res.writeHead(pres.statusCode || 502, pres.headers);
    pres.pipe(res);
  });
  preq.setTimeout(20000, () => preq.destroy(new Error('timeout')));
  preq.on('error', (e) => { console.error('[sb proxy]', e && e.message); if (!res.headersSent) res.writeHead(502); res.end('proxy error'); });
  req.pipe(preq);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(u.pathname);

  // Прокси Supabase — ДО чтения тела (стрим).
  if (pathname === '/sb' || pathname.startsWith('/sb/')) {
    const rest = pathname.replace(/^\/sb\/?/, '');
    return proxySupabase(req, res, rest, u.search);
  }

  // Функции: /.netlify/functions/<name>  и  /api/<name>
  const m = pathname.match(/^\/(?:\.netlify\/functions|api)\/([a-z0-9-]+)\/?$/i);
  if (m) {
    const h = HANDLERS[m[1]];
    if (!h) { res.writeHead(404); return res.end('No such function'); }
    const body = await readBody(req);
    const event = { httpMethod: req.method, headers: req.headers, body, queryStringParameters: Object.fromEntries(u.searchParams) };
    try {
      const r = await h(event, {});
      res.writeHead((r && r.statusCode) || 200, (r && r.headers) || {});
      return res.end((r && r.body) || '');
    } catch (e) { console.error('[fn]', m[1], e && e.message); res.writeHead(500); return res.end('Function error'); }
  }

  // Статика (только GET/HEAD).
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || rel.startsWith('/netlify') || rel.startsWith('/.')) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return serveFile(file, res);
    fs.stat(file + '.html', (e2, s2) => {
      if (!e2 && s2.isFile()) return serveFile(file + '.html', res);
      res.writeHead(404); res.end('Not found');
    });
  });
});

// --- Кладём библиотеку Supabase локально (один раз, при старте) ---
function download(url, redirects) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, { headers: { 'User-Agent': 'soma-server' } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && (redirects || 0) < 5) {
        resp.resume(); return resolve(download(resp.headers.location, (redirects || 0) + 1));
      }
      if (resp.statusCode !== 200) { resp.resume(); return reject(new Error('HTTP ' + resp.statusCode)); }
      const chunks = []; resp.on('data', (c) => chunks.push(c)); resp.on('end', () => resolve(Buffer.concat(chunks)));
    });
    r.setTimeout(15000, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
  });
}
async function vendorEnsure() {
  const dir = path.join(ROOT, 'vendor');
  const file = path.join(dir, 'supabase.min.js');
  try { if (fs.existsSync(file) && fs.statSync(file).size > 1000) return; } catch (e) {}
  const mirrors = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js'
  ];
  for (const url of mirrors) {
    try {
      const buf = await download(url);
      if (buf && buf.length > 1000) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf); console.log('[vendor] supabase.min.js сохранён,', buf.length, 'байт'); return; }
    } catch (e) { console.error('[vendor] не вышло с', url, '-', e && e.message); }
  }
  console.error('[vendor] не удалось скачать supabase.min.js — положи файл вручную в vendor/supabase.min.js');
}

// Ежедневные крон-задачи (в UTC, как в netlify.toml).
function scheduleDailyUTC(hh, mm, fn, label) {
  const plan = () => {
    const now = new Date();
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0, 0));
    if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
    setTimeout(async () => { try { console.log('[cron] запуск', label); await fn({}, {}); } catch (e) { console.error('[cron]', label, e && e.message); } plan(); }, t - now);
    console.log('[cron]', label, '-> через', Math.round((t - now) / 60000), 'мин');
  };
  plan();
}

// --- Telegram polling ---
// На РФ-хостинге серверы Telegram не достукиваются до российского IP по вебхуку
// ("Connection timed out"), поэтому опрашиваем Telegram сами исходящими запросами
// (getUpdates). Бизнес-логику берём из того же telegram-bot.js — просто вызываем его
// обработчик с сформированным event и корректным секретным заголовком.
async function tgApi(method, params) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {})
  });
  return r.json();
}
async function startTelegramPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const handler = HANDLERS['telegram-bot'];
  const secret = process.env.TG_WEBHOOK_SECRET;
  if (!token || !handler) { console.error('[poll] отключён: нет TELEGRAM_BOT_TOKEN или обработчика'); return; }
  // Снимаем вебхук — иначе getUpdates отдаёт 409 Conflict. Накопленные апдейты сохраняем.
  try { await tgApi('deleteWebhook', { drop_pending_updates: false }); console.log('[poll] вебхук снят, включаю getUpdates'); }
  catch (e) { console.error('[poll] deleteWebhook error', e && e.message); }
  let offset = 0;
  const loop = async () => {
    try {
      const res = await tgApi('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'edited_message'] });
      if (res && res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          offset = upd.update_id + 1;
          try {
            await handler({
              httpMethod: 'POST',
              headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
              body: JSON.stringify(upd),
              queryStringParameters: {}
            }, {});
          } catch (e) { console.error('[poll] handler error', e && e.message); }
        }
      } else if (res && res.ok === false) {
        console.error('[poll] getUpdates ответил', res.error_code, res.description);
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e) { console.error('[poll] getUpdates error', e && e.message); await new Promise((r) => setTimeout(r, 3000)); }
    setImmediate(loop);
  };
  console.log('[poll] Telegram polling запущен');
  loop();
}

vendorEnsure().finally(() => {
  if (HANDLERS['utro-expire']) scheduleDailyUTC(6, 0, HANDLERS['utro-expire'], 'utro-expire');
  if (HANDLERS['abandoned-cart']) scheduleDailyUTC(9, 0, HANDLERS['abandoned-cart'], 'abandoned-cart');
  server.listen(PORT, () => console.log('SOMA server слушает :' + PORT));
  startTelegramPolling();
});
