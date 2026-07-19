# Production Checklist

- [ ] HTTPS включён.
- [ ] Домен открывает landing на `/`.
- [ ] `/app` открывает приложение.
- [ ] `/api/health` отдаёт JSON.
- [ ] `/legal/privacy` открывается.
- [ ] Старые PHP paths возвращают 404.
- [ ] `DATABASE_URL` указывает на persistent volume: `file:/data/zabota.db`.
- [ ] Uploads находятся на persistent volume.
- [ ] Перед production загрузками доработан `UPLOADS_DIR`, потому что текущий код пишет в `backend/uploads`.
- [ ] `JWT_SECRET` заменён на production secret.
- [ ] `PAYMENT_PROVIDER=mock`.
- [ ] T-Bank выключен.
- [ ] Demo/admin пароль нужно заменить.
- [ ] Есть backup перед обновлениями.
- [ ] Проверена регистрация заказчика.
- [ ] Проверена регистрация помощника.
- [ ] Проверен mock payment.
- [ ] Проверена админка платежей.
