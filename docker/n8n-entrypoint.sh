#!/bin/sh
set -eu
# Os nós do n8n não leem variáveis de ambiente: o endereço entra aqui e a chave vira credencial cifrada.
sed -e "s#__ANTHROPIC_BASE_URL__#$ANTHROPIC_BASE_URL#g" -e "s#__SERVICO_URL__#$SERVICO_URL#g" \
  /workflow/filtro-leads.json > /tmp/workflow.json
umask 077
node -e 'process.stdout.write(JSON.stringify([{ id: "claudeApiChave001", name: "Claude API", type: "httpHeaderAuth", data: { name: "x-api-key", value: process.env.ANTHROPIC_API_KEY } }]))' \
  > /tmp/credencial.json
n8n import:credentials --input=/tmp/credencial.json
rm -f /tmp/credencial.json
unset ANTHROPIC_API_KEY
n8n import:workflow --input=/tmp/workflow.json
n8n publish:workflow --id=filtroLeadsIA0001
exec n8n start
