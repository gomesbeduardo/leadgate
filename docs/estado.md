# Estado do projeto

Atualizado em 04/11/2026.

- Spec 001 (filtro de leads) integrada: `docs/specs/001-filtro-leads.md` é a fonte de regra, contrato e testes de aceite. Plano da prioridade 1: `docs/plano-001-p1.md`.
- Spec 002 (dataset e fallbacks): `docs/specs/002-dataset-e-fallbacks.md`. Implementada, com motor de falhas (repetir, modelo menor, silêncio com humano assumindo), aviso ao vendedor e contagem de falhas por tipo.
- Aviso ao vendedor: simulado por padrão. O canal de e-mail (Resend) está pronto, mas precisa de uma conta.
- Dataset sintético: 80 conversas fictícias (38 exemplos e 42 de validação) em `avaliacao/dataset/`, geradas pelo `claude-opus-5-5`. Aguardam a revisão humana (`revisao.md`); `prompt_liberado` é `false` e o prompt tem os mesmos 3 exemplos de antes.
- A validação sintética rodou uma vez, com gabarito ainda sem revisão humana: resultado em `avaliacao/tabela.md`.
- README do produto: `README.md`. Nada fica hospedado: a demo sobe com `docker compose up`.
