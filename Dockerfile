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

# node:20-slim não traz OpenSSL como pacote de sistema — o binary do
# Prisma (mesmo o 3.0.x, correto para Debian 12) precisa do libssl.so.3
# real instalado, não só o que o Node usa internamente.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

# Força o binary target correto DEPOIS do npm ci (que já rodou "prisma
# generate" via postinstall e criou os .so.node em node_modules/.prisma) —
# a auto-detecção do Prisma 5.22 nesta imagem (Debian 12/bookworm, só
# OpenSSL 3.x) tenta carregar o engine debian-openssl-1.1.x por padrão
# mesmo com o binary 3.0.x presente, então a variável é obrigatória.
# Definir isso ANTES do npm ci quebra o próprio "prisma generate", que
# tenta resolver esse caminho antes dele existir.
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

COPY --from=build /app/dist ./dist

# Roda como usuário sem privilégio — reduz o blast radius se o processo
# Node for comprometido (sem permissão para instalar pacotes, alterar
# arquivos de sistema, etc.). A aplicação não escreve em disco (uploads
# são multer.memoryStorage()), então não precisa de diretório gravável.
RUN groupadd -r appuser && useradd -r -g appuser appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 3333
CMD ["node", "dist/server/index.js"]
