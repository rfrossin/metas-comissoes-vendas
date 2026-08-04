#!/bin/sh
# Sobe o JS COMPILADO (o mesmo que o Docker roda) e exige HTTP 200 em
# /health. É o único passo da validação que executa o build de verdade —
# tsc e vitest passam sem nunca provar que o processo boota.
#
# Pega qualquer erro de módulo/import que só aparece em runtime. Foi
# exatamente esse buraco que deixou passar o MODULE_NOT_FOUND do alias
# @shared, que derrubou a produção em 04/08/2026.
set -e

PORT=3399
export PORT

# Env dummy: src/server/config/env.ts faz throw se faltar qualquer
# variável, então sem isso o processo morre por configuração e não por um
# problema real de build. Fonte única em ci-env.sh — duas listas
# separadas divergiriam na primeira variável nova.
. "$(dirname "$0")/ci-env.sh"
# dotenv/config carregaria o .env real por cima das variáveis acima —
# apontar para um caminho inexistente mantém o smoke isolado do ambiente
# local (e do banco de produção configurado nele).
export DOTENV_CONFIG_PATH=/nonexistent

node dist/server/index.js > /tmp/smoke.log 2>&1 &
PID=$!
# trap: mata o servidor aconteça o que acontecer — inclusive se o curl
# falhar ou o script for interrompido no meio.
trap 'kill $PID 2>/dev/null || true' EXIT

i=0
while [ $i -lt 30 ]; do
  # Checa se o processo morreu ANTES de tentar o curl: um crash no boot
  # daria "connection refused", que é indistinguível de "ainda subindo".
  if ! kill -0 $PID 2>/dev/null; then
    echo "ERRO: o servidor morreu durante o boot. Log:"
    cat /tmp/smoke.log
    exit 1
  fi

  if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "smoke OK — /health respondeu 200"
    exit 0
  fi

  sleep 1
  i=$((i + 1))
done

echo "ERRO: /health não respondeu em 30s. Log:"
cat /tmp/smoke.log
exit 1
