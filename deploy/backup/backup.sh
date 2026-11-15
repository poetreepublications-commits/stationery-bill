#!/bin/sh
# Daily backup: PostgreSQL dump + uploaded bilty photos. Keeps RETENTION_DAYS (default 30).
# Runs inside the "backup" container. Copy ./backups to off-server storage as well (see DEPLOY.md).
set -eu
RETENTION_DAYS="${RETENTION_DAYS:-30}"
while true; do
  STAMP=$(date +%Y%m%d-%H%M%S)
  pg_dump -h db -U poetree -d poetree | gzip > "/backups/db-${STAMP}.sql.gz"
  tar -czf "/backups/uploads-${STAMP}.tar.gz" -C / uploads 2>/dev/null || true
  find /backups -name 'db-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
  find /backups -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
  echo "backup done ${STAMP}"
  # sleep until the next 02:30
  NOW=$(date +%s); TARGET=$(date -d "tomorrow 02:30" +%s 2>/dev/null || date -d "02:30" +%s)
  sleep $(( TARGET - NOW > 0 ? TARGET - NOW : 86400 ))
done
