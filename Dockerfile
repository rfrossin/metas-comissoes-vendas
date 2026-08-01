# Backend apenas — o frontend é build estático publicado na Vercel
# (vercel.json), não roda neste container.

FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig*.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
RUN npm run build:server

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Força o binary target correto — a auto-detecção do Prisma 5.22 nesta
# imagem (Debian 12/bookworm, só OpenSSL 3.x) tenta carregar o engine
# debian-openssl-1.1.x por padrão mesmo com os dois binaries presentes em
# node_modules/.prisma/client, então a variável abaixo é obrigatória, não
# apenas o binaryTargets no schema.
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3333
CMD ["node", "dist/server/index.js"]
