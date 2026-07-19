#!/bin/bash

# Production deploy button for macOS.
# Keep this script compatible with the Bash version shipped with macOS.

cd "$(dirname "$0")" || exit 1

EXPECTED_ORIGIN="https://github.com/kutuich/zabota-ryadom-web-service.git"
PRODUCTION_HOST="root@104.171.139.243"
PRODUCTION_PATH="/opt/zabota/repo"

STATUS_FILE="$(mktemp -t zabota-git-status.XXXXXX)"
SSH_LOG_FILE="$(mktemp -t zabota-deploy-ssh.XXXXXX)"

cleanup() {
  rm -f "$STATUS_FILE" "$SSH_LOG_FILE"
}
trap cleanup EXIT

pause_and_exit() {
  local exit_code="$1"
  read -r -p "Нажмите Enter для закрытия..."
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
    */node_modules/*|*/dist/*|*/uploads/*|*/data/*|*/backups/*)
      return 0
      ;;
  esac

  return 1
}

echo "Этап 1 из 3. Проверка и загрузка на GitHub"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "загрузка на GitHub не выполнена" "папка со скриптом не является git-репозиторием"
fi

ACTUAL_ORIGIN="$(git remote get-url origin 2>/dev/null)" || \
  fail "загрузка на GitHub не выполнена" "в git-репозитории не найден remote origin"

if [ "$ACTUAL_ORIGIN" != "$EXPECTED_ORIGIN" ]; then
  fail "загрузка на GitHub не выполнена" "origin указывает на $ACTUAL_ORIGIN, а ожидается $EXPECTED_ORIGIN"
fi

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  fail "загрузка на GitHub не выполнена" "текущая ветка — $CURRENT_BRANCH; для production нужна ветка main"
fi

if ! git -c core.quotePath=false status --short --untracked-files=all >"$STATUS_FILE"; then
  fail "загрузка на GitHub не выполнена" "не удалось прочитать git status"
fi

DANGEROUS_PATH=""
while IFS= read -r status_line; do
  changed_path="${status_line:3}"

  if [[ "$changed_path" == *" -> "* ]]; then
    old_path="${changed_path%% -> *}"
    new_path="${changed_path#* -> }"
    if is_dangerous_path "$old_path"; then
      DANGEROUS_PATH="$old_path"
      break
    fi
    if is_dangerous_path "$new_path"; then
      DANGEROUS_PATH="$new_path"
      break
    fi
  elif is_dangerous_path "$changed_path"; then
    DANGEROUS_PATH="$changed_path"
    break
  fi
done <"$STATUS_FILE"

if [ -n "$DANGEROUS_PATH" ]; then
  fail "загрузка на GitHub не выполнена" "в git status найден опасный файл или каталог: $DANGEROUS_PATH"
fi

while IFS= read -r tracked_path; do
  if is_dangerous_path "$tracked_path"; then
    fail "загрузка на GitHub не выполнена" "опасный файл уже отслеживается git: $tracked_path"
  fi
done < <(git ls-files)

if ! git add .; then
  fail "загрузка на GitHub не выполнена" "команда git add завершилась с ошибкой"
fi

git diff --cached --quiet
DIFF_RESULT=$?
if [ "$DIFF_RESULT" -eq 1 ]; then
  COMMIT_MESSAGE="Production update $(date '+%Y-%m-%d %H:%M')"
  if ! git commit -m "$COMMIT_MESSAGE"; then
    fail "загрузка на GitHub не выполнена" "не удалось создать git commit"
  fi
elif [ "$DIFF_RESULT" -ne 0 ]; then
  fail "загрузка на GitHub не выполнена" "не удалось проверить изменения перед commit"
else
  echo "Новых изменений для commit нет. Будет развернута текущая версия GitHub."
fi

if ! git push origin main; then
  fail "загрузка на GitHub не выполнена" "команда git push origin main завершилась с ошибкой"
fi

echo "Этап 2 из 3. Загрузка версии на production-сервер и перезапуск"

ssh "$PRODUCTION_HOST" "bash -s -- '$PRODUCTION_PATH'" <<'REMOTE_SCRIPT' 2>&1 | tee "$SSH_LOG_FILE"
PRODUCTION_PATH="$1"

server_error() {
  echo "DEPLOY_STAGE=server_download_error"
  echo "TECH_REASON: $1"
  exit 21
}

check_error() {
  echo "DEPLOY_STAGE=application_check_error"
  echo "TECH_REASON: $1"
  exit 22
}

cd "$PRODUCTION_PATH" || server_error "на сервере нет каталога $PRODUCTION_PATH"
git fetch origin main || server_error "git fetch origin main завершился с ошибкой"
git reset --hard origin/main || server_error "git reset --hard origin/main завершился с ошибкой"

for required_directory in backend frontend landing-public scripts; do
  [ -d "$required_directory" ] || server_error "после загрузки не найдена папка $required_directory"
done

for required_file in Dockerfile package.json package-lock.json .env.production; do
  [ -f "$required_file" ] || server_error "после загрузки не найден файл $required_file"
done

docker build -t zabota-web-service . || server_error "не удалось собрать Docker image zabota-web-service"
docker stop zabota-web || true
docker rm zabota-web || true
docker run -d \
  --name zabota-web \
  --restart unless-stopped \
  --env-file /opt/zabota/repo/.env.production \
  -p 80:4000 \
  -v /opt/zabota/data:/data \
  zabota-web-service || server_error "не удалось запустить Docker-контейнер zabota-web"

echo "Этап 3 из 3. Ожидание запуска и проверка приложения"
sleep 10

docker ps --filter 'name=^/zabota-web$' --filter 'status=running' --format '{{.Names}}' | grep -qx 'zabota-web' || \
  check_error "Docker-контейнер zabota-web не работает"
curl -fsS http://127.0.0.1/api/health >/dev/null || check_error "не отвечает /api/health"
curl -fsSI http://127.0.0.1/ >/dev/null || check_error "не отвечает главная страница"
curl -fsSI http://127.0.0.1/app >/dev/null || check_error "не отвечает /app"
curl -fsSI http://127.0.0.1/prices.html >/dev/null || check_error "не отвечает /prices.html"
REMOTE_SCRIPT

SSH_RESULT=${PIPESTATUS[0]}
if [ "$SSH_RESULT" -ne 0 ]; then
  TECH_REASON="$(grep 'TECH_REASON:' "$SSH_LOG_FILE" | tail -n 1 | sed 's/^TECH_REASON: //')"
  if [ -z "$TECH_REASON" ]; then
    TECH_REASON="SSH-сеанс завершился с кодом $SSH_RESULT"
  fi

  if grep -q 'DEPLOY_STAGE=application_check_error' "$SSH_LOG_FILE"; then
    fail "проверка приложения не выполнена" "$TECH_REASON"
  else
    fail "загрузка с GitHub на сервер не выполнена" "$TECH_REASON"
  fi
fi

echo
echo "Загрузка на GitHub - успешно"
echo "Загрузка с GitHub на сервер - успешно"
echo "Проверка приложения - успешно"
pause_and_exit 0
