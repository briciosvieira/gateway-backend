#!/bin/sh
set -e

echo "Starting Gateway Hub backend..."

echo "Waiting for PostgreSQL..."

until nc -z -w30 postgres_db 5432
do
  echo "PostgreSQL not available yet..."
  sleep 2
done

echo "PostgreSQL available."

echo "Running Prisma migrations..."

npx prisma migrate deploy

echo "Prisma migrations completed."

echo "Running initial bootstrap (roles + administrator)..."

npx prisma db seed

echo "Initial bootstrap completed."

echo "Starting Gateway Hub..."

exec npm run start:prod