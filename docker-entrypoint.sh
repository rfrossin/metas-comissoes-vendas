#!/bin/sh
# Aplica as migrations pendentes e só então sobe a API.
#
# "migrate deploy" (nunca "migrate dev"): aplica apenas migrations já
# versionadas, não gera nada e não oferece reset do banco. É o único
# comando do Prisma Migrate seguro para rodar contra produção.
#
# set -e: se a migration falhar, o container NÃO sobe. É deliberado —
# subir a API com o schema desatualizado produziria erros de coluna
# inexistente em cima de dados reais, o que é bem pior do que um deploy
# que falha visivelmente e mantém o container anterior no ar.
set -e

echo "[entrypoint] aplicando migrations pendentes..."
npx prisma migrate deploy

echo "[entrypoint] iniciando API..."
exec node dist/server/index.js
