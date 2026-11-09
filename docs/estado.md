# Estado do projeto

Atualizado em 06/11/2026.

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
- Comparação de versões com promptfoo (#15): `npm run comparar:prompt`, em pacote isolado em `scripts/promptfoo/`. O teste com o executável real roda em `npm run test:promptfoo`, fora do CI.
- O projeto segue o pipeline padrão descrito em `CLAUDE.md`.
- Em `staging`, o único check obrigatório é `portoes`.
- Spec 007 (modelo Haiku, 06/11/2026): `claude-haiku-5-5` é o modelo principal e a reserva está desligada por configuração (`ia.modelo_reserva` vazio). A medição do Haiku nos 14 casos de ajuste espera crédito da API.
