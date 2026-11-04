# Estado do projeto

Atualizado em 04/11/2026.

- Spec 001 (filtro de leads) integrada: `docs/specs/001-filtro-leads.md` é a fonte de regra, contrato e testes de aceite. Plano da prioridade 1: `docs/plano-001-p1.md`.
- Spec 002 (dataset e fallbacks): `docs/specs/002-dataset-e-fallbacks.md`. Implementada, com motor de falhas (repetir, modelo menor, silêncio com humano assumindo), aviso ao vendedor e contagem de falhas por tipo.
- Aviso ao vendedor: simulado por padrão. O canal de e-mail (Resend) está pronto, mas precisa de uma conta.
- Dataset sintético: 80 conversas fictícias (38 exemplos e 42 de validação) em `avaliacao/dataset/`, geradas pelo `claude-opus-5-5`. Aguardam a revisão humana (`revisao.md`); `prompt_liberado` é `false` e o prompt tem os mesmos 3 exemplos de antes.
- A validação sintética rodou uma vez, com gabarito ainda sem revisão humana: resultado em `avaliacao/tabela.md`.
- README do produto: `README.md`. Nada fica hospedado: a demo sobe com `docker compose up`.
- A branch de integração é `staging`.
- Spec 003 (prazo solto) integrada no PR #9.
- Leitura humana feita uma vez: 120 de 124 marcações aprovadas, em `avaliacao/leitura.json`.
- Emendas das specs 001 e 002 aprovadas pelo responsável em 04/11/2026.
- Spec 004 integrada no PR #14: landing page em `/` e conversa em `/conversa`.
- CI integrado no PR #17: `Portões` roda em PR e em `staging`.
- Spec 005 (agente de issues no Actions) integrada nos PRs #20 a #33. O rótulo `claude-fix` em issue do responsável abre PR, e o merge é automático com `portoes`, `alcance` e `revisao-agente`. Primeiro ciclo completo no PR #25.
- Merge pelo `GITHUB_TOKEN` não fecha a issue nem roda `Portões` em `staging`. A emenda C14 da spec 005 troca por um GitHub App, que ainda precisa ser criado.
- `claude-fix` só serve para issue fora dos caminhos barrados da C8. PR do agente nesses caminhos reprova `alcance`, que é obrigatório, e fica sem merge.
- O rótulo `claude-sessao` é a fila das sessões locais: a sessão tira o rótulo, comenta na issue e faz uma por vez.
