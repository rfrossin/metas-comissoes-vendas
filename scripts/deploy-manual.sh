#!/bin/sh
# DEPLOY MANUAL DO BACKEND (VPS), sem passar pelo GitHub Actions.
#
# Use quando o CI não puder rodar — o caso conhecido é a cota mensal de
# minutos do Actions esgotar: em repositório privado os jobs ficam em fila
# sem receber runner e são cancelados por timeout, sem mensagem de erro.
#
# Faz o MESMO que o job "deploy" do workflow: conecta no VPS e executa
# /opt/metas/deploy.sh (git fetch + reset --hard origin/main, rebuild do
# container e espera do healthcheck). O script remoto é a autoridade —
# aqui não há lógica de deploy duplicada, só o gatilho.
#
# Uso:
#   sh scripts/deploy-manual.sh
#
# Pré-requisitos:
#   - chave em ~/.ssh/metas_vps_deploy (a mesma do secret VPS_SSH_KEY)
#   - commit já publicado no origin/main (o VPS puxa de lá, não daqui)
set -e

VPS_HOST="${VPS_HOST:-api.rossinvendas.com}"
VPS_USER="${VPS_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/metas_vps_deploy}"

if [ ! -f "$SSH_KEY" ]; then
  echo "ERRO: chave nao encontrada em $SSH_KEY"
  exit 1
fi

# O VPS faz "git reset --hard origin/main": o que está só na sua máquina
# NÃO vai junto. Avisar antes evita o deploy "que não mudou nada".
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")
if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
  echo "AVISO: seu HEAD local ($(git rev-parse --short HEAD)) difere do remoto."
  echo "       O VPS vai puxar o que está no GitHub. Faça push antes."
  exit 1
fi

echo "==> disparando deploy em $VPS_USER@$VPS_HOST"
ssh -i "$SSH_KEY" -o ConnectTimeout=30 "$VPS_USER@$VPS_HOST" "/opt/metas/deploy.sh"

echo
echo "==> conferindo a API"
curl -fsS -o /dev/null -w "health -> %{http_code}\n" "https://$VPS_HOST/health"
