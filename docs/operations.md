# Эксплуатация

## Локальный запуск

```sh
python3 -B backend/server.py 5188
```

По умолчанию БД `data/bokobok.db`, адрес `127.0.0.1`. Миграции применяются при запуске. Данные пользователей и проектов автоматически не создаются.

Первый администратор создаётся вручную; пароль вводится скрыто:

```sh
python3 backend/create_admin.py --name 'Имя Фамилия' --email admin@example.ru --phone +79991234567
```

Администратор входит через обычную форму с SMS-2FA, после входа открывается `/admin.html`. Создание инвесторов/сотрудников и одобрение заявок основателей доступны в админке. Пароль новому пользователю администратор передаёт по согласованному защищённому каналу; автоматических почтовых приглашений нет.

## Переменные окружения

| Переменная | Значение |
| --- | --- |
| BOKOBOK_HOST | 127.0.0.1 локально; 0.0.0.0 в контейнере |
| BOKOBOK_DB_PATH | Путь к SQLite; /data/bokobok.db в контейнере |
| BOKOBOK_TRUST_PROXY | 1 только когда приложение доступно исключительно из внутренней сети Caddy; доверять X-Real-IP от частного адреса прокси |
| SMS_RU_API_ID | Ключ SMS.RU; передаётся контейнеру из .env |
| BOKOBOK_DISABLE_SMS_2FA | 1 временно разрешает вход по паролю без SMS; по умолчанию 0 на сервере. На публичном HTTP пароли передаются без шифрования — настройте HTTPS. |
| BOKOBOK_LOG_OTP | 1 только локально с host 127.0.0.1; код в серверном логе, не для production |
| DOMAIN | Домен Caddy для HTTPS |

SMS-адаптер использует [официальный метод SMS.RU](https://sms.ru/api/send). `.env` не коммитится. Сервис сам не читает .env при локальном запуске: используйте переменные окружения; Docker Compose подставляет .env. При отсутствии ключа SMS вход корректно сообщает об отсутствии настройки, а не имитирует доставку.

Конфигурация Caddy перезаписывает `X-Real-IP` адресом своего непосредственного клиента. Для инсталляции с дополнительным внешним прокси требуется отдельно настроить его доверенную цепочку; не публикуйте порт приложения напрямую при `BOKOBOK_TRUST_PROXY=1`.

## Резервные копии

`deploy/backup.sh` делает консистентную копию через SQLite Backup API, проверяет `PRAGMA integrity_check`, затем публикует файл резервной копии и сохраняет 14 дней. При ошибке копирования или проверки повреждённый файл не получает окончательное имя и старые копии не удаляются. Фото профилей входят в копию БД, а материалы проектов — в отдельный архив загрузок. Установите systemd units из deploy на сервер с проектом `/opt/bokobok`:

```sh
sudo cp deploy/bokobok-backup.service deploy/bokobok-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bokobok-backup.timer
sudo systemctl start bokobok-backup.service
systemctl list-timers bokobok-backup.timer
journalctl -u bokobok-backup.service
```

Таймер запускается ежедневно, Persistent=true догоняет пропущенный запуск после остановки ВМ. Установка таймера в этом задании не выполнялась: сервера Cloud.ru в текущей среде нет. Копии необходимо дополнительно переносить за пределы этой ВМ с помощью вашего хранилища и его ключей.

## Восстановление

Сначала создайте текущую копию, выберите нужную дату и остановите приложение. Не подменяйте БД на ходу:

```sh
cd /opt/bokobok
./deploy/backup.sh
docker compose stop app
docker compose run --rm --no-deps -v /opt/bokobok/backups:/restore:ro app python -c "import sqlite3; src=sqlite3.connect('file:/restore/bokobok-YYYYMMDDTHHMMSSZ.db?mode=ro',uri=True); assert src.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; dst=sqlite3.connect('/data/bokobok.db'); src.backup(dst); dst.close(); src.close()"
docker compose up -d app
curl -fsS https://YOUR_DOMAIN/api/health
```

Подставьте существующее имя файла. После восстановления проверьте вход, список проектов, дерево и скачивание материала. При откате версии приложения используйте совместимую резервную копию БД; обратных автоматических миграций нет.

## Проверки

```sh
python3 -B -m unittest discover -s tests -v
node --check app.js
node --check focus.js
node --check workflow-ui.js
node --check admin.js
```

Тесты используют временные базы и не меняют рабочие данные. Перед production дополнительно нужны проверка доставки SMS на реальный номер, восстановление на отдельном окружении и нагрузочная проверка p95 на выделенном сервере.
