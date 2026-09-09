// SOMA CLUB — создание платежа в Тинькофф (метод Init).
// Вызывается с сайта, когда залогиненный пользователь жмёт «Оформить».
// Возвращает PaymentURL — ссылку на страницу оплаты банка.
//
// Переменные окружения (Netlify → Site configuration → Environment variables):
//   TINKOFF_TERMINAL_KEY  — TerminalKey из кабинета эквайринга
//   TINKOFF_PASSWORD      — пароль терминала
//   SUPABASE_URL          — https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY  — service_role ключ (секретный!)
//
// TLS: запрос к банку идёт через агент, доверяющий и публичным CA (GlobalSign),
// и сертификатам Минцифры (Russian Trusted Root/Sub CA) — чтобы при переходе
// банка на сертификаты Минцифры оплата не сломалась.

const crypto = require('crypto');
const https = require('https');
const tls = require('tls');

// Сертификаты Минцифры (корневой + промежуточный).
const RU_TRUSTED_CA = `-----BEGIN CERTIFICATE-----
MIIHQjCCBSqgAwIBAgICEAIwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAyMTEyNTE5WhcNMjcwMzA2MTEyNTE5WjBvMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMR8wHQYDVQQDDBZSdXNzaWFuIFRydXN0ZWQgU3Vi
IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9YPqBKOk19NFymrE
wehzrhBEgT2atLezpduB24mQ7CiOa/HVpFCDRZzdxqlh8drku408/tTmWzlNH/br
HuQhZ/miWKOf35lpKzjyBd6TPM23uAfJvEOQ2/dnKGGJbsUo1/udKSvxQwVHpVv3
S80OlluKfhWPDEXQpgyFqIzPoxIQTLZ0deirZwMVHarZ5u8HqHetRuAtmO2ZDGQn
vVOJYAjls+Hiueq7Lj7Oce7CQsTwVZeP+XQx28PAaEZ3y6sQEt6rL06ddpSdoTMp
BnCqTbxW+eWMyjkIn6t9GBtUV45yB1EkHNnj2Ex4GwCiN9T84QQjKSr+8f0psGrZ
vPbCbQAwNFJjisLixnjlGPLKa5vOmNwIh/LAyUW5DjpkCx004LPDuqPpFsKXNKpa
L2Dm6uc0x4Jo5m+gUTVORB6hOSzWnWDj2GWfomLzzyjG81DRGFBpco/O93zecsIN
3SL2Ysjpq1zdoS01CMYxie//9zWvYwzI25/OZigtnpCIrcd2j1Y6dMUFQAzAtHE+
qsXflSL8HIS+IJEFIQobLlYhHkoE3avgNx5jlu+OLYe0dF0Ykx1PGNjbwqvTX37R
Cn32NMjlotW2QcGEZhDKj+3urZizp5xdTPZitA+aEjZM/Ni71VOdiOP0igbw6asZ
2fxdozZ1TnSSYNYvNATwthNmZysCAwEAAaOCAeUwggHhMBIGA1UdEwEB/wQIMAYB
Af8CAQAwDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBTR4XENCy2BTm6KSo9MI7NM
XqtpCzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzCBxwYIKwYBBQUH
AQEEgbowgbcwOwYIKwYBBQUHMAKGL2h0dHA6Ly9yb3N0ZWxlY29tLnJ1L2NkcC9y
b290Y2Ffc3NsX3JzYTIwMjIuY3J0MDsGCCsGAQUFBzAChi9odHRwOi8vY29tcGFu
eS5ydC5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNydDA7BggrBgEFBQcwAoYv
aHR0cDovL3JlZXN0ci1wa2kucnUvY2RwL3Jvb3RjYV9zc2xfcnNhMjAyMi5jcnQw
gbAGA1UdHwSBqDCBpTA1oDOgMYYvaHR0cDovL3Jvc3RlbGVjb20ucnUvY2RwL3Jv
b3RjYV9zc2xfcnNhMjAyMi5jcmwwNaAzoDGGL2h0dHA6Ly9jb21wYW55LnJ0LnJ1
L2NkcC9yb290Y2Ffc3NsX3JzYTIwMjIuY3JsMDWgM6Axhi9odHRwOi8vcmVlc3Ry
LXBraS5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNybDANBgkqhkiG9w0BAQsF
AAOCAgEARBVzZls79AdiSCpar15dA5Hr/rrT4WbrOfzlpI+xrLeRPrUG6eUWIW4v
Sui1yx3iqGLCjPcKb+HOTwoRMbI6ytP/ndp3TlYua2advYBEhSvjs+4vDZNwXr/D
anbwIWdurZmViQRBDFebpkvnIvru/RpWud/5r624Wp8voZMRtj/cm6aI9LtvBfT9
cfzhOaexI/99c14dyiuk1+6QhdwKaCRTc1mdfNQmnfWNRbfWhWBlK3h4GGE9JK33
Gk8ZS8DMrkdAh0xby4xAQ/mSWAfWrBmfzlOqGyoB1U47WTOeqNbWkkoAP2ys94+s
Jg4NTkiDVtXRF6nr6fYi0bSOvOFg0IQrMXO2Y8gyg9ARdPJwKtvWX8VPADCYMiWH
h4n8bZokIrImVKLDQKHY4jCsND2HHdJfnrdL2YJw1qFskNO4cSNmZydw0Wkgjv9k
F+KxqrDKlB8MZu2Hclph6v/CZ0fQ9YuE8/lsHZ0Qc2HyiSMnvjgK5fDc3TD4fa8F
E8gMNurM+kV8PT8LNIM+4Zs+LKEV8nqRWBaxkIVJGekkVKO8xDBOG/aN62AZKHOe
GcyIdu7yNMMRihGVZCYr8rYiJoKiOzDqOkPkLOPdhtVlgnhowzHDxMHND/E2WA5p
ZHuNM/m0TXt2wTTPL7JH2YC0gPz/BvvSzjksgzU5rLbRyUKQkgU=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----`;

