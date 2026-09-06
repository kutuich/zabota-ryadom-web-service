#!/bin/bash

# Controlled production deploy button for macOS.
# Current topology: GitHub main -> /opt/zabota/repo -> Compose project zabota-production
# -> PostgreSQL 16 + backend on 127.0.0.1:4100 -> Caddy.
# The script never resets passwords and never touches finance_bot.
# Compatible with the Bash version shipped with macOS.

set -u

cd "$(dirname "$0")" || exit 1

EXPECTED_ORIGIN="https://github.com/kutuich/zabota-ryadom-web-service.git"
PRODUCTION_HOST="${PRODUCTION_HOST:-root@104.171.139.243}"
PRODUCTION_PATH="${PRODUCTION_PATH:-/opt/zabota/repo}"
PRODUCTION_DOMAIN="${PRODUCTION_DOMAIN:-zabota-ugorsk.ru}"

STATUS_FILE="$(mktemp -t zabota-git-status.XXXXXX)"
SSH_LOG_FILE="$(mktemp -t zabota-deploy-ssh.XXXXXX)"

cleanup() {
  rm -f "$STATUS_FILE" "$SSH_LOG_FILE"
}
trap cleanup EXIT INT TERM

pause_and_exit() {
  local exit_code="$1"
  if [ -t 0 ]; then
    read -r -p "Нажмите Enter для закрытия..."
  fi
  exit "$exit_code"
}

fail() {
  local stage="$1"
  local reason="$2"
  echo
  echo "Ошибка: $stage"
  echo "Техническая причина: $reason"
  pause_and_exit 1
}

