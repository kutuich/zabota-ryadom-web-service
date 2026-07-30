#!/bin/bash

# Read-only code and production-readiness audit for "Забота Рядом".
# Compatible with the Bash version shipped with macOS.

set -u

cd "$(dirname "$0")" || exit 1

PROJECT_DIR="$(pwd -P)"
PROJECT_ROOT="$(cd "$PROJECT_DIR/.." && pwd -P)"
AUDITS_ROOT="$PROJECT_ROOT/audits"
REPORT_DIR="$AUDITS_ROOT/code"
TIMESTAMP="$(date '+%Y-%m-%d-%H%M%S')"
REPORT_FILE="$REPORT_DIR/code-audit-$TIMESTAMP.md"
WORK_DIR="$(mktemp -d -t zabota-code-audit.XXXXXX)"

CRITICAL_FILE="$WORK_DIR/critical.md"
IMPORTANT_FILE="$WORK_DIR/important.md"
WARNING_FILE="$WORK_DIR/warnings.md"
MANUAL_FILE="$WORK_DIR/manual.md"
DETAIL_FILE="$WORK_DIR/details.md"

CRITICAL_COUNT=0
IMPORTANT_COUNT=0
WARNING_COUNT=0

STRUCTURE_STATUS="успешно"
GIT_STATUS="успешно"
BUILD_STATUS="отсутствует"
LINT_STATUS="отсутствует"
TEST_STATUS="отсутствует"
TYPECHECK_STATUS="отсутствует"
DOCKER_STATUS="ошибка"
LOCAL_STATUS="пропущено"
PRODUCTION_STATUS="успешно"
PRODUCTION_SSH_STATUS="пропущено"
REGISTRATION_STATUS="успешно"
LEGAL_STATUS="успешно"
CITIES_STATUS="успешно"
TERMS_STATUS="успешно"
LINKS_STATUS="успешно"
INDEX_LINKS_FOUND=0
PRODUCTION_SSH_HOST="${PRODUCTION_SSH_HOST:-root@104.171.139.243}"
PRODUCTION_PATH="${PRODUCTION_PATH:-/opt/zabota}"

mkdir -p "$AUDITS_ROOT" "$REPORT_DIR"
: >"$CRITICAL_FILE"
: >"$IMPORTANT_FILE"
: >"$WARNING_FILE"
: >"$MANUAL_FILE"
: >"$DETAIL_FILE"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

pause_at_end() {
  if [ -t 0 ]; then
    read -r -p "Нажмите Enter для закрытия..."
  fi
}

add_critical() {
  CRITICAL_COUNT=$((CRITICAL_COUNT + 1))
  printf -- '- %s\n' "$1" >>"$CRITICAL_FILE"
}

add_important() {
  IMPORTANT_COUNT=$((IMPORTANT_COUNT + 1))
  printf -- '- %s\n' "$1" >>"$IMPORTANT_FILE"
}

add_warning() {
  WARNING_COUNT=$((WARNING_COUNT + 1))
  printf -- '- %s\n' "$1" >>"$WARNING_FILE"
}

add_manual() {
  printf -- '- %s\n' "$1" >>"$MANUAL_FILE"
}

detail_heading() {
  printf '\n### %s\n\n' "$1" >>"$DETAIL_FILE"
}

detail_text() {
  printf '%s\n' "$1" >>"$DETAIL_FILE"
}

append_log() {
  local title="$1"
  local log_file="$2"
  detail_heading "$title"
  printf '```text\n' >>"$DETAIL_FILE"
  if [ -s "$log_file" ]; then
    tail -n 160 "$log_file" | sed 's/```/` ` `/g' >>"$DETAIL_FILE"
  else
    printf '(нет вывода)\n' >>"$DETAIL_FILE"
  fi
  printf '```\n' >>"$DETAIL_FILE"
}

has_npm_script() {
  local package_file="$1"
  local script_name="$2"
  node -e 'const path=require("node:path"); const p=require(path.resolve(process.argv[1])); process.exit(p.scripts && p.scripts[process.argv[2]] ? 0 : 1)' "$package_file" "$script_name" >/dev/null 2>&1
}

run_npm_check() {
  local label="$1"
  local package_dir="$2"
  local script_name="$3"
  local safe_label="${label//\//-}"
  safe_label="${safe_label// /-}"
  local log_file="$WORK_DIR/npm-$safe_label.log"
  local result

  if [ ! -f "$package_dir/package.json" ] || ! has_npm_script "$package_dir/package.json" "$script_name"; then
    detail_text "- $label: скрипт \`$script_name\` отсутствует."
    result="отсутствует"
  else
    echo "  $label..."
    (cd "$package_dir" && npm run "$script_name") >"$log_file" 2>&1
    if [ "$?" -eq 0 ]; then
      result="успешно"
    else
      result="ошибка"
      add_critical "$label завершился с ошибкой. См. технические детали."
    fi
    append_log "$label — $result" "$log_file"
  fi
  LAST_CHECK_STATUS="$result"
}

safe_rg() {
  # Search only explicitly supplied source paths; never scan real env files.
  rg --no-heading --line-number --color never -i "$@" 2>/dev/null || true
}

record_search() {
  local title="$1"
  local pattern="$2"
  shift 2
  local output_file="$WORK_DIR/search-$RANDOM.log"
  safe_rg "$pattern" "$@" >"$output_file"
  if [ -s "$output_file" ]; then
    append_log "$title" "$output_file"
    return 0
  fi
  return 1
}

http_status() {
  local status
  status="$(curl -L -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 "$1" 2>/dev/null || true)"
  if [ -n "$status" ]; then printf '%s' "$status"; else printf '000'; fi
}

check_url_group() {
  local group_name="$1"
  shift
  local url status result failures=0
  local log_file="$WORK_DIR/urls-${group_name}.log"
  : >"$log_file"
  for url in "$@"; do
    status="$(http_status "$url")"
    case "$status" in
      2*|3*) result="успешно" ;;
      *) result="ошибка"; failures=$((failures + 1)) ;;
    esac
    printf '%s | HTTP %s | %s\n' "$url" "$status" "$result" >>"$log_file"
  done
  append_log "$group_name — HTTP-проверки" "$log_file"
  URL_FAILURES="$failures"
}

