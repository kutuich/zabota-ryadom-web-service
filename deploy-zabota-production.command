#!/bin/bash

# Controlled production deploy button for macOS.
# Current topology: GitHub main -> immutable /opt/zabota/releases/<release-sha>
# -> Compose project zabota-production -> PostgreSQL 16 + backend on
# 127.0.0.1:4100 -> Caddy.
# The script never resets passwords and never touches finance_bot.
# Compatible with the Bash version shipped with macOS.

set -u

cd "$(dirname "$0")" || exit 1

EXPECTED_ORIGIN="https://github.com/kutuich/zabota-ryadom-web-service.git"
PRODUCTION_HOST="${PRODUCTION_HOST:-root@104.171.139.243}"
PRODUCTION_ROOT="/opt/zabota"
PRODUCTION_DOMAIN="${PRODUCTION_DOMAIN:-zabota-ugorsk.ru}"

STATUS_FILE="$(mktemp -t zabota-git-status.XXXXXX)"
SSH_LOG_FILE="$(mktemp -t zabota-deploy-ssh.XXXXXX)"
CI_STATUS_FILE="$(mktemp -t zabota-github-ci.XXXXXX)"

cleanup() {
  rm -f "$STATUS_FILE" "$SSH_LOG_FILE" "$CI_STATUS_FILE"
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
command -v node >/dev/null 2>&1 || fail "preflight не выполнен" "node не найден"
command -v npm >/dev/null 2>&1 || fail "preflight не выполнен" "npm не найден"
command -v curl >/dev/null 2>&1 || fail "preflight не выполнен" "curl не найден"
command -v python3 >/dev/null 2>&1 || fail "preflight не выполнен" "python3 не найден"
command -v ssh >/dev/null 2>&1 || fail "preflight не выполнен" "ssh не найден"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || \
  fail "preflight не выполнен" "не удалось определить версию Node.js"
[ "$NODE_MAJOR" = "22" ] || \
  fail "preflight не выполнен" "production release требует Node.js 22, сейчас: $(node --version)"

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

echo "Этап 2 из 4. GitHub release gate и локальная проверка"

git fetch origin main || fail "GitHub sync не выполнен" "git fetch origin main завершился с ошибкой"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || \
  fail "GitHub sync не выполнен" "локальный main должен точно совпадать с origin/main; deploy-команда не выполняет push/merge"

RELEASE_SHA="$(git rev-parse origin/main)"
echo "Release SHA: $RELEASE_SHA"

CI_API_URL="https://api.github.com/repos/kutuich/zabota-ryadom-web-service/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${RELEASE_SHA}&per_page=10"
curl -fsSL --max-time 20 \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "$CI_API_URL" >"$CI_STATUS_FILE" || \
  fail "GitHub CI gate не выполнен" "не удалось получить GitHub Actions status"

CI_RUN_URL="$(python3 - "$CI_STATUS_FILE" "$RELEASE_SHA" <<'PY'
import json
import sys

status_file, release_sha = sys.argv[1:]
with open(status_file, encoding="utf-8") as source:
    runs = json.load(source).get("workflow_runs", [])

successful = [
    run for run in runs
    if run.get("head_sha") == release_sha
    and run.get("status") == "completed"
    and run.get("conclusion") == "success"
]
if not successful:
    raise SystemExit(1)
print(successful[0].get("html_url", "success"))
PY
)" || fail "GitHub CI gate не выполнен" "для release SHA нет завершённого успешного workflow CI"
echo "GitHub CI подтверждён: $CI_RUN_URL"

echo "  npm run check..."
npm run check || fail "preflight не выполнен" "npm run check завершился с ошибкой"

echo "  npm run build..."
npm run build || fail "preflight не выполнен" "npm run build завершился с ошибкой"

echo "Этап 3 из 4. Backup, migration и deploy production"

ssh "$PRODUCTION_HOST" "bash -s -- '$PRODUCTION_ROOT' '$PRODUCTION_DOMAIN' '$RELEASE_SHA' '$EXPECTED_ORIGIN'" <<'REMOTE_SCRIPT' 2>&1 | tee "$SSH_LOG_FILE"
set -u

