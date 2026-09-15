#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
umask 077
mkdir -p backup
backup_file="backup/crypto-agent-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$backup_file"
printf 'Backup written to %s\n' "$backup_file"
