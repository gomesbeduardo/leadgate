#!/bin/sh
set -eu
n8n import:workflow --input=/workflow/filtro-leads.json
n8n publish:workflow --id=filtroLeadsIA0001
exec n8n start