PRODUCTION_ROOT="$1"
PRODUCTION_DOMAIN="$2"
EXPECTED_RELEASE_SHA="$3"
EXPECTED_ORIGIN="$4"
RELEASES_ROOT="$PRODUCTION_ROOT/releases"
BACKUP_ROOT="$PRODUCTION_ROOT/backups"
MIN_FREE_KIB=3145728

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

[ -d "$PRODUCTION_ROOT" ] || server_error "на сервере нет production root $PRODUCTION_ROOT"
[ -d "$RELEASES_ROOT" ] || server_error "на сервере нет releases root $RELEASES_ROOT"

# Discover the active release from the one running Compose backend. Never pick a
# directory by mtime/name and never trust the historical /opt/zabota/repo checkout.
BACKEND_CONTAINERS="$(docker ps \
  --filter 'label=com.docker.compose.project=zabota-production' \
  --filter 'label=com.docker.compose.service=backend' \
  --format '{{.ID}}')"
BACKEND_COUNT="$(printf '%s\n' "$BACKEND_CONTAINERS" | sed '/^$/d' | wc -l | tr -d ' ')"
[ "$BACKEND_COUNT" = "1" ] || \
  server_error "ожидался ровно один running backend Compose project zabota-production, найдено: $BACKEND_COUNT"
BACKEND_CONTAINER_BEFORE="$(printf '%s\n' "$BACKEND_CONTAINERS" | head -n 1)"

ACTIVE_RELEASE_DIR="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$BACKEND_CONTAINER_BEFORE" 2>/dev/null || true)"
ACTIVE_RELEASE_DIR="$(readlink -f "$ACTIVE_RELEASE_DIR" 2>/dev/null || true)"
CANONICAL_RELEASES_ROOT="$(readlink -f "$RELEASES_ROOT" 2>/dev/null || true)"
[ -n "$ACTIVE_RELEASE_DIR" ] && [ -n "$CANONICAL_RELEASES_ROOT" ] || \
  server_error "не удалось однозначно определить active release directory из backend container"
case "$ACTIVE_RELEASE_DIR" in
  "$CANONICAL_RELEASES_ROOT"/*) ;;
  *) server_error "active backend не привязан к каталогу в $CANONICAL_RELEASES_ROOT" ;;
esac
ACTIVE_RELEASE_SHA="${ACTIVE_RELEASE_DIR##*/}"
printf '%s\n' "$ACTIVE_RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$' || \
  server_error "active release directory не имеет имя в формате full Git SHA"

OLD_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER_BEFORE" 2>/dev/null || true)"
[ -n "$OLD_IMAGE_ID" ] || server_error "не удалось определить текущий application image"
ACTIVE_RELEASE_IMAGE_TAG="zabota-web-service:release-${ACTIVE_RELEASE_SHA}"
docker image inspect "$OLD_IMAGE_ID" -f '{{range .RepoTags}}{{println .}}{{end}}' 2>/dev/null \
  | grep -Fxq "$ACTIVE_RELEASE_IMAGE_TAG" || \
  server_error "running backend image не имеет immutable tag, соответствующий active release SHA"

for required_file in Dockerfile compose.production.yml package.json package-lock.json .env.production; do
  [ -f "$ACTIVE_RELEASE_DIR/$required_file" ] || \
    server_error "active release не содержит обязательный production-файл $required_file"
done

ACTIVE_ENV_MODE="$(stat -c '%a' "$ACTIVE_RELEASE_DIR/.env.production" 2>/dev/null || true)"
case "$ACTIVE_ENV_MODE" in
  600|400) ;;
  *) server_error "active .env.production должен иметь mode 0600/0400, сейчас: ${ACTIVE_ENV_MODE:-unknown}" ;;
esac

# finance_bot is a separate workload and must not be restarted by this deploy.
FINANCE_BOT_ID_BEFORE="$(docker ps -q --filter 'name=^/finance_bot$' | head -n 1)"
POSTGRES_CONTAINERS="$(docker ps \
  --filter 'label=com.docker.compose.project=zabota-production' \
  --filter 'label=com.docker.compose.service=postgres' \
  --format '{{.ID}}')"
