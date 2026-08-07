# ===============================
# Stage 1 - Build
# ===============================

FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build


# ===============================
# Stage 2 - Runtime
# ===============================

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3110

RUN apk add --no-cache libc6-compat

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

EXPOSE 3110

ENTRYPOINT ["/app/entrypoint.sh"]