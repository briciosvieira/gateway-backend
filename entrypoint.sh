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

echo "Running Prisma migrations..."

npx prisma migrate deploy

echo "Prisma migrations completed."

echo "Starting Gateway Hub LF..."

exec npm run start:prod

echo "Gateway Hub started."