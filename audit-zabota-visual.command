#!/bin/bash

# Read-only visual audit for the locally running "Забота Рядом" website.
# Compatible with the Bash version shipped with macOS.

set -u

cd "$(dirname "$0")" || exit 1

PROJECT_DIR="$(pwd -P)"
PROJECT_ROOT="$(cd "$PROJECT_DIR/.." && pwd -P)"
AUDITS_ROOT="$PROJECT_ROOT/audits"
TIMESTAMP="$(date '+%Y-%m-%d-%H%M%S')"
REPORT_DIR_BASE="$AUDITS_ROOT/visual/visual-audit-$TIMESTAMP"
REPORT_DIR="$REPORT_DIR_BASE"
REPORT_SUFFIX=1
while [ -e "$REPORT_DIR" ]; do
  REPORT_DIR="$REPORT_DIR_BASE-$REPORT_SUFFIX"
  REPORT_SUFFIX=$((REPORT_SUFFIX + 1))
done
REPORT_FILE="$REPORT_DIR/visual-audit-report.md"
SCREENSHOT_DIR="$REPORT_DIR/screenshots"

pause_at_end() {
  if [ -t 0 ]; then
    read -r -p "Нажмите Enter для закрытия..."
  fi
}

mkdir -p "$AUDITS_ROOT" "$AUDITS_ROOT/visual" "$SCREENSHOT_DIR"

if ! command -v node >/dev/null 2>&1 || ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  cat >"$REPORT_FILE" <<EOF
# Визуальный аудит «Забота Рядом»

Дата: $(date '+%Y-%m-%d %H:%M:%S')
Проверяемая локальная версия: http://localhost:4000
Папка отчёта: $REPORT_DIR

## 1. Краткий итог

- Визуальный аудит: не выполнен.
- Причина: Playwright не найден.

## Проверенные страницы

- Главная: не выполнено
- Приложение /app: не выполнено
- Регистрация Заказчика: не выполнено
- Регистрация Помощника: не выполнено
- Цены: не выполнено
- Безопасность: не выполнено
- Контакты: не выполнено
- Как это работает: не выполнено
- Юридическая информация: не выполнено
- Кабинет Заказчика: не выполнено
- Кабинет Помощника: не выполнено
- Админка: не выполнено

## 2. Критичные визуальные проблемы

- Playwright не найден. Установите зависимости проекта и повторите запуск.

## 3. Важные замечания

- Нет.

## 4. Скриншоты

- Скриншоты не созданы.

## 5. Что проверить вручную

- Установить зависимости проекта и повторить аудит.
EOF
  echo "Playwright не найден. Установите зависимости проекта и повторите запуск."
  echo ""
  echo "Визуальный аудит завершён."
  echo "Критичные проблемы: 1"
  echo "Важные замечания: 0"
  echo "Скриншоты сохранены: $SCREENSHOT_DIR"
  echo "Отчёт сохранён: $REPORT_FILE"
  pause_at_end
  exit 1
fi

echo "Забота Рядом: визуальный аудит"
echo "Папка отчёта: $REPORT_DIR"
echo "Проверяю только локальную версию. Код и база не изменяются."
echo ""

node "$PROJECT_DIR/scripts/public-visual-audit.mjs" "$REPORT_DIR"
AUDIT_STATUS=$?

pause_at_end
exit "$AUDIT_STATUS"