is_dangerous_path() {
  local path="$1"
  local base_name

  path="${path#\"}"
  path="${path%\"}"
  path="${path#./}"
  base_name="${path##*/}"

  case "$base_name" in
    .env|.env.local|.env.production|*.db|*.sqlite|*.sqlite3)
      return 0
      ;;
  esac

  case "/$path/" in
    */node_modules/*|*/dist/*|*/uploads/*|*/data/*|*/backups/*|*/.local-data/*)
      return 0
      ;;
  esac

  return 1
}

echo "Этап 1 из 4. Локальная preflight-проверка release"

command -v git >/dev/null 2>&1 || fail "preflight не выполнен" "git не найден"
command -v npm >/dev/null 2>&1 || fail "preflight не выполнен" "npm не найден"
command -v ssh >/dev/null 2>&1 || fail "preflight не выполнен" "ssh не найден"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "preflight не выполнен" "папка со скриптом не является git-репозиторием"
fi

ACTUAL_ORIGIN="$(git remote get-url origin 2>/dev/null)" || \
  fail "preflight не выполнен" "в git-репозитории не найден remote origin"

if [ "$ACTUAL_ORIGIN" != "$EXPECTED_ORIGIN" ]; then
  fail "preflight не выполнен" "origin указывает на $ACTUAL_ORIGIN, а ожидается $EXPECTED_ORIGIN"
fi

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  fail "preflight не выполнен" "текущая ветка — $CURRENT_BRANCH; production deploy разрешён только из main"
fi

if ! git -c core.quotePath=false status --short --untracked-files=all >"$STATUS_FILE"; then
  fail "preflight не выполнен" "не удалось прочитать git status"
fi

if [ -s "$STATUS_FILE" ]; then
  cat "$STATUS_FILE"
  fail "preflight не выполнен" "рабочая копия должна быть чистой; deploy-команда больше не делает git add/commit автоматически"
fi

while IFS= read -r tracked_path; do
  if is_dangerous_path "$tracked_path"; then
    fail "preflight не выполнен" "опасный файл уже отслеживается git: $tracked_path"
  fi
done < <(git ls-files)

git diff --check || fail "preflight не выполнен" "git diff --check завершился с ошибкой"

echo "  npm run check..."
npm run check || fail "preflight не выполнен" "npm run check завершился с ошибкой"

echo "  npm test..."
npm test || fail "preflight не выполнен" "npm test завершился с ошибкой"

echo "  npm run build..."
npm run build || fail "preflight не выполнен" "npm run build завершился с ошибкой"

echo "Этап 2 из 4. Синхронизация main с GitHub"

git fetch origin main || fail "GitHub sync не выполнен" "git fetch origin main завершился с ошибкой"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "Локальный main уже совпадает с origin/main: $LOCAL_SHA"
elif git merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL_SHA"; then
  echo "Локальный main опережает origin/main. Публикую release..."
  git push origin main || fail "GitHub sync не выполнен" "git push origin main завершился с ошибкой"
  git fetch origin main || fail "GitHub sync не выполнен" "не удалось подтвердить origin/main после push"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || \
    fail "GitHub sync не выполнен" "после push локальный main не совпадает с origin/main"
elif git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_SHA"; then
  fail "GitHub sync не выполнен" "локальный main отстаёт от origin/main; сначала безопасно синхронизируйте рабочую копию"
else
  fail "GitHub sync не выполнен" "локальный main и origin/main разошлись; автоматический merge запрещён"
fi

RELEASE_SHA="$(git rev-parse origin/main)"
echo "Release SHA: $RELEASE_SHA"

echo "Этап 3 из 4. Backup, migration и deploy production"

ssh "$PRODUCTION_HOST" "bash -s -- '$PRODUCTION_PATH' '$PRODUCTION_DOMAIN' '$RELEASE_SHA'" <<'REMOTE_SCRIPT' 2>&1 | tee "$SSH_LOG_FILE"
set -u

PRODUCTION_PATH="$1"
PRODUCTION_DOMAIN="$2"
EXPECTED_RELEASE_SHA="$3"

server_error() {
  echo "DEPLOY_STAGE=server_error"
  echo "TECH_REASON: $1"
  exit 21
}

check_error() {
  echo "DEPLOY_STAGE=application_check_error"
  echo "TECH_REASON: $1"
  exit 22
}

cd "$PRODUCTION_PATH" || server_error "на сервере нет каталога $PRODUCTION_PATH"

for required_file in Dockerfile compose.production.yml package.json package-lock.json .env.production; do
  [ -f "$required_file" ] || server_error "не найден обязательный production-файл $required_file"
done

ENV_MODE="$(stat -c '%a' .env.production 2>/dev/null || true)"
case "$ENV_MODE" in
  600|400) ;;
  *) server_error ".env.production должен иметь mode 0600/0400, сейчас: ${ENV_MODE:-unknown}" ;;
esac

COMPOSE="docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml"

# finance_bot is a separate workload and must not be restarted by this deploy.
FINANCE_BOT_ID_BEFORE="$(docker ps -q --filter 'name=^/finance_bot$' | head -n 1)"
BACKEND_CONTAINER_BEFORE="$($COMPOSE ps -q backend 2>/dev/null | head -n 1)"
POSTGRES_CONTAINER="$($COMPOSE ps -q postgres 2>/dev/null | head -n 1)"
TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"

[ -n "$BACKEND_CONTAINER_BEFORE" ] || server_error "текущий production backend не найден; deploy остановлен до изменения topology"
[ -n "$POSTGRES_CONTAINER" ] || server_error "текущий production PostgreSQL не найден; backup невозможен"
docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null | grep -qx true || \
  server_error "текущий production PostgreSQL не запущен; backup невозможен"

OLD_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER_BEFORE" 2>/dev/null || true)"
[ -n "$OLD_IMAGE_ID" ] || server_error "не удалось определить текущий application image"
ROLLBACK_TAG="zabota-web-service:predeploy-${TIMESTAMP}"
if docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1; then
  server_error "rollback tag уже существует; существующий immutable checkpoint не будет перезаписан"
fi
docker tag "$OLD_IMAGE_ID" "$ROLLBACK_TAG" || server_error "не удалось сохранить rollback image"
echo "Rollback image сохранён: $ROLLBACK_TAG"

BACKUP_ROOT="/opt/zabota/backups"
BACKUP_DIR="$BACKUP_ROOT/pre-deploy-${TIMESTAMP}"
BACKUP_FILE="$BACKUP_DIR/zabota-postgresql.dump"
mkdir -p "$BACKUP_ROOT" || server_error "не удалось подготовить backup root"
mkdir "$BACKUP_DIR" || server_error "backup directory уже существует или не может быть создан; перезапись запрещена"
chmod 700 "$BACKUP_DIR" || server_error "не удалось ограничить права backup directory"

docker exec "$POSTGRES_CONTAINER" sh -lc \
  'pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-zabota}" -Fc' \
  >"$BACKUP_FILE" || server_error "pg_dump завершился с ошибкой"

[ -s "$BACKUP_FILE" ] || server_error "PostgreSQL backup пуст"
chmod 600 "$BACKUP_FILE" || server_error "не удалось установить mode 0600 для backup"

docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$BACKUP_FILE" >/dev/null || \
  server_error "pg_restore --list не подтвердил backup"

(cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" >SHA256SUMS && chmod 600 SHA256SUMS \
  && sha256sum -c SHA256SUMS >/dev/null) || server_error "checksum verification PostgreSQL backup завершилась с ошибкой"

BACKUP_SIZE="$(wc -c <"$BACKUP_FILE" | tr -d ' ')"
echo "Fresh PostgreSQL backup: $BACKUP_FILE (${BACKUP_SIZE} bytes)"

# Only after the current database and application image are recoverably captured may
# the production checkout or Compose services be reconciled with the new release.
git diff --quiet && git diff --cached --quiet || \
  server_error "production checkout содержит tracked changes; reset запрещён"
git fetch origin main || server_error "git fetch origin main завершился с ошибкой"
git reset --hard origin/main || server_error "git reset --hard origin/main завершился с ошибкой"
SERVER_SHA="$(git rev-parse HEAD)" || server_error "не удалось определить production SHA"
[ "$SERVER_SHA" = "$EXPECTED_RELEASE_SHA" ] || server_error "production checkout SHA не совпал с release SHA"

for required_directory in backend frontend landing-public scripts; do
  [ -d "$required_directory" ] || server_error "после checkout не найдена папка $required_directory"
done
for required_file in Dockerfile compose.production.yml package.json package-lock.json .env.production; do
  [ -f "$required_file" ] || server_error "после checkout не найден обязательный production-файл $required_file"
done

ENV_MODE="$(stat -c '%a' .env.production 2>/dev/null || true)"
case "$ENV_MODE" in
  600|400) ;;
  *) server_error ".env.production должен сохранить mode 0600/0400 после checkout" ;;
esac

APP_HOST_PORT_VALUE="$(sed -n 's/^[[:space:]]*APP_HOST_PORT[[:space:]]*=[[:space:]]*//p' .env.production | tail -n 1 | tr -d '[:space:]')"
[ "$APP_HOST_PORT_VALUE" = "4100" ] || server_error "APP_HOST_PORT должен быть равен 4100 для текущего Caddy topology"

