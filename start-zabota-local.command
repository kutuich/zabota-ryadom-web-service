#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="zabota-web-service"
CONTAINER_NAME="zabota-ryadom-local"
PORT="${PORT:-4000}"

cd "$PROJECT_DIR"

echo "Забота Рядом 2.0: локальный запуск через Docker"
echo "Папка проекта: $PROJECT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker не найден. Установите Docker Desktop и повторите запуск."
  read -r -p "Нажмите Enter, чтобы закрыть окно."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop не запущен. Запустите Docker Desktop и повторите запуск."
  read -r -p "Нажмите Enter, чтобы закрыть окно."
  exit 1
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "Контейнер уже запущен. Открываю приложение."
    open "http://localhost:$PORT"
    docker logs -f "$CONTAINER_NAME"
    exit 0
  fi
  echo "Порт $PORT уже занят другим процессом. Остановите его или измените PORT."
  read -r -p "Нажмите Enter, чтобы закрыть окно."
  exit 1
fi

if [ ! -f ".env.preview" ]; then
  if [ -f ".env.preview.example" ]; then
    cp ".env.preview.example" ".env.preview"
    echo "Создан .env.preview из .env.preview.example. Для публичного preview замените JWT_SECRET."
  else
    echo "Файл .env.preview.example не найден."
    read -r -p "Нажмите Enter, чтобы закрыть окно."
    exit 1
  fi
fi

echo "Собираю Docker-образ $IMAGE_NAME..."
docker build -t "$IMAGE_NAME" .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
echo "Запускаю контейнер $CONTAINER_NAME на порту $PORT..."
docker run -d --name "$CONTAINER_NAME" -p "$PORT:$PORT" --env-file ".env.preview" "$IMAGE_NAME" >/dev/null

cleanup() {
  echo ""
  echo "Останавливаю $CONTAINER_NAME..."
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

echo "Жду готовности приложения..."
for _ in {1..60}; do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Приложение запущено: http://localhost:$PORT"
    open "http://localhost:$PORT"
    break
  fi
  sleep 1
done

echo "Для остановки закройте это окно, нажмите Ctrl+C или запустите stop-zabota-local.command."
docker logs -f "$CONTAINER_NAME"
