#!/bin/sh
# Reproduz o que o Docker faz, na mesma ordem, e valida o resultado.
# Rode antes de todo push que mexa no servidor.
#
# Existe porque nenhuma validação anterior provava que o build era
# utilizável: "npm run tsc" e "npm run build:server" usam configs
# diferentes, o cache incremental já retornou exit 0 sem emitir nada, e
# nenhum dos dois executava o JS compilado. Seis deploys quebrados vieram
# desse buraco.
set -e

echo "==> [1/5] limpando dist/ (invalida o cache incremental)"
rm -rf dist

echo "==> [2/5] typecheck completo (client + server)"
npx tsc -b --force

echo "==> [3/5] build do servidor, igual ao Dockerfile"
npm run build:server

echo "==> [4/5] conferindo o conteudo de dist/"
if [ ! -f dist/server/index.js ]; then
  echo "ERRO: dist/server/index.js nao existe — o build nao emitiu nada."
  echo "      (tipico de cache incremental stale: o tsc sai 0 sem compilar)"
  exit 1
fi

# Testes na imagem de producao importam vitest, que nao existe la
# (npm ci --omit=dev). Ja derrubou um deploy com TS1378.
if find dist -name "*.test.js" | grep -q .; then
  echo "ERRO: arquivos de teste vazaram para dist/:"
  find dist -name "*.test.js"
  echo "      confira o 'exclude' em tsconfig.server.json"
  exit 1
fi

# O alias so existe em compile-time; sobreviver no JS emitido significa
# MODULE_NOT_FOUND no boot (causa do 502 de 04/08/2026).
#
# Ignora linhas de comentario (// ...) antes de casar: varios arquivos
# CITAM "@shared" no comentario que explica justamente por que nao usar o
# alias, e isso nao pode disparar o alarme.
if grep -rn 'require("@shared' dist/ 2>/dev/null | grep -v '^\s*[^:]*:[0-9]*:\s*//' | grep -q .; then
  echo "ERRO: alias @shared nao resolvido no JS compilado:"
  grep -rn 'require("@shared' dist/ | grep -v '^\s*[^:]*:[0-9]*:\s*//'
  echo "      use import relativo (../../shared/...) em arquivos de servidor"
  exit 1
fi

echo "==> [5/5] smoke test: subindo o JS compilado de verdade"
sh scripts/smoke.sh

echo ""
echo "OK — pode dar push."
