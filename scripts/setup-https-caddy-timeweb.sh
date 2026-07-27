#!/usr/bin/env bash

set -Eeuo pipefail

DOMAIN="${ZABOTA_DOMAIN:-zabota-ugorsk.ru}"
EXPECTED_SERVER_IP="${ZABOTA_SERVER_IP:-104.171.139.243}"
CADDYFILE="/etc/caddy/Caddyfile"
LOCAL_HEALTH_URL="http://127.0.0.1:4000/api/health"
HTTPS_HEALTH_URL="https://${DOMAIN}/api/health"
TEMP_CADDYFILE=""

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

warn() {
  printf '\nWARNING: %s\n' "$*" >&2
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEMP_CADDYFILE" ] && [ -f "$TEMP_CADDYFILE" ]; then
    rm -f "$TEMP_CADDYFILE"
  fi
}
trap cleanup EXIT

[ "$(uname -s)" = "Linux" ] || fail "Скрипт предназначен только для Linux production-сервера."
[ "${EUID:-$(id -u)}" -eq 0 ] || fail "Запустите скрипт от root: sudo bash scripts/setup-https-caddy-timeweb.sh"

for command_name in apt-get curl getent systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Не найдена обязательная команда: $command_name"
done

log "Проверка локального приложения"
curl -fsS --max-time 10 "$LOCAL_HEALTH_URL" >/dev/null || fail \
  "Приложение не отвечает на $LOCAL_HEALTH_URL. Сначала запустите zabota-web с -p 127.0.0.1:4000:4000."

log "Проверка DNS для $DOMAIN"
DNS_IPS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
if [ -z "$DNS_IPS" ]; then
  warn "Не удалось получить IPv4-адрес домена. Сертификат не будет выдан, пока DNS не настроен."
elif printf '%s\n' "$DNS_IPS" | tr ' ' '\n' | grep -Fxq "$EXPECTED_SERVER_IP"; then
  printf 'DNS A: %s -> %s\n' "$DOMAIN" "$DNS_IPS"
else
  warn "DNS домена указывает на: $DNS_IPS; ожидаемый адрес сервера: $EXPECTED_SERVER_IP."
fi

if command -v ss >/dev/null 2>&1; then
  PORT_80_OWNER="$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$/ {print}' || true)"
  PORT_443_OWNER="$(ss -ltnp 2>/dev/null | awk '$4 ~ /:443$/ {print}' || true)"
  if [ -n "$PORT_80_OWNER" ] && ! printf '%s' "$PORT_80_OWNER" | grep -qi caddy; then
    fail "Порт 80 уже занят не Caddy. Убедитесь, что zabota-web опубликован только на 127.0.0.1:4000."
  fi
  if [ -n "$PORT_443_OWNER" ] && ! printf '%s' "$PORT_443_OWNER" | grep -qi caddy; then
    fail "Порт 443 уже занят другим процессом. Освободите порт перед настройкой Caddy."
  fi
fi

if ! command -v caddy >/dev/null 2>&1; then
  log "Установка Caddy из официального Debian/Ubuntu repository"
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https ca-certificates curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
else
  log "Caddy уже установлен: $(caddy version)"
fi

log "Проверка firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw status verbose || true
  if ufw status | grep -qi inactive; then
    warn "ufw не активен. Проверьте внешний firewall Timeweb для TCP 80 и 443."
  fi
else
  warn "ufw не установлен. Проверьте внешний firewall Timeweb для TCP 80 и 443."
fi

log "Подготовка и проверка $CADDYFILE"
TEMP_CADDYFILE="$(mktemp)"
cat >"$TEMP_CADDYFILE" <<EOF
${DOMAIN} {
    encode gzip

    reverse_proxy 127.0.0.1:4000

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
EOF
caddy fmt --overwrite "$TEMP_CADDYFILE"
caddy validate --config "$TEMP_CADDYFILE" --adapter caddyfile

install -d -m 0755 /etc/caddy
if [ -f "$CADDYFILE" ]; then
  BACKUP_PATH="${CADDYFILE}.backup.$(date '+%Y%m%d%H%M%S')"
  cp -a "$CADDYFILE" "$BACKUP_PATH"
  printf 'Предыдущая конфигурация сохранена: %s\n' "$BACKUP_PATH"
fi
install -m 0644 "$TEMP_CADDYFILE" "$CADDYFILE"
caddy validate --config "$CADDYFILE"

log "Запуск Caddy"
systemctl enable caddy >/dev/null
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl start caddy
fi
systemctl --no-pager --full status caddy

log "Ожидание HTTPS-сертификата и проверка health"
HTTPS_OK=false
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 15 "$HTTPS_HEALTH_URL" >/dev/null; then
    HTTPS_OK=true
    break
  fi
  printf 'Попытка %s/20: HTTPS пока не готов, повтор через 5 секунд.\n' "$attempt"
  sleep 5
done

if [ "$HTTPS_OK" != "true" ]; then
  journalctl -u caddy --no-pager -n 80 || true
  fail "HTTPS health не вернул 200: $HTTPS_HEALTH_URL"
fi

HTTP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://${DOMAIN}" || true)"
case "$HTTP_STATUS" in
  301|302|307|308) ;;
  *) warn "HTTP redirect вернул статус $HTTP_STATUS вместо 301/302/307/308." ;;
esac

log "HTTPS настроен"
printf 'Local health: %s\n' "$LOCAL_HEALTH_URL"
printf 'HTTPS health: %s\n' "$HTTPS_HEALTH_URL"
printf 'Caddyfile: %s\n' "$CADDYFILE"
printf 'HTTP redirect status: %s\n' "$HTTP_STATUS"
