# Импорт и экспорт структур категорий

> Статус: ACTIVE OPERATIONAL DOCUMENT.

## Фактический формат

JSON использует `version`, `scope`, `passport`, `categories`, `taskTemplates`, `safetyRules`, `pricingRules`. Excel содержит листы «Паспорт структуры», «Категории», «Типовые задачи», «Ограничения», «Рекомендуемые цены», «Инструкция».

Экспорт включает реальные поля category/task/safety/pricing models, в том числе `recommendedPackageCode`. Вычисляемые aliases публичного поиска и готовые expanded visits не экспортируются, потому что они не являются полями импортного контракта.

## Безопасный импорт

1. Выберите JSON/XLSX до 5 МБ.
2. Выполните preview и исправьте errors/warnings.
3. Создайте draft.
4. Проверьте четыре публичных направления, задачи, ограничения и prices.
5. Опубликуйте отдельным admin-действием.

Импорт никогда не редактирует active и не публикует автоматически. Повтор payload блокируется SHA-256 `importHash`. Документ со старыми публичными направлениями может быть импортирован только как draft и не должен публиковаться без ручной проверки.

## Validation

- `slug` lower-kebab-case и уникален;
- parent/category references существуют;
- `min <= max`, цены неотрицательны;
- status/severity/boolean значения валидны;
- запрещённые публичные и опасные формулировки отклоняются или отмечаются warning;
- preview показывает counts, errors и warnings.

После публикации новая заявка использует rules effective structure по [REQUEST_CALCULATOR.md](REQUEST_CALCULATOR.md). Старые snapshots сохраняют прежнюю версию.
