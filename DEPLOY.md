# Переезд SOMA CLUB на российский хостинг

Цель: сайт стабильно открывается в РФ. Уходим от Cloudflare и Netlify.
База (Supabase), почта (Resend), оплата (Тинькофф), Telegram — остаются как есть,
меняется только то, ГДЕ лежит сайт и функции.

Что уже готово в этой папке:
- server.js       — автономный сервер (статика + все функции по тем же адресам /.netlify/functions/<name>)
- package.json    — запуск `node server.js` (Node 18+; зависимостей нет)
- Caddyfile       — авто-HTTPS (Let's Encrypt) + проксирование на сервер
- .env.example    — список переменных (значения возьмём из Netlify)
- netlify/functions/* — код функций (не меняли)

--------------------------------------------------------------------
ШАГ 1. Сервер
Вариант А (проще в обслуживании) — российский PaaS: Timeweb Cloud «Приложения»
или Amvera: загрузить эту папку, тип приложения Node.js, старт-команда `node server.js`,
домен somaclub.ru, HTTPS включить в панели. Тогда шаги про Caddy/systemd не нужны.

Вариант Б — обычный VPS (Timeweb/Selectel), Ubuntu 22/24, 1 vCPU/1 ГБ хватит.
--------------------------------------------------------------------

ШАГ 2 (для варианта Б). Установка на VPS
  # Node 20
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  # Caddy (авто-TLS)
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update && sudo apt-get install -y caddy

ШАГ 3. Заливаем папку и настраиваем секреты
  # с локальной машины:
  scp -r soma_site_fix root@IP_СЕРВЕРА:/opt/soma
  # на сервере:
  cd /opt/soma
  cp .env.example .env && nano .env      # вписать значения (см. ШАГ 4)

ШАГ 4. Значения переменных — берём из Netlify
  Netlify → project somaclub → Site configuration → Environment variables.
  Для каждой переменной нажать «показать значение» и перенести в .env:
  TINKOFF_TERMINAL_KEY, TINKOFF_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY,
  RESEND_API_KEY, TELEGRAM_BOT_TOKEN, UTRO_CHAT_ID, TG_WEBHOOK_SECRET,
  BOT_TOKEN, CHAT_ID, SITE_URL=https://somaclub.ru

ШАГ 5. Автозапуск сервера (systemd)
  sudo tee /etc/systemd/system/soma.service >/dev/null <<UNIT
  [Unit]
  Description=SOMA CLUB server
  After=network.target
  [Service]
  WorkingDirectory=/opt/soma
  ExecStart=/usr/bin/node server.js
  Restart=always
  Environment=PORT=8080
  [Install]
  WantedBy=multi-user.target
  UNIT
  sudo systemctl daemon-reload && sudo systemctl enable --now soma

ШАГ 6. Caddy (домен → сервер, авто-сертификат)
  sudo cp Caddyfile /etc/caddy/Caddyfile
  sudo systemctl restart caddy
  (перед этим домен должен указывать на IP сервера — см. ШАГ 7)

ШАГ 7. DNS — направляем домен на новый сервер
  В Cloudflare (или где будут NS) сделать A-записи somaclub.ru и www → IP сервера,
  режим «DNS only» (серое облако), TTL минимальный. Cloudflare-прокси НЕ включать.

ШАГ 8. Вебхуки (адрес не меняется, т.к. домен и пути те же)
  - Telegram (бот СОМА УТРО): переустановить вебхук на новый сервер:
    curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://somaclub.ru/.netlify/functions/telegram-bot&secret_token=<TG_WEBHOOK_SECRET>"
  - Тинькофф: NotificationURL в кабинете эквайринга должен быть
    https://somaclub.ru/.netlify/functions/payment-webhook (уже такой — менять не нужно).

ШАГ 9. Проверка
  - https://somaclub.ru открывается (в т.ч. из РФ, у Даши).
  - Логин/регистрация, покупка тест-тарифа, письмо, доступ в бота.

--------------------------------------------------------------------
ЕЩЁ ДЛЯ «НАВЕРНЯКА» (второй слой, сделаем отдельно):
Фронт грузит библиотеку Supabase с cdn.jsdelivr.net и ходит в Supabase API напрямую.
Чтобы и это не зависело от зарубежных сетей — положим библиотеку локально и
проксируем Supabase через наш домен. Скажи — подготовлю патч фронта и прокси.
