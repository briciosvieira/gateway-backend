#!/bin/sh
set -e

echo "Starting Gateway Hub LF backend..."

echo "Waiting for PostgreSQL..."

until nc -z -w30 postgres_db 5432
do
  echo "PostgreSQL not available yet..."
  sleep 2
done

echo "PostgreSQL available."

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not configured."
  exit 1
fi

echo "DATABASE_URL configured."

echo "Running Prisma migrations..."

npx prisma migrate deploy --config=prisma.config.ts

echo "Prisma migrations completed."

echo "Starting Gateway Hub LF..."

exec npm run start:prod