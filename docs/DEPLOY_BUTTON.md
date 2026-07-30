# Production deploy двойным кликом

> Статус: OPERATIONAL DOCUMENT. Запускать только по отдельному разрешению после checklist и backup.

Файл `deploy-zabota-production.command` в корне проекта загружает текущую версию в GitHub, обновляет production-сервер, пересобирает Docker image, перезапускает контейнер и проверяет основные адреса приложения.

## Первый запуск

Откройте Терминал, перейдите в папку `web-service` и один раз выдайте файлу права на запуск:

```bash
chmod +x deploy-zabota-production.command
```

## Как запускать

1. Откройте папку `web-service` в Finder.
2. Дважды кликните `deploy-zabota-production.command`.
3. Дождитесь итоговых строк об успешной загрузке и проверке.
4. Нажмите Enter, чтобы закрыть окно Терминала.

Скрипт сам переходит в папку, где он находится, поэтому двойной клик в Finder безопасен.

## Что нужно для работы

- На Mac должен быть настроен доступ к GitHub-репозиторию `kutuich/zabota-ryadom-web-service` для `git push`.
- На Mac должен быть настроен SSH-доступ к `root@104.171.139.243`.
- На production-сервере должны работать Git, Docker и curl.
- Файл `/opt/zabota/repo/.env.production` хранится только на production-сервере. Он не загружается в GitHub.

## Безопасность

Перед `git add` скрипт проверяет `git status` и останавливается, если в нем видны env-файлы, базы данных, `node_modules`, `dist`, `uploads`, `data` или `backups`. Пароли, токены, `JWT_SECRET` и другие секреты нельзя добавлять в репозиторий.
