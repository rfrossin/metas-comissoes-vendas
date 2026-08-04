#!/bin/sh
# ESTE ARQUIVO É A REFERÊNCIA VERSIONADA DE /opt/metas/deploy.sh (VPS).
#
# Ele NÃO roda a partir do repositório: o que executa é a cópia em
# /opt/metas/deploy.sh no servidor, apontada pelo `command=` do
# authorized_keys. Mantemos a cópia aqui para o script ter histórico,
# revisão e um lugar de onde copiar quando precisar ser atualizado.
#
# Ao mudar este arquivo, replique no VPS (ver README no topo do commit
# "ci: tornar os deploys confiaveis").
set -e

cd /opt/metas

echo "==> sincronizando com o origin/main"
# "fetch + reset --hard" no lugar de "git pull": nunca gera "divergent
# branches" (3 dos 6 deploys quebrados), porque não tenta mesclar nada —
# apenas descarta o estado local e adota o que está no GitHub. O VPS só
# consome código, nunca produz commits, então não há o que perder.
git fetch origin main
git reset --hard origin/main

echo "==> commit em deploy: $(git rev-parse --short HEAD)"

echo "==> build e subida do container"
docker compose up --build -d

echo "==> aguardando o healthcheck ficar saudavel (ate 180s)"
# "docker compose up -d" retorna quando o container foi "Started" (<1s),
# NÃO quando está saudável. Sem este laço, um container em crashloop
# reportava deploy bem-sucedido e o GitHub Actions ficava verde com a API
# em 502 — foi assim que o incidente de 04/08/2026 passou despercebido.
#
# O healthcheck em si já existia no docker-compose.yml; só faltava
# alguém esperar por ele.
i=0
while [ $i -lt 180 ]; do
  CID=$(docker compose ps -q api)

  if [ -z "$CID" ]; then
    echo "ERRO: o container 'api' nao existe."
    docker compose logs --tail=50 api || true
    exit 1
  fi

  STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo "unknown")
  RUNNING=$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null || echo "false")

  if [ "$STATUS" = "healthy" ]; then
    echo "==> OK: container saudavel. Deploy concluido."
    exit 0
  fi

  # Container morto sai na hora: esperar 180s por algo que já morreu só
  # atrasa o feedback. Container vivo mas ainda não saudável continua
  # aguardando (build + migration do Prisma levam tempo).
  if [ "$RUNNING" != "true" ]; then
    echo "ERRO: o container morreu durante o boot (status: $STATUS)."
    echo "--- ultimas 80 linhas do log ---"
    docker compose logs --tail=80 api || true
    exit 1
  fi

  sleep 2
  i=$((i + 2))
done

echo "ERRO: o container nao ficou saudavel em 180s."
echo "--- ultimas 80 linhas do log ---"
docker compose logs --tail=80 api || true
exit 1
