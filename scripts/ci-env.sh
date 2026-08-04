#!/bin/sh
# Variáveis de ambiente falsas para rodar testes/smoke sem um .env real.
#
# src/server/config/env.ts valida tudo com zod e faz `throw` se faltar
# qualquer chave — e vários testes importam services que puxam
# config/prisma.ts -> config/env.ts na cadeia de import. Sem isto, 7 das
# 10 suítes falham no CI só por configuração, sem nenhum defeito real.
#
# Nada aqui toca banco ou serviço externo: os testes unitários são de
# funções puras (vitest.config.ts exclui os *.integration.test.ts), e o
# smoke só exercita /health, que não consulta o Postgres.
#
# Uso: `. scripts/ci-env.sh` (com ponto, para exportar no shell atual).
export NODE_ENV=production
export JWT_SECRET=ci-dummy
export DATABASE_URL=postgresql://u:p@127.0.0.1:5432/ci
export DIRECT_URL=postgresql://u:p@127.0.0.1:5432/ci
export DATABASE_URL_RESTRICTED=postgresql://u:p@127.0.0.1:5432/ci
export SUPABASE_URL=http://localhost
export SUPABASE_SERVICE_ROLE_KEY=ci-dummy
export SUPABASE_ANON_KEY=ci-dummy
export SMTP_HOST=localhost
export SMTP_USER=ci-dummy
export SMTP_PASSWORD=ci-dummy
export SMTP_FROM=ci@example.com
