#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_DIR="$(pwd -P)"
IMAGE_NAME="zabota-web-service-local"
CONTAINER_NAME="zabota-web-local"
LEGACY_CONTAINER_NAME="zabota-ryadom-local"
ENV_FILE=".env.local.docker"
ENV_EXAMPLE_FILE=".env.local.docker.example"
DATA_DIR="$PROJECT_DIR/.local-data"
PORT="${PORT:-4000}"
OPEN_BROWSER="${OPEN_BROWSER:-true}"

pause_if_interactive() {
  if [ -t 0 ]; then
    read -r -p "Нажмите Enter, чтобы закрыть окно."
  fi
}

fail() {
  echo "Ошибка: $1"
  pause_if_interactive
  exit 1
}

env_value_is_set() {
  local variable_name="$1"
  grep -Eq "^[[:space:]]*${variable_name}=[[:space:]]*[^[:space:]].*$" "$ENV_FILE"
}

echo "Забота Рядом 2.0: локальный запуск через Docker"
echo "Папка проекта: $PROJECT_DIR"

command -v docker >/dev/null 2>&1 || fail "Docker не найден. Установите Docker Desktop и повторите запуск."
docker info >/dev/null 2>&1 || fail "Docker Desktop не запущен. Запустите Docker Desktop и повторите запуск."

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$ENV_EXAMPLE_FILE" ] || fail "Файл $ENV_EXAMPLE_FILE не найден."
  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  echo "Создан $ENV_FILE из $ENV_EXAMPLE_FILE."
  echo "Заполните PRODUCTION_ADMIN_EMAIL, PRODUCTION_ADMIN_PASSWORD и PRODUCTION_ADMIN_PHONE, затем запустите файл ещё раз."
  pause_if_interactive
  exit 1
fi

chmod 600 "$ENV_FILE"

SEED_DEMO_DATA_VALUE="$(sed -n 's/^[[:space:]]*SEED_DEMO_DATA[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d '\r')"
# The local development image always includes frontend-only visual audit routes.
# Production builds keep Dockerfile's safe default: false.
VISUAL_AUDIT_ROUTES_VALUE="true"
if [ "$SEED_DEMO_DATA_VALUE" != "true" ]; then
  env_value_is_set "PRODUCTION_ADMIN_EMAIL" || fail "В $ENV_FILE не заполнен PRODUCTION_ADMIN_EMAIL."
  env_value_is_set "PRODUCTION_ADMIN_PASSWORD" || fail "В $ENV_FILE не заполнен PRODUCTION_ADMIN_PASSWORD."
  env_value_is_set "PRODUCTION_ADMIN_PHONE" || fail "В $ENV_FILE не заполнен PRODUCTION_ADMIN_PHONE."
fi

echo "Останавливаю и удаляю старый локальный контейнер..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm -f "$LEGACY_CONTAINER_NAME" >/dev/null 2>&1 || true

mkdir -p "$DATA_DIR"

RESET_LOCAL_DB=""
read -r -p "Очистить локальную базу перед запуском? y/N " RESET_LOCAL_DB || true
if [[ "$RESET_LOCAL_DB" =~ ^[Yy]$ ]]; then
  rm -f \
    "$DATA_DIR/zabota.db" \
    "$DATA_DIR/zabota.db-journal" \
    "$DATA_DIR/zabota.db-wal" \
    "$DATA_DIR/zabota.db-shm"
  echo "Локальная база очищена."
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Порт $PORT уже занят другим процессом. Остановите его или измените PORT."
fi

echo "Собираю свежий Docker image $IMAGE_NAME из текущего кода..."
echo "Локальные visual audit routes: $VISUAL_AUDIT_ROUTES_VALUE"
docker build \
  --build-arg VITE_ENABLE_VISUAL_AUDIT_ROUTES="$VISUAL_AUDIT_ROUTES_VALUE" \
  -t "$IMAGE_NAME" \
  .

echo "Запускаю контейнер $CONTAINER_NAME на порту $PORT..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "$PORT:$PORT" \
  --env-file "$ENV_FILE" \
  -e PORT="$PORT" \
  -e DEMO_MODE=true \
  -v "$DATA_DIR:/data" \
  "$IMAGE_NAME" >/dev/null

cleanup() {
  echo ""
  echo "Останавливаю $CONTAINER_NAME..."
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Жду готовности приложения..."
APPLICATION_READY=false
for _ in {1..60}; do
  if ! docker ps --filter "name=^/${CONTAINER_NAME}$" --filter 'status=running' --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    docker logs "$CONTAINER_NAME" || true
    fail "Контейнер $CONTAINER_NAME остановился во время запуска."
  fi
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    APPLICATION_READY=true
    break
  fi
  sleep 1
done

if [ "$APPLICATION_READY" != "true" ]; then
  docker logs "$CONTAINER_NAME" || true
  fail "Приложение не ответило на /api/health за 60 секунд."
fi

docker ps --filter "name=^/${CONTAINER_NAME}$" --filter 'status=running' --format '{{.Names}}' | grep -qx "$CONTAINER_NAME" || fail "Контейнер $CONTAINER_NAME не работает."
curl -fsS "http://localhost:$PORT/api/health" >/dev/null || fail "Не отвечает /api/health."
curl -fsS -o /dev/null "http://localhost:$PORT/" || fail "Не отвечает лендинг /."
curl -fsS -o /dev/null "http://localhost:$PORT/app" || fail "Не отвечает приложение /app."
if [ "$VISUAL_AUDIT_ROUTES_VALUE" = "true" ]; then
  curl -fsS -o /dev/null "http://localhost:$PORT/app/audit/client" || fail "Не отвечает audit route Заказчика."
  curl -fsS -o /dev/null "http://localhost:$PORT/app/audit/performer" || fail "Не отвечает audit route Помощника."
  curl -fsS -o /dev/null "http://localhost:$PORT/app/audit/admin" || fail "Не отвечает audit route админки."
fi

echo ""
echo "Локальный запуск выполнен успешно."
echo "Лендинг: http://localhost:$PORT/"
echo "Приложение: http://localhost:$PORT/app"
if [ "$VISUAL_AUDIT_ROUTES_VALUE" = "true" ]; then
  echo "Audit routes: http://localhost:$PORT/app/audit/client, /performer, /admin"
fi

if [ "$OPEN_BROWSER" = "true" ]; then
  open "http://localhost:$PORT/"
fi

echo "Для остановки закройте это окно, нажмите Ctrl+C или запустите stop-zabota-local.command."
docker logs -f "$CONTAINER_NAME"