POSTGRES_COUNT="$(printf '%s\n' "$POSTGRES_CONTAINERS" | sed '/^$/d' | wc -l | tr -d ' ')"
[ "$POSTGRES_COUNT" = "1" ] || \
  server_error "ожидался ровно один running PostgreSQL Compose project zabota-production, найдено: $POSTGRES_COUNT"
POSTGRES_CONTAINER="$(printf '%s\n' "$POSTGRES_CONTAINERS" | head -n 1)"
TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"

docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null | grep -qx true || \
  server_error "текущий production PostgreSQL не запущен; backup невозможен"

# Fail before creating a tag, release, build, or backup. Cleanup is always a
# separate operator decision; this script never prunes production assets.
AVAILABLE_KIB="$(df -Pk "$PRODUCTION_ROOT" 2>/dev/null | awk 'NR == 2 { print $4 }')"
case "$AVAILABLE_KIB" in
  ''|*[!0-9]*) server_error "не удалось определить свободное место для $PRODUCTION_ROOT" ;;
esac
[ "$AVAILABLE_KIB" -ge "$MIN_FREE_KIB" ] || \
  server_error "для deploy требуется не менее 3 GiB свободного места; cleanup автоматически не выполняется"
echo "Active release: $ACTIVE_RELEASE_SHA"
echo "Disk preflight: $AVAILABLE_KIB KiB available"

NEW_RELEASE_DIR="$RELEASES_ROOT/$EXPECTED_RELEASE_SHA"
RELEASE_IMAGE_TAG="zabota-web-service:release-${EXPECTED_RELEASE_SHA}"
[ ! -e "$NEW_RELEASE_DIR" ] || \
  server_error "release directory $NEW_RELEASE_DIR уже существует; автоматическая перезапись запрещена"
if docker image inspect "$RELEASE_IMAGE_TAG" >/dev/null 2>&1; then
  server_error "release image tag $RELEASE_IMAGE_TAG уже существует; перезапись запрещена"
fi

ROLLBACK_TAG="zabota-web-service:predeploy-${TIMESTAMP}"
if docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1; then
  server_error "rollback tag уже существует; существующий immutable checkpoint не будет перезаписан"
fi
docker tag "$OLD_IMAGE_ID" "$ROLLBACK_TAG" || server_error "не удалось сохранить rollback image"
echo "Rollback image сохранён: $ROLLBACK_TAG"

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

# Materialize the approved commit as a new release. Existing release directories
# are immutable checkpoints and are never overwritten or selected by recency.
git clone --no-checkout "$EXPECTED_ORIGIN" "$NEW_RELEASE_DIR" || \
  server_error "не удалось создать новый release directory из GitHub"
REMOTE_MAIN_SHA="$(git -C "$NEW_RELEASE_DIR" rev-parse refs/remotes/origin/main 2>/dev/null || true)"
[ "$REMOTE_MAIN_SHA" = "$EXPECTED_RELEASE_SHA" ] || \
  server_error "origin/main на сервере не совпал с approved release SHA"
git -C "$NEW_RELEASE_DIR" checkout --detach "$EXPECTED_RELEASE_SHA" || \
  server_error "не удалось checkout approved release SHA"
SERVER_SHA="$(git -C "$NEW_RELEASE_DIR" rev-parse HEAD 2>/dev/null || true)"
[ "$SERVER_SHA" = "$EXPECTED_RELEASE_SHA" ] || server_error "production checkout SHA не совпал с release SHA"

for required_directory in backend frontend landing-public scripts; do
  [ -d "$NEW_RELEASE_DIR/$required_directory" ] || server_error "в новом release не найдена папка $required_directory"
done
for required_file in Dockerfile compose.production.yml package.json package-lock.json; do
  [ -f "$NEW_RELEASE_DIR/$required_file" ] || server_error "в новом release не найден обязательный файл $required_file"
done

if git -C "$NEW_RELEASE_DIR" ls-files --error-unmatch .env.production >/dev/null 2>&1; then
  server_error ".env.production неожиданно отслеживается Git; production secrets не копируются"
