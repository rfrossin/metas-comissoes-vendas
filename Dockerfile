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

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3333
CMD ["node", "dist/server/index.js"]