COMPOSE="docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml"
$COMPOSE config --quiet || server_error "production Compose configuration невалидна"

command -v caddy >/dev/null 2>&1 || server_error "caddy не найден"
systemctl is-active --quiet caddy || server_error "caddy не активен"
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || server_error "Caddy configuration невалидна"
grep -Eq 'reverse_proxy[[:space:]]+127\.0\.0\.1:4100([[:space:]]|$)' /etc/caddy/Caddyfile || \
  server_error "Caddy не направлен на обязательный loopback backend 127.0.0.1:4100"

echo "Собираю migration/application images..."
$COMPOSE build migrate backend || server_error "не удалось собрать migration/application images"

$COMPOSE up -d --wait postgres || server_error "PostgreSQL не достиг состояния ready"

echo "Выполняю one-shot Prisma migrations..."
$COMPOSE run --rm migrate || server_error "prisma migrate deploy завершился с ошибкой; backend не переключён"

echo "Запускаю новую application version..."
$COMPOSE up -d --no-deps --wait backend || server_error "не удалось запустить/дождаться healthy backend"

echo "Этап 4 из 4. Production smoke"

$COMPOSE ps --status running --services | grep -qx 'postgres' || check_error "PostgreSQL service не работает"
$COMPOSE ps --status running --services | grep -qx 'backend' || check_error "backend service не работает"

