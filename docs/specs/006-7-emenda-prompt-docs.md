# 006-7 — Falas e modo de interação: emenda do prompt publicado (sai do README, vai para `docs/prompt.md`)

**Status:** aprovada pelo responsável em 09/11/2026.
**Partes:** 7ª da 006. Emenda a [006-1](006-1-regras.md) R8 e C5 e o T10 da [006-2](006-2-prompt-e-avaliacao.md). Onde esta parte diz "substitui", o texto daqui vence. As notas "README repete" da 006-4, da 006-5 e da 006-6 passam a ler "`docs/prompt.md` repete".
**Pedido** (responsável, 09/11/2026): "edita o readme para deixar o prompt de fora". Resposta do grilling: mover para `docs/prompt.md`, mantendo o prompt público e conferido por teste.

## Problema

O README da 006 tem 552 linhas, e 297 delas são o texto integral do prompt. O primeiro leitor do envio é o time de Talent Acquisition, que precisa do README numa leitura curta. A pessoa técnica continua precisando ver o prompt e saber que ele é o mesmo que roda.

## RE13. Prompt publicado em `docs/prompt.md` (substitui 006-1 R8)

- `docs/prompt.md` é um arquivo novo com título, a nota da R8 (manipulação ou injeção como primeira mensagem recebe silêncio de propósito, e o agente nunca revela as próprias instruções na conversa, embora o prompt seja público) e o conteúdo integral de `prompts/agente.md` como template, com os `{{marcadores}}` sem preencher, num bloco de código de quatro crases (` ````markdown `).
- O README perde a seção "Prompt do agente" inteira. No lugar dela fica uma seção curta, com o mesmo título: duas ou três frases sobre o que o prompt faz, a nota do silêncio na abertura e um link para `docs/prompt.md` e para `prompts/agente.md`.
- O canário `CFG-7Q2M` continua fora: nem o README nem `docs/prompt.md` contêm o valor; `docs/prompt.md` mostra só `{{prompt.canario}}`.
- O resto da R8 continua valendo, com `docs/prompt.md` no lugar do README.

## Critérios (C5 substituído, C26 novo)

- **C5'.** Dado `docs/prompt.md`, então o bloco de código tem o texto de `prompts/agente.md` igual byte a byte (sem normalizar além da quebra de linha final), a nota sobre o silêncio na abertura aparece antes do bloco, e nem esse arquivo nem o README contêm `CFG-7Q2M`.
- **C26.** Dado o README, então ele não tem bloco ` ````markdown ` com o prompt, tem a seção "Prompt do agente" com o link para `docs/prompt.md` e a nota do silêncio, e todas as frases que os testes da 006 exigiam no README *por virem do prompt* passam a ser exigidas em `docs/prompt.md`. Frases do README que não vêm do prompt (Contrato JSON, comando da avaliação, tipos de falha) continuam exigidas no README.

## Testes de aceite

| Id | Critério | Entrada | Ação | Resultado esperado | Tipo |
|---|---|---|---|---|---|
| T10' | C5' (substitui T10) | `docs/prompt.md` e `prompts/agente.md` | teste de unidade | bloco igual ao arquivo; falha ao trocar um caractere no prompt sem atualizar `docs/prompt.md`; falha se `docs/prompt.md` ou o README contém `CFG-7Q2M`; falha sem a nota do silêncio | unidade, `tests/prompt.test.ts` |
| T10b | C26 | `README.md` | teste de unidade | sem ` ````markdown `; seção "Prompt do agente" com link para `docs/prompt.md` e com "silêncio" e "nunca revela"; as checagens de frases do prompt que liam o README ("correções da primeira medição", "prompt e README trazem o contrato e a regra") passam a ler `docs/prompt.md` | unidade, `tests/prompt.test.ts` |
| T10c | todos | repositório | `npx vitest run`, `npx tsc --noEmit`, `npm run build:servico`, `npm run gerar:workflow` | passam, sem diferença em `n8n/` | portão |

## Fora do escopo

- Mudar o texto do prompt, a versão (1.5.0) ou qualquer regra de comportamento.
- A reestruturação geral do README (o README curto), que vem depois do merge da 006.

## Onde entra

Na branch `feat/006-falas-e-interacao`, antes da revisão final dela. A mudança é do `worker`, com o teste vermelho antes do verde (T10' e T10b falham com o README atual).