fi
install -m 600 "$ACTIVE_RELEASE_DIR/.env.production" "$NEW_RELEASE_DIR/.env.production" || \
  server_error "не удалось безопасно перенести production env из active release"
ENV_MODE="$(stat -c '%a' "$NEW_RELEASE_DIR/.env.production" 2>/dev/null || true)"
[ "$ENV_MODE" = "600" ] || server_error ".env.production в новом release должен иметь mode 0600"

cd "$NEW_RELEASE_DIR" || server_error "не удалось войти в новый release directory"
APP_ENV_FILE_VALUE="$(sed -n 's/^[[:space:]]*APP_ENV_FILE[[:space:]]*=[[:space:]]*//p' .env.production \
  | tail -n 1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
case "$APP_ENV_FILE_VALUE" in
  \"*\") APP_ENV_FILE_VALUE="${APP_ENV_FILE_VALUE#\"}"; APP_ENV_FILE_VALUE="${APP_ENV_FILE_VALUE%\"}" ;;
  \'*\') APP_ENV_FILE_VALUE="${APP_ENV_FILE_VALUE#\'}"; APP_ENV_FILE_VALUE="${APP_ENV_FILE_VALUE%\'}" ;;
  \"*|*\"|\'*|*\') server_error "APP_ENV_FILE содержит несогласованные кавычки" ;;
esac
case "$APP_ENV_FILE_VALUE" in
  ''|.env.production) ;;
  *) server_error "APP_ENV_FILE должен указывать только на .env.production внутри active release model" ;;
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

NEW_IMAGE_ID="$(docker image inspect zabota-production-backend -f '{{.Id}}' 2>/dev/null || true)"
[ -n "$NEW_IMAGE_ID" ] || server_error "не удалось определить собранный backend image"
docker tag "$NEW_IMAGE_ID" "$RELEASE_IMAGE_TAG" || server_error "не удалось сохранить immutable release image"

$COMPOSE up -d --wait postgres || server_error "PostgreSQL не достиг состояния ready"

echo "Выполняю one-shot Prisma migrations..."
$COMPOSE run --rm migrate || server_error "prisma migrate deploy завершился с ошибкой; backend не переключён"

echo "Запускаю новую application version..."
$COMPOSE up -d --no-deps --wait backend || server_error "не удалось запустить/дождаться healthy backend"
FORWARD_ONLY_BOUNDARY_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

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
BACKEND_RELEASE_DIR_AFTER="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$BACKEND_CONTAINER_AFTER" 2>/dev/null || true)"
BACKEND_RELEASE_DIR_AFTER="$(readlink -f "$BACKEND_RELEASE_DIR_AFTER" 2>/dev/null || true)"
[ "$BACKEND_RELEASE_DIR_AFTER" = "$NEW_RELEASE_DIR" ] || \
  check_error "running backend после deploy не привязан к новому release directory"
BACKEND_IMAGE_AFTER="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER_AFTER" 2>/dev/null || true)"
[ "$BACKEND_IMAGE_AFTER" = "$NEW_IMAGE_ID" ] || \
  check_error "running backend после deploy не использует собранный release image"

FINANCE_BOT_ID_AFTER="$(docker ps -q --filter 'name=^/finance_bot$' | head -n 1)"
if [ -n "$FINANCE_BOT_ID_BEFORE" ]; then
  [ "$FINANCE_BOT_ID_AFTER" = "$FINANCE_BOT_ID_BEFORE" ] || \
    check_error "finance_bot был остановлен/перезапущен, хотя deploy не должен его затрагивать"
fi

echo "PRODUCTION_RELEASE_SHA=$SERVER_SHA"
echo "PRODUCTION_RELEASE_DIR=$NEW_RELEASE_DIR"
echo "PRODUCTION_RELEASE_IMAGE=$RELEASE_IMAGE_TAG"
echo "PRODUCTION_BACKUP=$BACKUP_FILE"
echo "FORWARD_ONLY_BOUNDARY_UTC=$FORWARD_ONLY_BOUNDARY_UTC"
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
echo "  cd $PRODUCTION_ROOT/releases/$RELEASE_SHA"
echo "  docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml exec backend reset-superadmin-password"
pause_and_exit 0
