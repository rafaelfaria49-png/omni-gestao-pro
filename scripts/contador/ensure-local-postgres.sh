#!/usr/bin/env bash
# Sobe Postgres local para a massa HOMOLOGACAO do Contador.
# Preferência: Docker Compose (porta 54329, dados tmpfs).
# Fallback: PostgreSQL nativo em 127.0.0.1 (porta 5432) com role/db dedicados.
# Nunca toca Production. Nunca chama SEFAZ.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE="$ROOT/docker-compose.contador-fiscal-homolog.yml"
ROLE="omni_homolog"
PASS="omni_homolog_local_only"
DB="omni_contador_fiscal_homolog"

if command -v docker >/dev/null 2>&1; then
  echo "[contador-homolog] Docker encontrado — compose em 127.0.0.1:54329"
  docker compose -f "$COMPOSE" up -d
  echo "CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL=postgresql://${ROLE}:${PASS}@127.0.0.1:54329/${DB}"
  exit 0
fi

echo "[contador-homolog] Docker ausente — fallback PostgreSQL nativo em 127.0.0.1:5432"

if ! command -v psql >/dev/null 2>&1; then
  echo "[contador-homolog] instalando postgresql via apt"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

sudo systemctl start postgresql 2>/dev/null || sudo service postgresql start 2>/dev/null || true

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN
    CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB} OWNER ${ROLE}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB}')\gexec
ALTER DATABASE ${DB} OWNER TO ${ROLE};
GRANT ALL PRIVILEGES ON DATABASE ${DB} TO ${ROLE};
SQL

echo "CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL=postgresql://${ROLE}:${PASS}@127.0.0.1:5432/${DB}"
echo "[contador-homolog] exporte a URL acima antes de npm run contador:fiscal-homolog:provision"