curl -fsS --retry 5 --retry-delay 2 --max-time 15 http://127.0.0.1:4100/api/health >/dev/null || \
  check_error "не отвечает backend /api/health на 127.0.0.1:4100"
curl -fsS --retry 5 --retry-delay 2 --max-time 15 http://127.0.0.1:4100/api/ready >/dev/null || \
  check_error "не отвечает backend /api/ready на 127.0.0.1:4100"
curl -fsSI --retry 5 --retry-delay 2 --max-time 15 http://127.0.0.1:4100/ >/dev/null || \
  check_error "не отвечает backend landing на 127.0.0.1:4100"
curl -fsSI --retry 5 --retry-delay 2 --max-time 15 http://127.0.0.1:4100/app >/dev/null || \
  check_error "не отвечает backend /app на 127.0.0.1:4100"

if command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy; then
  curl -fsS --retry 5 --retry-delay 2 --max-time 15 "https://${PRODUCTION_DOMAIN}/api/health" >/dev/null || \
    check_error "production HTTPS /api/health не отвечает"
  curl -fsS --retry 5 --retry-delay 2 --max-time 15 "https://${PRODUCTION_DOMAIN}/api/ready" >/dev/null || \
    check_error "production HTTPS /api/ready не отвечает"
  curl -fsSI --retry 5 --retry-delay 2 --max-time 15 "https://${PRODUCTION_DOMAIN}/app" >/dev/null || \
    check_error "production HTTPS /app не отвечает"
else
  check_error "Caddy не активен после deploy"
fi

BACKEND_CONTAINER_AFTER="$($COMPOSE ps -q backend 2>/dev/null | head -n 1)"
[ -n "$BACKEND_CONTAINER_AFTER" ] || check_error "backend container id не определён после deploy"

FINANCE_BOT_ID_AFTER="$(docker ps -q --filter 'name=^/finance_bot$' | head -n 1)"
if [ -n "$FINANCE_BOT_ID_BEFORE" ]; then
  [ "$FINANCE_BOT_ID_AFTER" = "$FINANCE_BOT_ID_BEFORE" ] || \
    check_error "finance_bot был остановлен/перезапущен, хотя deploy не должен его затрагивать"
fi

echo "PRODUCTION_RELEASE_SHA=$SERVER_SHA"
echo "PRODUCTION_BACKUP=$BACKUP_FILE"
echo "PRODUCTION_BACKEND_CONTAINER=$BACKEND_CONTAINER_AFTER"
echo "DEPLOY_RESULT=success"
REMOTE_SCRIPT

SSH_RESULT=${PIPESTATUS[0]}
if [ "$SSH_RESULT" -ne 0 ]; then
  TECH_REASON="$(grep 'TECH_REASON:' "$SSH_LOG_FILE" | tail -n 1 | sed 's/^TECH_REASON: //')"
  if [ -z "$TECH_REASON" ]; then
    TECH_REASON="SSH-сеанс завершился с кодом $SSH_RESULT"
  fi

  if grep -q 'DEPLOY_STAGE=application_check_error' "$SSH_LOG_FILE"; then
    fail "production smoke не выполнен" "$TECH_REASON"
  else
    fail "production deploy не выполнен" "$TECH_REASON"
  fi
fi

echo
echo "GitHub main - синхронизирован"
echo "Fresh PostgreSQL backup - создан и проверен"
echo "Production deploy - успешно"
echo "Health/readiness/HTTPS smoke - успешно"
echo "Пароль superadmin НЕ изменялся"
echo
echo "Следующий отдельный шаг для восстановления superadmin:"
echo "  cd $PRODUCTION_PATH"
echo "  docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml exec backend reset-superadmin-password"
pause_and_exit 0