// Агент для запросов к Тинькофф: публичные CA + Минцифры.
const tinkoffAgent = new https.Agent({ ca: [...tls.rootCertificates, RU_TRUSTED_CA] });

// POST JSON через https с заданным агентом. Возвращает { status, json }.
function httpsPostJson(urlStr, payload, agent) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      agent
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, json: null, raw: body }); }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// Цены задаются ТОЛЬКО на сервере (в копейках), чтобы их нельзя было подменить.
const TARIFFS = {
  solo:          { amount: 180000,  title: 'SOMA CLUB — Поток 1, тариф «Самостоятельно» (30 дней)' },
  guided:        { amount: 1000000, title: 'SOMA CLUB — Поток 1, тариф «С сопровождением» (30 дней)' },
  potok2_solo:   { amount: 180000,  title: 'SOMA CLUB — Поток 2, тариф «Самостоятельно» (30 дней)' },
  potok2_guided: { amount: 1000000, title: 'SOMA CLUB — Поток 2, тариф «С сопровождением» (30 дней)' },
  utro:          { amount: 149000,  title: 'СОМА УТРО — доступ в клуб (30 дней)' }
};

// Куда банк вернёт пользователя после оплаты (для СОМА УТРО — на страницу утра).
const SITE_URL = 'https://somaclub.ru';

// Подпись запроса Тинькофф: корневые поля + Password, сортировка по ключу, склейка значений, SHA-256.
function makeToken(params, password) {
  const data = { ...params, Password: password };
  const sorted = Object.keys(data).sort().map((k) => data[k]).join('');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const {
    TINKOFF_TERMINAL_KEY, TINKOFF_PASSWORD,
    SUPABASE_URL, SUPABASE_SERVICE_KEY
  } = process.env;

  if (!TINKOFF_TERMINAL_KEY || !TINKOFF_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: 'Not configured' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}

  const tariff = body.tariff;
  const userToken = body.accessToken;
  if (!TARIFFS[tariff]) return { statusCode: 400, body: 'Bad tariff' };
  if (!userToken)       return { statusCode: 401, body: 'Not logged in' };

  // 1) Кто платит — проверяем JWT через Supabase Auth.
  let user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: SUPABASE_SERVICE_KEY }
    });
    if (!r.ok) return { statusCode: 401, body: 'Auth failed' };
    user = await r.json();
  } catch (e) {
    return { statusCode: 401, body: 'Auth error' };
  }
  if (!user || !user.id) return { statusCode: 401, body: 'No user' };

  const { amount, title } = TARIFFS[tariff];
  const orderId = `${tariff}-${user.id.slice(0, 8)}-${Date.now()}`;
  // Персональный токен для диплинка в Telegram-бота (СОМА УТРО).
  const tgToken = crypto.randomBytes(24).toString('hex');

  // 2) Создаём заказ в базе (status = new) через service role.
  try {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        order_id: orderId, user_id: user.id, email: user.email,
        tariff, amount, status: 'new', tg_token: tgToken
      })
    });
    if (!ins.ok) {
      const t = await ins.text();
      return { statusCode: 500, body: 'DB insert failed: ' + t };
    }
  } catch (e) {
    return { statusCode: 500, body: 'DB error' };
  }

  // 3) Создаём платёж в Тинькофф (Init) — через агент с доверием к Минцифры.
  const initParams = {
    TerminalKey: TINKOFF_TERMINAL_KEY,
    Amount: amount,
    OrderId: orderId,
    Description: title
  };
  // Возврат после оплаты. Для СОМА УТРО кладём токен в SuccessURL — страница «спасибо»
  // построит из него персональную ссылку на бота.
  if (tariff === 'utro') {
    initParams.SuccessURL = `${SITE_URL}/utro.html?paid=1&t=${tgToken}`;
    initParams.FailURL    = `${SITE_URL}/utro.html?paid=0`;
  }
  const Token = makeToken(initParams, TINKOFF_PASSWORD);
  const initBody = { ...initParams, Token, DATA: { Email: user.email || '' } };

  try {
    const resp = await httpsPostJson('https://securepay.tinkoff.ru/v2/Init', initBody, tinkoffAgent);
    const data = resp.json;
    if (!data || !data.Success || !data.PaymentURL) {
      console.error('Tinkoff Init failed:', resp.status, resp.raw || JSON.stringify(data));
      return { statusCode: 502, body: 'Tinkoff: ' + ((data && (data.Message || data.Details || data.ErrorCode)) || 'error') };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentUrl: data.PaymentURL })
    };
  } catch (e) {
    console.error('Tinkoff Init exception:', e && e.message);
    return { statusCode: 502, body: 'Init failed' };
  }
};
