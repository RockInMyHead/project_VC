# База данных «Бок о бок»

Локальный MVP использует SQLite в WAL-режиме. Схема нормализована и не хранит вычисляемые рейтинги проектов.

## Запуск

```bash
python3 backend/db.py
python3 backend/server.py
```

База создаётся в `data/bokobok.db`. Путь можно изменить переменной `BOKOBOK_DB_PATH`.

## Модель

- `users`, `roles`, `registration_requests`: пользователи и четыре роли из ТЗ.
- `projects`, `project_members`: карточки и команды проектов.
- `tree_versions`, `stages`, `evidence`: версионное дерево прогресса, варианты выбора и доказательства. Файлы лежат в `data/uploads/` рядом с базой.
- `project_questions`, `question_replies`: вопросы инвесторов и ответы фонда.
- `notifications`: внутренние продуктовые уведомления.
- `auth_sessions`, `otp_challenges`: сессии и SMS-2FA.
- `audit_log`: входы, просмотры, публикации и административные действия.

Удаление проекта каскадно удаляет его версии, этапы и вопросы. Пользователи не удаляются вместе с проектом. Опубликованные версии дерева неизменяемы на уровне приложения: правки создают новую версию.

## API MVP

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/{public_id|slug}`
- `POST /api/auth/login`
- `POST /api/auth/verify-otp`
- `POST /api/registration-requests`
- `POST /api/projects/{public_id|slug}/questions`

Начальная база содержит только справочник ролей. Первого администратора создают явной командой `python3 backend/create_admin.py`; фиктивные пользователи и проекты не добавляются.

## Безопасность

Пароли хэшируются PBKDF2-SHA256 с индивидуальной солью и 310 000 итераций. Токены сессий и коды 2FA хранятся только как SHA-256 хэши. Сервер проверяет роль для изменяющих запросов. Все значимые действия записываются в `audit_log`.
