#!/bin/sh
set -eu

exec node /app/backend/dist/src/scripts/resetSuperadminPassword.js "$@"
