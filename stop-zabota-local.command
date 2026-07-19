#!/bin/bash
set -euo pipefail

CONTAINER_NAME="zabota-web-local"

echo "Забота Рядом 2.0: остановка локального Docker preview"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker не найден."
  read -r -p "Нажмите Enter, чтобы закрыть окно."
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker stop "$CONTAINER_NAME" >/dev/null
  echo "Контейнер $CONTAINER_NAME остановлен."
else
  echo "Запущенный контейнер $CONTAINER_NAME не найден."
fi

read -r -p "Нажмите Enter, чтобы закрыть окно."