check_content_marker() {
  local label="$1"
  local url="$2"
  local pattern="$3"
  local body_file="$WORK_DIR/http-body-$RANDOM.txt"
  local status

  status="$(curl -L -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 15 "$url" 2>/dev/null || true)"
  if [[ "$status" == 2* ]] && rg -qi "$pattern" "$body_file" 2>/dev/null; then
    detail_text "- $label: HTTP $status, ключевой текст найден."
    CONTENT_CHECK_RESULT="успешно"
  elif [[ "$status" == 2* ]]; then
    detail_text "- $label: HTTP $status, КЛЮЧЕВОЙ ТЕКСТ НЕ НАЙДЕН."
    CONTENT_CHECK_RESULT="ошибка"
  else
    detail_text "- $label: HTTP ${status:-000}, содержимое не проверено."
    CONTENT_CHECK_RESULT="ошибка"
  fi
}

check_index_html_runtime() {
  local label="$1"
  local url="$2"
  local result
  result="$(curl -sS -o /dev/null -w '%{http_code}|%{redirect_url}' --connect-timeout 5 --max-time 15 "$url" 2>/dev/null || true)"
  if [ -z "$result" ]; then result="000|"; fi
  detail_text "- $label/index.html: $result (допустим редирект на / или отсутствие страницы; использование в UI проверяется отдельно)."
}

check_legal_api_base() {
  local base_url="$1"
  local environment_label="$2"
  local severity="$3"
  local endpoint_found=0
  local valid_documents_endpoint=0
  local legal_path legal_http_status legal_result body_file missing_keys legal_key

  for legal_path in /api/legal/documents /api/public/legal/documents /api/legal; do
    body_file="$WORK_DIR/legal-body-$RANDOM.json"
    legal_http_status="$(curl -L -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 15 "$base_url$legal_path" 2>/dev/null || true)"
    case "$legal_http_status" in
      2*)
        endpoint_found=1
        legal_result="доступен"
        if [ "$legal_path" = "/api/legal/documents" ]; then
          missing_keys=""
          for legal_key in privacy personal_data_consent customer_agreement helper_terms service_notifications_consent marketing_notifications_consent helper_documents_consent service_rules; do
            if ! rg -q "\"type\"[[:space:]]*:[[:space:]]*\"${legal_key}\"" "$body_file" 2>/dev/null; then
              missing_keys="$missing_keys $legal_key"
            fi
          done
          if [ -z "$missing_keys" ]; then
            valid_documents_endpoint=1
            legal_result="доступен, все обязательные keys найдены"
          else
            legal_result="доступен, отсутствуют keys:$missing_keys"
            LEGAL_STATUS="есть проблемы"
            if [ "$severity" = "critical" ]; then
              add_critical "$environment_label legal API не вернул обязательные документы:$missing_keys."
            else
              add_important "$environment_label legal API не вернул обязательные документы:$missing_keys."
            fi
          fi
        fi
        ;;
      3*) legal_result="редирект" ;;
      401|403) legal_result="protected" ;;
      404) legal_result="маршрут не найден" ;;
      *) legal_result="ошибка" ;;
    esac
    printf '%s | HTTP %s | %s\n' "$base_url$legal_path" "${legal_http_status:-000}" "$legal_result" >>"$LEGAL_RUNTIME_LOG"
  done

  if [ "$endpoint_found" -eq 0 ]; then
    detail_text "- $environment_label: доступный legal API endpoint не найден."
    if [ "$severity" = "critical" ]; then
      LEGAL_STATUS="есть проблемы"
      add_critical "$environment_label: публичный legal API недоступен."
    elif [ "$severity" = "important" ]; then
      LEGAL_STATUS="есть проблемы"
      add_important "$environment_label: публичный legal API недоступен."
    fi
  elif [ "$valid_documents_endpoint" -eq 1 ]; then
    detail_text "- $environment_label: юридические документы реально получены через /api/legal/documents."
  fi
}

echo "Аудит кода «Забота Рядом»"
echo "Папка проекта: $PROJECT_DIR"
echo "Отчёт: $REPORT_FILE"
echo

# 1. Project structure and env presence (contents of real env files are never read).
echo "[1/14] Структура проекта и env-файлы"
detail_heading "Структура проекта"
for required_path in backend frontend landing-public Dockerfile package.json package-lock.json scripts docs ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md docs/DOCUMENTATION_INDEX.md docs/REQUEST_WORKFLOW_V2.md docs/REQUEST_CALCULATOR.md; do
  if [ -e "$required_path" ]; then
    detail_text "- $required_path: найдено."
  else
    STRUCTURE_STATUS="есть замечания"
    add_important "Не найден обязательный файл или каталог: \`$required_path\`."
    detail_text "- $required_path: НЕ НАЙДЕНО."
  fi
done

DOCUMENTATION_LOG="$WORK_DIR/documentation-consistency.log"
: >"$DOCUMENTATION_LOG"
if rg -n 'одна основная и одна дополнительная|одна дополнительная задача' --glob '*.md' --glob '!docs/DOCUMENTATION_AUDIT_*.md' . >"$DOCUMENTATION_LOG" 2>/dev/null; then
  STRUCTURE_STATUS="есть замечания"
  add_important "В активной документации найдена устаревшая модель одной дополнительной задачи."
fi
if rg -n '/Users/|file:///|localhost:[0-9]+/Users/' --glob '*.md' . >>"$DOCUMENTATION_LOG" 2>/dev/null; then
  STRUCTURE_STATUS="есть замечания"
  add_warning "В Markdown найдены абсолютные локальные ссылки."
fi
if ! rg -q '^PAYMENT_PROVIDER=tbank$' .env.production.example || ! rg -q '^TBANK_TERMINAL_MODE=live$' .env.production.example; then
  STRUCTURE_STATUS="есть замечания"
  add_important "Production example не отражает утверждённые T-Bank live flags."
fi
if [ -s "$DOCUMENTATION_LOG" ]; then
  append_log "Согласованность документации" "$DOCUMENTATION_LOG"
else
  detail_text "- Документационный индекс, workflow v2 wording, production flags и локальные ссылки: замечаний нет."
fi

for example_file in .env.production.example; do
  if [ ! -f "$example_file" ]; then
    STRUCTURE_STATUS="есть замечания"
    add_important "Не найден обязательный пример окружения: \`$example_file\`."
  else
    detail_text "- $example_file: найден."
  fi
done
for optional_example in .env.local.docker.example .env.tbank.test.example; do
  if [ -f "$optional_example" ]; then
    detail_text "- $optional_example: найден (необязательный)."
  else
    detail_text "- $optional_example: отсутствует (необязательный)."
  fi
done
for secret_file in .env .env.production backend/.env; do
  if [ -f "$secret_file" ]; then
    detail_text "- $secret_file: реальный env-файл существует; содержимое не читалось."
  else
    detail_text "- $secret_file: реальный env-файл отсутствует."
  fi
done

