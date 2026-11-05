# leadgate

Filtro de leads com IA para a CentralEng. Regras, contrato e testes de aceite estão em `docs/specs/`. O estado do projeto está em `docs/estado.md`, e as lições em `docs/aprendizados.md`.

## Processo

Segue a skill global `time-de-agentes`, com as áreas sensíveis em `.claude/time-de-agentes.json`.

- **Spec antes do código:** toda mudança de comportamento ou de tela tem spec em `docs/specs/NNN-nome.md`, escrita depois do grilling. O `spec-writer` escreve quando ela fixa regra de negócio, cálculo ou modelo de dados, e a sessão principal escreve nas outras. O responsável aprova, sem revisor por agente. A spec fica local até a aprovação e entra na `staging` por um PR só de doc, antes do código.
- **Só o `worker` escreve código.** Quem escreve a spec não codifica, e quem implementa não revisa. A sessão principal só codifica área sensível, com o ok do responsável para o caso.
- **No máximo duas revisões por entrega.** PR comum com código tem uma, a final, do `code-reviewer` no Opus. PR de alto risco (regra, cálculo, dado, área sensível) tem a final do `pr-reviewer` no Fable, precedida de uma no Opus só quando há 2+ fatias. PR sem código não passa por agente revisor.
- **Docs em dia:** o doc que a mudança deixou falso é corrigido no mesmo PR.
- **Avaliação:** mudou `prompts/`, `src/validacao/` ou `config/`, rode a comparação descrita no `README.md`. Nunca use o conjunto reservado de `avaliacao/casos.json` para ajustar o prompt.

## Forja e branches

- GitHub, com `gh`. O desenvolvimento acontece em branch própria, com PR para `staging`. Nunca dê push direto em `staging`.
- PR no modelo `.github/pull_request_template.md`, com título em Conventional Commits.
- **O merge é do responsável**, sempre merge normal, nunca squash. PR importante (código, teste, regra, spec, deploy) só entra com o rótulo `revisado-por-humano`, posto por ele depois do último commit.
- `npx vitest run`, `npx tsc --noEmit`, `npm run build:servico` e `npm run gerar:workflow` precisam passar, sem diferença em `n8n/`. O workflow `Portões` repete esses passos em todo PR.
