# Деплой «Бок о бок» на Cloud.ru

## 1. Подготовьте виртуальную машину

Рекомендуемая конфигурация по ТЗ: Ubuntu 24.04 LTS, 8 vCPU, 8 GB RAM, SSD 120 GB. Назначьте ВМ публичный IPv4 и добавьте SSH-ключ.

В группе безопасности разрешите входящий TCP-трафик:

- 22 только с вашего IP;
- 80 от `0.0.0.0/0`;
- 443 от `0.0.0.0/0`.

Порт 5188 открывать наружу не нужно.

## 2. Подключитесь по SSH

```bash
ssh user1@176.108.247.214
```

## 3. Установите Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Выйдите из SSH и подключитесь снова, чтобы применить группу `docker`.

## 4. Передайте проект

Вариант через Git:

```bash
sudo mkdir -p /opt/bokobok
sudo chown "$USER":"$USER" /opt/bokobok
git clone YOUR_REPOSITORY_URL /opt/bokobok
cd /opt/bokobok
```

Без Git передайте подготовленный архив с компьютера, где находится проект (при выключенном VPN, если он мешает SSH):

```bash
scp /Users/artem/Documents/ChatGPT/design_by/bokobok-deploy-2026-09-25-v2.tar.gz user1@176.108.247.214:~/
```

Затем на ВМ:

```bash
sudo mkdir -p /opt/bokobok
sudo chown user1:user1 /opt/bokobok
tar -xzf ~/bokobok-deploy-2026-09-25-v2.tar.gz -C /opt/bokobok
cd /opt/bokobok
```

## 5. Подключите домен

Создайте A-запись домена со значением публичного IP сервера. Затем:

```bash
cd /opt/bokobok
cp .env.example .env
nano .env
```

Укажите реальный домен:

```dotenv
DOMAIN=bokobok.ru
```

Также укажите `SMS_RU_API_ID` для входа по SMS. После обновления DNS Caddy автоматически выпустит TLS-сертификат.

## 6. Запустите сервис

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
curl -fsS https://bokobok.ru/api/health
```

Если домена пока нет, `DOMAIN=:80` допустим только для проверки `/api/health`. Не вводите пароли по публичному HTTP.

## 7. Настройте ежедневный бэкап

Включите [systemd-таймер](../docs/operations.md#резервные-копии), затем выполните пробное восстановление на отдельной базе.

Для production копируйте архивы на отдельный объектный storage Cloud.ru. Локальный бэкап на той же ВМ не защищает от потери диска.

## 8. Обновление

```bash
cd /opt/bokobok
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Перед обновлением базы запустите `deploy/backup.sh`. Скрипт сохраняет базу и отдельный архив папки с загруженными материалами; для восстановления нужны оба файла.

## Проверка

```bash
docker compose exec app python -m unittest -v tests.test_database
docker compose exec app python -c "import sqlite3; db=sqlite3.connect('/data/bokobok.db'); print(db.execute('PRAGMA integrity_check').fetchone()[0])"
```