# 2. Git safety and ignore rules.
echo "[2/14] Git и опасные файлы"
detail_heading "Git и опасные файлы"
GIT_SHORT_FILE="$WORK_DIR/git-status.log"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -c core.quotePath=false status --short --untracked-files=all >"$GIT_SHORT_FILE" 2>&1
  append_log "git status --short" "$GIT_SHORT_FILE"
  while IFS= read -r status_line; do
    changed_path="${status_line:3}"
    changed_path="${changed_path##* -> }"
    case "$changed_path" in
      frontend/src/data|frontend/src/data/*) continue ;;
    esac
    case "/$changed_path/" in
      */.env/|*/.env.production/|*/.env.local/|*/backend/.env/|*.db/|*.sqlite/|*.sqlite3/|*/node_modules/*|*/dist/*|*/uploads/*|*/data/*|*/backups/*|*/.local-data/*|*/code-audit-reports/*|*/visual-audit/*|*/frontend-check-screenshots/*)
        GIT_STATUS="есть проблемы"
        add_critical "В \`git status --short\` виден опасный или локальный путь: \`$changed_path\`."
        ;;
    esac
  done <"$GIT_SHORT_FILE"

  TRACKED_DANGER_FILE="$WORK_DIR/tracked-danger.log"
  : >"$TRACKED_DANGER_FILE"
  while IFS= read -r tracked_path; do
    case "$tracked_path" in
      frontend/src/data|frontend/src/data/*) continue ;;
    esac
    case "/$tracked_path/" in
      */.env/|*/.env.production/|*/.env.local/|*/backend/.env/|*.db/|*.sqlite/|*.sqlite3/|*/node_modules/*|*/dist/*|*/uploads/*|*/data/*|*/backups/*|*/.local-data/*|*/code-audit-reports/*|*/visual-audit/*|*/frontend-check-screenshots/*)
        printf '%s\n' "$tracked_path" >>"$TRACKED_DANGER_FILE"
        ;;
    esac
  done < <(git ls-files)
  if [ -s "$TRACKED_DANGER_FILE" ]; then
    GIT_STATUS="есть проблемы"
    add_critical "Git уже отслеживает опасные или локальные файлы. См. технические детали."
    append_log "Опасные пути, уже отслеживаемые git" "$TRACKED_DANGER_FILE"
  fi
else
  GIT_STATUS="есть проблемы"
  add_critical "Папка команды не является git-репозиторием."
fi

if [ ! -f .gitignore ]; then
  GIT_STATUS="есть проблемы"
  add_critical "Файл \`.gitignore\` отсутствует."
else
  IGNORE_CHECKS_FILE="$WORK_DIR/gitignore-checks.log"
  : >"$IGNORE_CHECKS_FILE"
  for ignore_group in env database node_modules dist uploads data backups reports; do
    case "$ignore_group" in
      env) pattern='^\.env($|[[:space:]])|^\.env\.\*' ;;
      database) pattern='\*\.db|\*\.sqlite' ;;
      node_modules) pattern='node_modules' ;;
      dist) pattern='(^|/)dist/' ;;
      uploads) pattern='uploads/' ;;
      data) pattern='(^|/)data/' ;;
      backups) pattern='backups/' ;;
      reports) pattern='code-audit-reports|visual-audit|frontend-check-screenshots' ;;
    esac
    if grep -Eq "$pattern" .gitignore; then
      printf '%s: правило найдено\n' "$ignore_group" >>"$IGNORE_CHECKS_FILE"
    else
      GIT_STATUS="есть проблемы"
      add_important "В \`.gitignore\` не найдено правило для группы: $ignore_group."
      printf '%s: ПРАВИЛО НЕ НАЙДЕНО\n' "$ignore_group" >>"$IGNORE_CHECKS_FILE"
    fi
  done
  append_log "Проверка .gitignore" "$IGNORE_CHECKS_FILE"
fi

# 3. NPM checks. Root scripts already aggregate workspace checks, so do not duplicate successful work.
echo "[3/14] Build, lint, tests и typecheck"
detail_heading "Команды package.json"
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node -e 'const p=require("./package.json"); for (const [k,v] of Object.entries(p.scripts||{})) console.log(`- ${k}: ${v}`)' >>"$DETAIL_FILE" 2>/dev/null || true

  run_npm_check "Build (корень, backend + frontend)" "$PROJECT_DIR" build
  BUILD_STATUS="$LAST_CHECK_STATUS"

  if has_npm_script package.json lint; then
    run_npm_check "Lint (корень)" "$PROJECT_DIR" lint
    LINT_STATUS="$LAST_CHECK_STATUS"
  else
    LINT_STATUS="отсутствует"
    add_warning "NPM-скрипт \`lint\` отсутствует; отдельная lint-проверка не выполнена."
  fi

  run_npm_check "Tests (корень, backend + frontend)" "$PROJECT_DIR" test
  TEST_STATUS="$LAST_CHECK_STATUS"

  if has_npm_script package.json typecheck; then
    run_npm_check "Typecheck (корень)" "$PROJECT_DIR" typecheck
    TYPECHECK_STATUS="$LAST_CHECK_STATUS"
  elif has_npm_script package.json check; then
    run_npm_check "Typecheck/check (корень, backend + frontend)" "$PROJECT_DIR" check
    TYPECHECK_STATUS="$LAST_CHECK_STATUS"
  else
    TYPECHECK_STATUS="отсутствует"
    add_warning "NPM-скрипты \`typecheck\` и \`check\` отсутствуют."
  fi

  # Report workspace script coverage even when the root aggregate was used.
  for workspace in backend frontend; do
    for script_name in build lint test typecheck check; do
      if [ -f "$workspace/package.json" ] && has_npm_script "$workspace/package.json" "$script_name"; then
        detail_text "- $workspace: скрипт $script_name найден."
      fi
    done
  done
else
  BUILD_STATUS="ошибка"
  TEST_STATUS="ошибка"
  TYPECHECK_STATUS="ошибка"
  add_critical "Node.js или npm недоступны; build/tests/typecheck не выполнены."
fi

# 4. Docker build. Never run a container and never contact the server.
echo "[4/14] Docker build"
DOCKER_LOG="$WORK_DIR/docker-build.log"
if ! command -v docker >/dev/null 2>&1; then
  DOCKER_STATUS="ошибка"
  add_important "Docker не установлен; Docker build пропущен."
elif ! docker info >/dev/null 2>&1; then
  DOCKER_STATUS="ошибка"
  add_important "Docker Desktop недоступен или не запущен; Docker build пропущен."
else
  docker build -t zabota-code-audit-check . >"$DOCKER_LOG" 2>&1
  if [ "$?" -eq 0 ]; then
    DOCKER_STATUS="успешно"
  else
    DOCKER_STATUS="ошибка"
    add_critical "Docker image \`zabota-code-audit-check\` не собрался."
  fi
  append_log "Docker build — $DOCKER_STATUS" "$DOCKER_LOG"
fi

# 5. Read-only production server checks over SSH.
echo "[5/14] Production-сервер по SSH"
SSH_AUDIT_FILE="$WORK_DIR/production-ssh-audit.log"
if ! command -v ssh >/dev/null 2>&1; then
  PRODUCTION_SSH_STATUS="пропущено"
  add_warning "SSH-клиент не найден; серверные проверки пропущены."
else
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 "$PRODUCTION_SSH_HOST" "bash -s -- '$PRODUCTION_PATH'" >"$SSH_AUDIT_FILE" 2>&1 <<'REMOTE_AUDIT'
PRODUCTION_PATH="$1"

echo "=== df -h ==="
df -h
echo "opt_used_percent=$(df -P "$PRODUCTION_PATH" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"

echo "=== docker system df ==="
docker system df

echo "=== du -h --max-depth=2 $PRODUCTION_PATH ==="
du -h --max-depth=2 "$PRODUCTION_PATH" 2>&1 | sort -h | tail -n 80

echo "=== docker ps --filter name=zabota-web ==="
docker ps --filter name=zabota-web --format '{{.Names}} | {{.Status}} | {{.Image}}'
if docker ps --filter name=zabota-web --format '{{.Names}}' | grep -qx 'zabota-web'; then
  echo "container_running=yes"
else
  echo "container_running=no"
fi

echo "=== du -h /var/lib/docker/containers/*/*-json.log ==="
du -h /var/lib/docker/containers/*/*-json.log 2>&1
max_log_kb=$(find /var/lib/docker/containers -type f -name '*-json.log' -exec du -k {} \; 2>/dev/null | sort -nr | awk 'NR==1 {print $1}')
echo "max_docker_log_kb=${max_log_kb:-0}"

echo "=== docker logs --tail=120 zabota-web: pattern counts only ==="
production_logs="$(docker logs --tail=120 zabota-web 2>&1)"
logs_exit=$?
echo "docker_logs_exit=$logs_exit"
echo "log_error_count=$(printf '%s\n' "$production_logs" | grep -Eic 'error' || true)"
echo "log_failed_count=$(printf '%s\n' "$production_logs" | grep -Eic 'failed' || true)"
echo "log_not_found_count=$(printf '%s\n' "$production_logs" | grep -Eic 'not found' || true)"
echo "log_prisma_error_count=$(printf '%s\n' "$production_logs" | grep -Eic 'Prisma([^[:alnum:]]+.*)?error|Prisma error' || true)"
echo "log_legal_not_found_count=$(printf '%s\n' "$production_logs" | grep -Eic 'legal document not found|legal_document_not_found' || true)"
echo "log_customer_agreement_missing_count=$(printf '%s\n' "$production_logs" | grep -Eic 'customer_agreement.*(не найден|not found)|(не найден|not found).*customer_agreement' || true)"
REMOTE_AUDIT
  SSH_RESULT=$?

  if [ "$SSH_RESULT" -ne 0 ]; then
    PRODUCTION_SSH_STATUS="пропущено"
    add_warning "Не удалось подключиться к production по SSH (код $SSH_RESULT); серверные проверки пропущены."
    append_log "Production SSH — подключение не выполнено" "$SSH_AUDIT_FILE"
  else
    PRODUCTION_SSH_STATUS="успешно"
    append_log "Production SSH — место, контейнер и безопасная сводка логов" "$SSH_AUDIT_FILE"

    OPT_USED_PERCENT="$(sed -n 's/^opt_used_percent=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
    if [[ "$OPT_USED_PERCENT" =~ ^[0-9]+$ ]]; then
      if [ "$OPT_USED_PERCENT" -ge 90 ]; then
        add_critical "На filesystem production занято $OPT_USED_PERCENT%; свободное место критически заканчивается."
      elif [ "$OPT_USED_PERCENT" -ge 80 ]; then
        add_warning "На filesystem production занято $OPT_USED_PERCENT%; проверьте свободное место."
      fi
    fi

    if ! grep -q '^container_running=yes$' "$SSH_AUDIT_FILE"; then
      PRODUCTION_SSH_STATUS="ошибка"
      add_critical "Production-контейнер \`zabota-web\` не найден среди запущенных контейнеров."
    fi

    MAX_DOCKER_LOG_KB="$(sed -n 's/^max_docker_log_kb=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
    if [[ "$MAX_DOCKER_LOG_KB" =~ ^[0-9]+$ ]]; then
      if [ "$MAX_DOCKER_LOG_KB" -ge 1048576 ]; then
        add_important "Размер крупнейшего Docker JSON-лога превышает 1 ГБ (${MAX_DOCKER_LOG_KB} КБ)."
      elif [ "$MAX_DOCKER_LOG_KB" -ge 102400 ]; then
        add_warning "Размер крупнейшего Docker JSON-лога превышает 100 МБ (${MAX_DOCKER_LOG_KB} КБ)."
      fi
    fi

    LOGS_EXIT="$(sed -n 's/^docker_logs_exit=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
    if [ "$LOGS_EXIT" != "0" ]; then
      PRODUCTION_SSH_STATUS="ошибка"
      add_important "Не удалось прочитать последние 120 строк логов контейнера \`zabota-web\`."
    else
      LOG_ERROR_COUNT="$(sed -n 's/^log_error_count=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
      LOG_FAILED_COUNT="$(sed -n 's/^log_failed_count=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
      LOG_NOT_FOUND_COUNT="$(sed -n 's/^log_not_found_count=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
      LOG_PRISMA_COUNT="$(sed -n 's/^log_prisma_error_count=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
      LOG_LEGAL_COUNT="$(sed -n 's/^log_legal_not_found_count=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
      LOG_CUSTOMER_COUNT="$(sed -n 's/^log_customer_agreement_missing_count=//p' "$SSH_AUDIT_FILE" | tail -n 1)"
      if [ "${LOG_PRISMA_COUNT:-0}" -gt 0 ] || [ "${LOG_LEGAL_COUNT:-0}" -gt 0 ] || [ "${LOG_CUSTOMER_COUNT:-0}" -gt 0 ]; then
        PRODUCTION_SSH_STATUS="ошибка"
        add_critical "В последних 120 строках production-логов найдены Prisma/legal ошибки (Prisma: ${LOG_PRISMA_COUNT:-0}, legal document: ${LOG_LEGAL_COUNT:-0}, customer_agreement: ${LOG_CUSTOMER_COUNT:-0})."
      elif [ "${LOG_ERROR_COUNT:-0}" -gt 0 ] || [ "${LOG_FAILED_COUNT:-0}" -gt 0 ] || [ "${LOG_NOT_FOUND_COUNT:-0}" -gt 0 ]; then
        add_important "В последних 120 строках production-логов есть подозрительные записи (error: ${LOG_ERROR_COUNT:-0}, failed: ${LOG_FAILED_COUNT:-0}, not found: ${LOG_NOT_FOUND_COUNT:-0}). Сырые логи намеренно не добавлены в отчёт."
      fi
    fi
  fi
fi

# 6. Localhost and production runtime checks.
echo "[6/14] Localhost и production runtime"
LOCAL_HOME_STATUS="$(http_status 'http://localhost:4000/')"
if [ "$LOCAL_HOME_STATUS" = "000" ]; then
  LOCAL_STATUS="пропущено"
  detail_text "- Локальный сервер не запущен, runtime-проверки localhost пропущены."
else
  check_url_group "Localhost" \
    http://localhost:4000/ \
    http://localhost:4000/app \
    http://localhost:4000/api/health \
    http://localhost:4000/prices.html \
    http://localhost:4000/security.html \
    http://localhost:4000/contacts.html \
    http://localhost:4000/how-it-works.html \
    http://localhost:4000/legal.html
  if [ "$URL_FAILURES" -eq 0 ]; then
    LOCAL_STATUS="успешно"
  else
    LOCAL_STATUS="ошибка"
    add_important "Локальный сервер отвечает, но $URL_FAILURES обязательных URL вернули ошибку."
  fi
fi

check_url_group "Production HTTPS" \
  https://zabota-ugorsk.ru/ \
  https://zabota-ugorsk.ru/app \
  https://zabota-ugorsk.ru/api/health \
  https://zabota-ugorsk.ru/prices.html \
  https://zabota-ugorsk.ru/security.html \
  https://zabota-ugorsk.ru/contacts.html \
  https://zabota-ugorsk.ru/how-it-works.html \
  https://zabota-ugorsk.ru/legal.html
PRODUCTION_URL_FAILURES="$URL_FAILURES"
if [ "$URL_FAILURES" -gt 0 ]; then
  PRODUCTION_STATUS="ошибка"
  add_critical "Production HTTPS: $URL_FAILURES обязательных URL не отвечают успешно."
  check_url_group "Production HTTP fallback" \
    http://zabota-ugorsk.ru/ \
    http://zabota-ugorsk.ru/app \
    http://zabota-ugorsk.ru/api/health
fi

detail_heading "HTTP-проверки ключевого содержимого"
if [ "$LOCAL_STATUS" != "пропущено" ]; then
  check_content_marker "Localhost: главная содержит «Забота Рядом»" "http://localhost:4000/" 'Забота Рядом'
  [ "$CONTENT_CHECK_RESULT" = "успешно" ] || add_important "Localhost: главная страница не содержит ключевой текст «Забота Рядом»."
  check_content_marker "Localhost: /app содержит оболочку приложения" "http://localhost:4000/app" 'id=["'"'"']root["'"'"']|приложени'
  [ "$CONTENT_CHECK_RESULT" = "успешно" ] || add_important "Localhost: /app не содержит ожидаемую оболочку приложения."
  check_content_marker "Localhost: /api/health возвращает status ok" "http://localhost:4000/api/health" '"status"[[:space:]]*:[[:space:]]*"ok"'
  [ "$CONTENT_CHECK_RESULT" = "успешно" ] || add_important "Localhost: /api/health не вернул \`status: ok\`."
  check_index_html_runtime "Localhost" "http://localhost:4000/index.html"
fi

check_content_marker "Production: главная содержит «Забота Рядом»" "https://zabota-ugorsk.ru/" 'Забота Рядом'
if [ "$CONTENT_CHECK_RESULT" != "успешно" ] && [ "$PRODUCTION_URL_FAILURES" -eq 0 ]; then
  PRODUCTION_STATUS="ошибка"
  add_critical "Production: главная страница не содержит ключевой текст «Забота Рядом»."
fi
check_content_marker "Production: /app содержит оболочку приложения" "https://zabota-ugorsk.ru/app" 'id=["'"'"']root["'"'"']|приложени'
if [ "$CONTENT_CHECK_RESULT" != "успешно" ] && [ "$PRODUCTION_URL_FAILURES" -eq 0 ]; then
  PRODUCTION_STATUS="ошибка"
  add_critical "Production: /app не содержит ожидаемую оболочку приложения."
fi
check_content_marker "Production: /api/health возвращает status ok" "https://zabota-ugorsk.ru/api/health" '"status"[[:space:]]*:[[:space:]]*"ok"'
if [ "$CONTENT_CHECK_RESULT" != "успешно" ] && [ "$PRODUCTION_URL_FAILURES" -eq 0 ]; then
  PRODUCTION_STATUS="ошибка"
  add_critical "Production: /api/health не вернул \`status: ok\`."
fi
check_index_html_runtime "Production" "https://zabota-ugorsk.ru/index.html"

# Probe legal endpoints, validate real JSON keys and never include response bodies in the report.
LEGAL_RUNTIME_LOG="$WORK_DIR/legal-runtime.log"
: >"$LEGAL_RUNTIME_LOG"
if [ "$LOCAL_STATUS" != "пропущено" ]; then
  check_legal_api_base "http://localhost:4000" "Localhost" "important"
fi
if [ "$PRODUCTION_URL_FAILURES" -eq 0 ]; then
  check_legal_api_base "https://zabota-ugorsk.ru" "Production" "critical"
else
  detail_text "- Production legal API: проверка содержимого невозможна из-за недоступности production URL."
fi
append_log "Runtime legal API (тела ответов не сохранялись)" "$LEGAL_RUNTIME_LOG"

# 7. Links and routes.
echo "[7/14] Ссылки и маршруты"
if record_search "Ссылки на index.html в UI" '(^|["'"'"'=:([:space:]])(/?index\.html|https?://zabota-ugorsk\.ru/index\.html)' landing-public frontend/src -g '!**/tests/**'; then
  LINKS_STATUS="есть проблемы"
  INDEX_LINKS_FOUND=1
  add_important "В UI/source найдены ссылки на \`index.html\`; главная должна вести на \`/\`."
fi
if record_search "Старые пути, используемые как UI-ссылки" '(href|to)=["'"'"']/(client|performer|admin)([/"'"'"']|$)|navigate\(["'"'"']/(client|performer|admin)([/"'"'"']|$)|location\.(href|assign|replace)[[:space:]]*[=(][[:space:]]*["'"'"']/(client|performer|admin)([/"'"'"']|$)' landing-public frontend/src -g '!api/client.ts' -g '!**/tests/**'; then
  LINKS_STATUS="есть проблемы"
  add_warning "Найдены UI-ссылки на старые пути \`/client\`, \`/performer\` или \`/admin\`; основные ссылки должны использовать \`/app/...\`."
fi
record_search "Старые маршруты-редиректы (допустимо)" 'path=["'"'"']/(client|performer|admin)|pathname.*["'"'"']/(client|performer|admin)' frontend/src/App.tsx frontend/src/routes/navigation.ts >/dev/null || true

# 8. Legal document key consistency.
echo "[8/14] Юридические документы"
detail_heading "Юридические документы — статическая сверка ключей"
LEGAL_KEYS="privacy personal_data_consent customer_agreement helper_terms service_notifications_consent marketing_notifications_consent helper_documents_consent service_rules"
for legal_key in $LEGAL_KEYS; do
  frontend_hits="$(safe_rg -l "$legal_key" frontend/src | tr '\n' ' ')"
  backend_hits="$(safe_rg -l "$legal_key" backend/prisma/seed.ts backend/src | tr '\n' ' ')"
  if [ -n "$frontend_hits" ]; then frontend_result="есть"; else frontend_result="НЕТ"; fi
  if [ -n "$backend_hits" ]; then backend_result="есть"; else backend_result="НЕТ"; fi
  detail_text "- \`$legal_key\`: frontend — $frontend_result; backend seed/bootstrap/service — $backend_result."
  if [ -z "$frontend_hits" ]; then
    LEGAL_STATUS="есть проблемы"
    add_important "Legal key \`$legal_key\` не найден во frontend."
  fi
  if [ -z "$backend_hits" ]; then
    LEGAL_STATUS="есть проблемы"
    if [ "$legal_key" = "customer_agreement" ]; then
      add_critical "Backend seed/bootstrap/service не содержит обязательный документ \`customer_agreement\`; это может блокировать регистрацию."
    else
      add_important "Legal key \`$legal_key\` не найден в backend seed/bootstrap/service."
    fi
  fi
done
record_search "Варианты legal key и возможные переименования" 'customer_agreement|customer-agreement|customerAgreement|helper_terms|helper-terms|service_rules|service-rules' frontend/src backend/src backend/prisma >/dev/null || true

# 9. Registration contract checks.
echo "[9/14] Регистрация"
detail_heading "Регистрация — frontend/backend contract"
if [ ! -f backend/src/routes/auth.ts ]; then
  REGISTRATION_STATUS="есть проблемы"
  add_critical "Backend-файл маршрута регистрации \`backend/src/routes/auth.ts\` не найден."
elif ! rg -Uq 'authRouter\.post\([[:space:]\n]*["'"'"']/register["'"'"']' backend/src/routes/auth.ts; then
  REGISTRATION_STATUS="есть проблемы"
  add_critical "Backend endpoint регистрации \`POST /register\` не найден статическим анализом."
else
  detail_text "- Backend endpoint POST /register: найден."
fi

if [ ! -f frontend/src/pages/LandingAuthPage.tsx ]; then
  REGISTRATION_STATUS="есть проблемы"
  add_critical "Frontend-форма регистрации не найдена."
else
  detail_text "- Frontend-форма регистрации: найдена."
fi

for registration_field in role phone password displayName cityId acceptedLegalDocumentTypes; do
  if rg -q "${registration_field}" backend/src/routes/auth.ts frontend/src/pages/LandingAuthPage.tsx frontend/src/api/client.ts 2>/dev/null; then
    detail_text "- Поле \`$registration_field\`: найдено в registration-коде."
  else
    REGISTRATION_STATUS="есть проблемы"
    add_critical "Поле регистрации \`$registration_field\` не найдено в frontend/backend contract."
  fi
done

for registration_check in confirmPassword normalizedPhone marketingNotificationsAccepted dependentDataTransferConfirmed helperNotEmployerAcknowledged helperNoMedicalServicesConfirmed; do
  if rg -q "$registration_check" frontend/src/pages/LandingAuthPage.tsx backend/src/routes/auth.ts 2>/dev/null; then
    detail_text "- Проверка/поле \`$registration_check\`: найдено."
  else
    REGISTRATION_STATUS="есть проблемы"
    add_important "Проверка или поле регистрации \`$registration_check\` не найдено."
  fi
done

if rg -q 'email: z\.string\(\)\.email\(\)\.optional\(\)\.or\(z\.literal\(""\)\)' backend/src/routes/auth.ts 2>/dev/null && \
   rg -q 'trimmedEmail.*\|\| undefined|email: input\.email \|\| null' frontend/src/pages/LandingAuthPage.tsx backend/src/routes/auth.ts 2>/dev/null; then
  detail_text "- Email: статически выглядит необязательным; пустое значение нормализуется."
else
  REGISTRATION_STATUS="есть проблемы"
  add_important "Не удалось подтвердить статически, что email необязателен и пустой email корректно обрабатывается."
fi
if ! rg -q 'password: z\.string\(\)\.min\(8\)' backend/src/routes/auth.ts 2>/dev/null; then
  REGISTRATION_STATUS="есть проблемы"
  add_important "Backend не содержит ожидаемое ограничение пароля минимум 8 символов."
fi
if ! rg -q 'navigate|window\.location|redirect|/app/' frontend/src/context/AuthContext.tsx frontend/src/pages/LandingAuthPage.tsx frontend/src/App.tsx 2>/dev/null; then
  REGISTRATION_STATUS="есть проблемы"
  add_warning "Не удалось подтвердить редирект после регистрации; требуется ручная проверка."
fi
add_manual "Зарегистрировать нового Заказчика только с телефоном (без email), городом и обязательными согласиями."
add_manual "Зарегистрировать нового Помощника и проверить редирект, вход и отображение профиля."
add_manual "Повторить регистрацию с уже существующим телефоном и убедиться, что ошибка понятна."

# 10. Cities.
echo "[10/14] Список городов"
detail_heading "Города"
CITY_SOURCE="frontend/src/data/russianCities.ts"
if [ ! -f "$CITY_SOURCE" ]; then
  CITIES_STATUS="есть проблемы"
  add_important "Отдельный frontend-файл списка городов не найден: \`$CITY_SOURCE\`."
else
  detail_text "- Файл списка городов найден: $CITY_SOURCE."
  for city_name in Югорск Советский Москва Санкт-Петербург Сургут Ханты-Мансийск; do
    if rg -q "$city_name" "$CITY_SOURCE"; then
      detail_text "- $city_name: найден."
    else
      CITIES_STATUS="есть проблемы"
      add_important "В списке городов не найден: $city_name."
    fi
  done
fi
if ! rg -q 'toLocaleLowerCase|toLowerCase' frontend/src/components/CityCombobox.tsx backend/src/services/cityDirectory.ts 2>/dev/null; then
  CITIES_STATUS="есть проблемы"
  add_important "Не удалось подтвердить регистронезависимый поиск города."
fi
if ! rg -qi 'не найден|ничего не найдено|города не найдены' frontend/src/components/CityCombobox.tsx 2>/dev/null; then
  CITIES_STATUS="есть проблемы"
  add_warning "В компоненте выбора города не найдено понятное сообщение об отсутствии результатов."
fi

# 11. Forbidden UI terms, demo data and legacy content.
echo "[11/14] Терминология и demo-данные"
FORBIDDEN_PATTERN='комиссия|исполнитель|клиент|работник|трудоустроим|медицинские услуги|патронаж|медуслуги|медсестра'
if record_search "Запрещённые слова в UI/user-facing source" "$FORBIDDEN_PATTERN" landing-public frontend/src backend/src -g '!**/tests/**'; then
  TERMS_STATUS="есть проблемы"
  add_important "В UI или user-facing исходниках найдены запрещённые слова; технические role/type имена нужно отличить вручную от видимого текста."
fi
if record_search "Запрещённые слова в docs (предупреждение)" "$FORBIDDEN_PATTERN" docs README.md '*.md'; then
  add_warning "Запрещённые термины найдены в документации; это предупреждение, если они не попадают в UI."
fi

DEMO_PATTERN='admin@zabota\.local|client@zabota\.local|performer2?@zabota\.local|password123|Demo seed|Running seed once'
if record_search "Demo-логины и старые тестовые данные" "$DEMO_PATTERN" frontend/src landing-public backend/src backend/prisma docs README.md; then
  if safe_rg "$DEMO_PATTERN" frontend/src landing-public -g '!**/tests/**' | grep -q .; then
    add_critical "Demo-логины или тестовые пароли найдены в runtime/UI source; проверьте, что они не отображаются в production."
  else
    add_warning "Demo-данные найдены только в seed/docs; допустимо лишь при явном включении через \`SEED_DEMO_DATA=true\`."
  fi
fi
if rg -q 'SEED_DEMO_DATA' backend/prisma/seed.ts backend/prisma/seedDemo.ts scripts 2>/dev/null; then
  detail_text "- Ограничитель SEED_DEMO_DATA найден."
else
  add_important "Не найден защитный флаг \`SEED_DEMO_DATA\` рядом с demo seed."
fi

# 12. Payments, mock mode, balance and trial settings.
echo "[12/14] Оплата, баланс и пробный период"
detail_heading "Оплата и баланс"
for payment_marker in PAYMENT_PROVIDER mock tbank top-up/init mock/:id/succeed mock/:id/fail tbank/webhook; do
  if rg -q -F "$payment_marker" backend/src frontend/src .env.production.example 2>/dev/null; then
    detail_text "- $payment_marker: найдено."
  else
    add_important "В платёжном коде не найден маркер: \`$payment_marker\`."
  fi
done
if record_search "Потенциальные поля банковских реквизитов во frontend" '(name=|id=|placeholder=|useState\(|register\()[^\n]*(номер карты|CVV|CVC|SMS[- ]?код банка)|cardNumber|card_number' frontend/src -g '!**/tests/**'; then
  add_critical "Во frontend найдены поля/тексты банковских реквизитов. Сервис не должен сам собирать номер карты, CVV/CVC или SMS-код."
fi
if rg -qi 'mock|тестов(ая|ый|ое)|заглушк|демо' frontend/src/pages/PaymentPages.tsx frontend/src/components/BalancePanel.tsx 2>/dev/null; then
  detail_text "- В платёжном UI найдено обозначение mock/test режима."
else
  add_important "В платёжном UI не найдено явное предупреждение о mock/test режиме."
fi

for trial_key in TRIAL_BALANCE_ENABLED TRIAL_BALANCE_AMOUNT; do
  if rg -q "$trial_key" backend/src frontend/src backend/prisma .env.production.example 2>/dev/null; then
    detail_text "- $trial_key: реализован или описан."
  else
    add_warning "Невыполненная задача: настройка \`$trial_key\` не реализована."
  fi
done
if rg -q 'increment:' backend/src/services/balanceService.ts backend/src/services/paymentService.ts 2>/dev/null; then
  detail_text "- Начисление баланса: реализация найдена."
else
  add_important "Не удалось подтвердить возможность начислить баланс."
fi
if rg -q 'decrement:' backend/src/services/balanceService.ts backend/src/services/paymentService.ts 2>/dev/null; then
  detail_text "- Списание баланса: реализация найдена."
else
  add_important "Не удалось подтвердить возможность списать баланс."
fi
if rg -q 'balanceTransaction\.(findMany|create)|balance-transactions' backend/src frontend/src 2>/dev/null; then
  detail_text "- История операций: реализация найдена."
else
  add_important "Не удалось подтвердить историю операций баланса."
fi
if ! rg -qi 'trial|пробн' frontend/src/pages/AdminDashboard.tsx frontend/src/pages/AdminPaymentsPage.tsx 2>/dev/null; then
  add_warning "Не удалось подтвердить отображение пробного баланса в админке."
fi

# 13. Landing pages and content.
echo "[13/14] Страницы лендинга"
detail_heading "Страницы лендинга"
for landing_page in index.html prices.html payment.html refund.html security.html contacts.html faq.html how-it-works.html legal.html; do
  if [ -f "landing-public/$landing_page" ]; then
    detail_text "- landing-public/$landing_page: найден."
  else
    add_important "Не найдена страница лендинга \`landing-public/$landing_page\`."
  fi
done
MAIN_TEXT='Помогаем тем, кому нужна поддержка, и тем, кто готов помочь, договориться о бытовой помощи, сопровождении и уходе на дому в понятном и безопасном формате.'
if tr '\n' ' ' <landing-public/index.html 2>/dev/null | tr -s '[:space:]' ' ' | grep -Fq "$MAIN_TEXT"; then
  detail_text "- Актуальный главный текст найден дословно."
else
  add_important "На главной не найден дословно актуальный главный текст."
fi
record_search "Упоминания Югорска/Советского на лендинге" 'Югорск|Советский' landing-public >/dev/null && add_warning "На лендинге остались упоминания Югорска/Советского; проверьте, где их уже нужно убрать." || true
record_search "Телефонные номера на лендинге (сверить вручную)" '(\+7|8)[[:space:]()-]*[0-9][0-9[:space:]()-]{8,}' landing-public >/dev/null || true
record_search "Возможные склеенные русские слова" '[а-яё][А-ЯЁ][а-яё]' landing-public >/dev/null && add_warning "На лендинге найдены возможные склеенные слова; проверьте найденные строки вручную." || true

# 14. Production env example and CORS safety.
echo "[14/14] CORS и production env example"
detail_heading "Production env example"
if [ -f .env.production.example ]; then
  for env_key in CORS_ORIGIN DATABASE_URL PAYMENT_PROVIDER TBANK_SUCCESS_URL TBANK_FAIL_URL TBANK_NOTIFICATION_URL VISIT_RECONCILIATION_ENABLED VISIT_RECONCILIATION_INTERVAL_MINUTES VISIT_RECONCILIATION_RUN_ON_STARTUP; do
    if grep -Eq "^[[:space:]]*${env_key}=" .env.production.example; then
      detail_text "- $env_key: найден."
    else
      add_important "В \`.env.production.example\` отсутствует ключ \`$env_key\`."
    fi
  done
  QUOTED_ENV_FILE="$WORK_DIR/quoted-env.log"
  grep -En '^[[:space:]]*(CORS_ORIGIN|DATABASE_URL|PAYMENT_PROVIDER|TBANK_SUCCESS_URL|TBANK_FAIL_URL|TBANK_NOTIFICATION_URL)=["'"'"'].*["'"'"'][[:space:]]*$' .env.production.example >"$QUOTED_ENV_FILE" || true
  if [ -s "$QUOTED_ENV_FILE" ]; then
    add_important "В \`.env.production.example\` значения Docker env-file заключены в кавычки; кавычки могут стать частью значения."
    append_log "Кавычки в production env example" "$QUOTED_ENV_FILE"
  fi
else
  add_important "Проверка CORS/env невозможна: \`.env.production.example\` отсутствует."
fi

if [ "$INDEX_LINKS_FOUND" -eq 1 ]; then
  add_manual "Открыть все найденные ссылки на index.html и заменить UI-ссылки на / после проверки редиректов."
fi
add_manual "Проверить в браузере принятие каждого legal document key для обеих ролей."
add_manual "Проверить, что mock-оплата явно обозначена как тестовая и не обещает банковское зачисление."
add_manual "После исправлений повторно запустить этот аудит и визуальный аудит."

# Final markdown report.
GIT_BRANCH="$(git branch --show-current 2>/dev/null || printf 'не определена')"
GIT_COMMIT="$(git log -1 --pretty='%h %s' 2>/dev/null || printf 'не определён')"
REPORT_DATE="$(date '+%Y-%m-%d %H:%M:%S %Z')"

{
  printf '# Аудит кода «Забота Рядом»\n\n'
  printf '**Дата:** %s  \n' "$REPORT_DATE"
  printf '**Ветка git:** %s  \n' "$GIT_BRANCH"
  printf '**Последний commit:** %s  \n' "$GIT_COMMIT"
  printf '**Проверяемая папка:** `%s`\n\n' "$PROJECT_DIR"
  printf '## 1. Краткий итог\n\n'
  printf 'Статусы:\n\n'
  printf -- '- Структура проекта: %s\n' "$STRUCTURE_STATUS"
  printf -- '- Git и опасные файлы: %s\n' "$GIT_STATUS"
  printf -- '- Build: %s\n' "$BUILD_STATUS"
  printf -- '- Lint: %s\n' "$LINT_STATUS"
  printf -- '- Tests: %s\n' "$TEST_STATUS"
  printf -- '- Typecheck: %s\n' "$TYPECHECK_STATUS"
  printf -- '- Docker build: %s\n' "$DOCKER_STATUS"
  printf -- '- Production SSH: %s\n' "$PRODUCTION_SSH_STATUS"
  printf -- '- Localhost runtime: %s\n' "$LOCAL_STATUS"
  printf -- '- Production runtime: %s\n' "$PRODUCTION_STATUS"
  printf -- '- Регистрация: %s\n' "$REGISTRATION_STATUS"
  printf -- '- Юридические документы: %s\n' "$LEGAL_STATUS"
  printf -- '- Города: %s\n' "$CITIES_STATUS"
  printf -- '- Запрещённые слова: %s\n' "$TERMS_STATUS"
  printf -- '- Ссылки: %s\n\n' "$LINKS_STATUS"
  printf '**Счётчики:** критичные — %s, важные — %s, предупреждения — %s.\n\n' "$CRITICAL_COUNT" "$IMPORTANT_COUNT" "$WARNING_COUNT"
  printf '## 2. Критичные проблемы\n\n'
  if [ -s "$CRITICAL_FILE" ]; then cat "$CRITICAL_FILE"; else printf 'Критичных проблем не найдено.\n'; fi
  printf '\n## 3. Важные замечания\n\n'
  if [ -s "$IMPORTANT_FILE" ]; then cat "$IMPORTANT_FILE"; else printf 'Важных замечаний не найдено.\n'; fi
  printf '\n## 4. Предупреждения\n\n'
  if [ -s "$WARNING_FILE" ]; then cat "$WARNING_FILE"; else printf 'Предупреждений нет.\n'; fi
  printf '\n## 5. Что проверить вручную\n\n'
  cat "$MANUAL_FILE"
  printf '\n## 6. Технические детали\n'
  cat "$DETAIL_FILE"
  printf '\n---\n\nАудит выполнял только чтение, HTTP GET/HEAD-проверки, read-only SSH-команды и локальные build/test-команды. База данных и production-сервер не изменялись. Docker image был только собран, контейнер не запускался. Сырые production-логи не сохранялись в отчёт.\n'
} >"$REPORT_FILE"

echo
echo "Аудит кода завершён."
echo "Критичные проблемы: $CRITICAL_COUNT"
echo "Важные замечания: $IMPORTANT_COUNT"
echo "Предупреждения: $WARNING_COUNT"
echo "Отчёт сохранён: $REPORT_FILE"
if [ "$CRITICAL_COUNT" -eq 0 ]; then
  echo "Критичных проблем не найдено."
else
  echo "Найдены критичные проблемы. Откройте отчёт перед следующим деплоем."
fi

pause_at_end
exit 0
