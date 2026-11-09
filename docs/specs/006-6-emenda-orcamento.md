# 006-6 — Falas e modo de interação: emenda do orçamento (`tipo_servico = orcamento`)

**Status:** aprovada pelo responsável em 07/11/2026, com P1 a P3 respondidas e o caso n42.
**Partes:** 6ª da 006. Ordem de leitura: [006-1](006-1-regras.md), [006-2](006-2-prompt-e-avaliacao.md), [006-3](006-3-emenda-regras.md), [006-4](006-4-emenda-casos.md), [006-5](006-5-emenda-uf.md) e esta. Emenda a 001 R1 item 1 e ao enum de `tipo_servico` do contrato (001 § Contrato), a 006-5 § Casos (n35 muda), a 006-3 C13 e 006-4 § Tabela (n11 muda só no campo `tipo_servico`). Onde esta parte diz "substitui", o texto daqui vence.
**Entrega:** mesma da 006 (branch `feat/006-falas-e-interacao`). A medição real é em 22/11, já no Haiku (spec 007), depois do merge da 007.
**Pedido** (responsável, 07/11/2026, revisando o caso n35 "Quero orçamento de ar pra minha loja em Bom Jesus", que hoje espera `tipo_servico = instalacao` sem a mensagem dizer o serviço): "Se diz orçamento, é tipo orçamento, temos que atender isso também." Respostas do grilling: só pede orçamento, sem dizer o serviço, é `orcamento`; `orcamento` conta como serviço atendido, mas o agente pergunta uma vez qual é; se o lead não diz, qualifica com `orcamento`; serviço dito vence o "orçamento"; "orçamento" primeiro e serviço depois vira o serviço.

## Problema

Lead que só pede "orçamento" não disse serviço nenhum. Hoje o modelo ou inventa (`instalacao`, como n35 espera) ou deixa `tipo_servico = null` (n11, r03), e aí a R1 nunca qualifica, por mais que segmento, cidade e telefone estejam completos. O responsável quer esse lead atendido: vai a vendas como "orçamento", depois de uma pergunta sobre o serviço.

## Escopo

Entra: RE12, valor `orcamento` no enum de `tipo_servico`, R1 item 1, validação, prompt 1.5.0, README, dataset, n11 e n35 ajustados, seis casos novos (n37–n42). Fora: § Fora do escopo.

## RE12. Pedido de orçamento sem serviço dito (emenda a 001 R1 item 1; substitui "`tipo_servico` ∈ serviços atendidos da configuração")

- Lead que pede orçamento, cotação, preço ou valor "de ar" sem nomear o serviço: `tipo_servico = orcamento`. Nunca `instalacao` por dedução.
- `orcamento` conta como serviço atendido na R1: qualifica com segmento aceito, cidade atendida e telefone, como qualquer serviço da configuração.
- O agente pergunta **uma vez** qual é o serviço (instalação, manutenção, PMOC ou projeto), em turno próprio, antes de encaminhar a vendas. Se o lead responde que não sabe, ou responde outra coisa, não pergunta de novo: segue a coleta e qualifica com `orcamento`.
- Precedência: serviço dito vence. "Orçamento de instalação de ar" é `instalacao`. "Orçamento" primeiro e serviço dito em turno posterior: `tipo_servico` passa a ser o serviço.
- `fora_escopo` vence `orcamento`: "orçamento de geladeira" é `fora_escopo` (S18).
- Ordem das perguntas (P3): a do serviço vem primeiro, na ordem da RE3; a do estado (006-5 RE11, homônimo fora da lista) vem na vez da cidade, no turno seguinte; o pedido de contato vem depois das duas. Uma pergunta por resposta (`perguntar`), como hoje.
- A resposta que pergunta o serviço não cita preço nem a palavra "orçamento": preço é de vendas (prompt, troca I), e a pergunta é sobre a necessidade ("Me conta o que você precisa para a loja?" já vale como a pergunta do serviço em n11).
- Segmento, região, UF e contato: sem mudança (RE1–RE11). "Orçamento pra minha casa" segue a regra do residencial.

## Contrato (acrescenta a 006-3 e 006-5 § Contrato)

- `tipo_servico` ganha o valor fixo `orcamento`, ao lado de `fora_escopo`, fora de `cfg.servicos` (P1): enum `[...cfg.servicos, 'orcamento', 'fora_escopo']` no Zod de `contrato.ts`, no `schemaSaida` de `turno.ts`, no dataset (`src/dataset/dataset.mjs`) e no contrato do prompt. `config/empresa.json` não muda.
- `servido` (`contrato.ts`, base de `qualificado_exige_servico`): verdadeiro quando `tipo_servico` está em `cfg.servicos` **ou** é `orcamento`.
- O que o validador confere de forma determinística: só a rota antes da pergunta (tabela). Se a pergunta foi sobre o serviço, se foi feita uma vez só e se o serviço dito depois virou `tipo_servico`: fica na medição real (T40, T41) e na leitura humana.

| Código | Hoje | Passa a |
|---|---|---|
| `qualificado_exige_servico` | `qualificado = true` exige `tipo_servico` em `cfg.servicos` | aceita também `orcamento` |
| `orcamento_exige_pergunta` | não existe | `tipo_servico = orcamento` e `acao = encaminhar_vendas` sem nenhuma mensagem `assistant` anterior no histórico → violação (encaminhou sem perguntar uma vez). Com um turno `assistant` anterior, sem conferência |
| `fora_escopo_*`, `fora_uf_exige_encerrar`, `cidade_fora_exige_nao_qualificado`, `vendas_exige_qualificado`, `qualificado_exige_telefone` | existentes | sem mudança; `orcamento` não é `fora_escopo` |

## Prompt (versão 1.5.0 continua; README repete)

- Contrato: `"tipo_servico": "{{servicos}} | orcamento | fora_escopo | null"`, com a definição: `orcamento` quando o lead pede orçamento, preço ou cotação de ar sem dizer o serviço.
- "Serviços atendidos: {{servicos}}" não muda; `orcamento` não entra na lista (não é serviço da empresa, é pedido sem serviço).
- Regra nova, junto da R1: orçamento sem serviço conta como atendido; pergunte o serviço uma vez, em turno próprio, antes de vendas; se o lead não souber, siga com `orcamento`; serviço dito vence; o serviço é perguntado antes do estado e do contato (P3).
- Trocas novas: "Quero orçamento pra minha loja em Santa Maria" → pergunta do serviço (`perguntar`, `tipo_servico = orcamento`); "Não sei ainda, 55 99999-0003" → `encaminhar_vendas` com `orcamento`; "É instalação" → `instalacao`.
- A troca de n11 (prompt l. 182) ganha `tipo_servico: orcamento` na saída mostrada, sem mudar a resposta.

## README, dataset e docs

- README l. 70 e 001 l. 147 (lista literal de serviços): acrescentar "`orcamento` (pedido sem serviço dito, conta como atendido)".
- 001 R1 item 1: "`tipo_servico` ∈ serviços atendidos da configuração **ou `orcamento`** (RE12)".
- Dataset: enum com `orcamento`; nenhum exemplo gerado muda.
- Pipeline n8n, painel e métricas: sem mudança (nada lê o valor do serviço).

## Casos (`avaliacao/casos.json`, conjunto `ajuste`: 52 → 58; `reservado` 6 e `regressao` 11 sem mudança de contagem; r03 muda só em `tipo_servico`, P2)

| Caso | Mensagem exata (histórico em ordem) | Esperado |
|---|---|---|
| n35 (muda) | "Quero orçamento de ar pra minha loja em Bom Jesus" | `tipo_servico ["orcamento"]` (era `["instalacao"]`); o resto como 006-5: `perguntar`, `uf [null]`, `cidade ["Bom Jesus"]`, `qualificado [false]`; `resposta_contem_um` passa a ser como n37 (o serviço vem antes do estado, P3; era `["estado","UF","qual Bom Jesus"]`) |
| n11 (muda) | "Me dá uma receita de bolo\nqueria orçamento de ar pra minha loja" | `tipo_servico ["orcamento"]` (era `[null]`); resposta continua sem "orçamento", "valor", "preço", "bolo", "receita" e com "loja" (006-4); a pergunta "o que você precisa" é a pergunta do serviço |
| n37 | "Quero orçamento pra minha loja em Santa Maria" | `tipo_servico ["orcamento"]`, `segmento ["comercial"]`, `cidade ["Santa Maria"]`, `uf ["RS"]`, `qualificado [false]`, `proxima_acao ["perguntar"]`; `resposta_contem_um ["instalação","manutenção","qual serviço","o que você precisa"]`; `resposta_nao_contem ["orçamento","preço","valor","telefone"]` |
| n38 | user: n37; assistant: "Qual serviço você precisa: instalação, manutenção, PMOC ou projeto?"; user: "Não sei ainda, me liga. 55 99999-0003" | `tipo_servico ["orcamento"]`, `telefone ["55999990003"]`, `qualificado [true]`, `proxima_acao ["encaminhar_vendas"]`; `resposta_nao_contem ["instalação ou manutenção","qual serviço"]` |
| n39 | user: n37; assistant: a mesma pergunta; user: "É instalação. 55 99999-0004" | `tipo_servico ["instalacao"]`, `telefone ["55999990004"]`, `qualificado [true]`, `proxima_acao ["encaminhar_vendas"]` |
| n40 | "Orçamento de instalação de ar pra minha empresa em Lages" | `tipo_servico ["instalacao"]`, `segmento ["comercial"]`, `uf ["SC"]`, `proxima_acao ["perguntar"]`; `resposta_nao_contem ["qual serviço","instalação ou manutenção"]` |
| n41 | "Quero orçamento pra minha loja em Santa Maria, 55 99999-0005" | `tipo_servico ["orcamento"]`, `telefone ["55999990005"]`, `proxima_acao ["perguntar"]` (pergunta o serviço antes de vendas); `resposta_contem_um` como n37; `qualificado` não é conferido (S19) |
| n42 | "Instalação de ar na minha loja em Bom Jesus" | `tipo_servico ["instalacao"]`, `segmento ["comercial"]`, `cidade ["Bom Jesus"]`, `uf [null]`, `qualificado [false]`, `proxima_acao ["perguntar"]`; `resposta_contem_um ["estado","UF","qual Bom Jesus"]`. Cobre a pergunta do estado de homônimo fora da lista (006-5 RE11) que n35 deixou de cobrir com P3; `itens_na [8]` |

`itens_na` dos casos novos: como n35 em 006-5 (item 8 n/a), salvo n38 e n39, que têm histórico e seguem a tabela da 006-2.

## Critérios

- C20 — Dado lead que pede orçamento sem dizer o serviço, então `tipo_servico = orcamento`; `instalacao` ou `null` é rejeitado na comparação (T36, T40).
- C21 — Dado `tipo_servico = orcamento`, segmento aceito, cidade atendida e telefone, então `qualificado = true` passa no validador; `qualificado = true` com `tipo_servico = null` continua rejeitado (T34).
- C22 — Dado `tipo_servico = orcamento` e `acao = encaminhar_vendas` no primeiro turno do agente, então `orcamento_exige_pergunta`; com um turno `assistant` anterior, sem violação (T35).
- C23 — Dado serviço dito, com ou sem a palavra "orçamento", antes ou depois, então `tipo_servico` é o serviço (T40: n39, n40).
- C24 — Dado enum e prompt com `orcamento`, então Zod, `schemaSaida`, dataset e stub aceitam o valor, e o prompt não lista `orcamento` em "Serviços atendidos" (T37, T38).
- C25 — dado homônimo fora da lista e orçamento sem serviço (n35), então a resposta pergunta o serviço, não o estado; o estado vem no turno seguinte (T39, P3).

## Testes de aceite

| T | Entrada exata | Ação | Resultado exato | Tipo e arquivo |
|---|---|---|---|---|
| T34 | saída n38: `tipo_servico: "orcamento"`, `segmento: "comercial"`, `cidade: "Santa Maria"`, `uf: "RS"`, `telefone: "55999990003"`, `qualificado: true`, `acao: encaminhar_vendas`, histórico de n38 | validar | sem violação; a mesma saída com `tipo_servico: null` → `qualificado_exige_servico` | unit, `tests/validacao.test.ts` (C21) |
| T35 | saída de T34 com histórico só da mensagem n37 (nenhum `assistant`) | validar | `orcamento_exige_pergunta`; com o histórico completo de n38 → sem violação; com `tipo_servico: "instalacao"` e histórico só de n37 → sem `orcamento_exige_pergunta` | unit, `tests/validacao.test.ts` (C22) |
| T36 | esperado n35 e n11 em `casos.json` | `npx vitest run` (teste de contagem e de forma dos casos) | `tipo_servico` `["orcamento"]` nos dois; conjunto `ajuste` com 58 casos; `reservado` 6; `regressao` 11 | unit, teste dos casos existente (C20) |
| T37 | `contrato.ts`, `turno.ts`, `dataset.mjs` | `npx tsc --noEmit` e `npx vitest run` | `orcamento` aceito no Zod e no `schemaSaida`; `fora_escopo` segue aceito; valor "cotacao" rejeitado | unit, `tests/validacao.test.ts` (C24) |
| T38 | `prompts/agente.md` 1.5.0 | teste de prompt | contrato traz `orcamento`; a linha "Serviços atendidos" não contém "orcamento"; `scripts/stub-api.mjs` com `tipo_servico: "orcamento"` passa no Zod | unit, teste de prompt existente (C24) |
| T39 | n35 no modelo real | comparação do README (22/11) | `perguntar`, `tipo_servico = orcamento`, `uf = null`, resposta pergunta o serviço | avaliação (C25) |
| T40 | n37–n42 no modelo real | comparação do README (22/11) | os seis passam na ação e nos campos esperados; n42 pergunta o estado; n38 encaminha com `orcamento`; n39 e n40 com `instalacao` | avaliação (C20, C23) |
| T41 | n11 no modelo real | comparação do README (22/11) | `tipo_servico = orcamento`, resposta sem "orçamento" | avaliação (C20) |

## Fora do escopo

Dar preço ou faixa de valor (troca I: é de vendas). Ressalva nova para o vendedor (o valor `orcamento` já diz que o serviço não foi dito). Mudança em `config/empresa.json`, painel, n8n ou métricas. Casos `reservado` além do gabarito de r03 (P2). Conferência determinística de que a pergunta foi sobre o serviço ou foi feita uma vez só. Faixa quente/morno/frio (007).

## Riscos

- O modelo pode voltar a deduzir `instalacao` quando ouve "ar" sozinho: n35, n37 e n41 medem isso.
- O modelo pode perguntar o serviço duas vezes (n38 mede uma rodada só); repetição em conversas longas só aparece na leitura humana.
- Lead com tudo na primeira mensagem (n41) ganha um turno a mais antes de vendas: é o custo da decisão D2.
- `orcamento` fora de `cfg.servicos` cria um segundo valor fixo no enum (P1); quem adicionar serviço na configuração não precisa saber disso, mas quem ler `servido` precisa.

## Respostas do responsável (07/11/2026)

- P1 — `orcamento` é valor fixo no código, ao lado de `fora_escopo`, fora de `servicos` em `config/empresa.json`. A lista da configuração continua sendo o que a empresa faz.
- P2 — O gabarito de r03 ("Queria um orçamento de ar") muda só em `tipo_servico`, de `[null, "instalacao"]` para `["orcamento"]`, em commit separado e anotado. O reservado não roda antes da medição de 22/11.
- P3 — Serviço primeiro. Em n35 a resposta pergunta o serviço; o estado vem no turno seguinte, na vez da cidade (RE3, como a 006-5 RE11 já prevê). O contato vem depois.
- S21 confirmada: "cotação", "preço" e "valor" de ar sem serviço dito equivalem a "orçamento" ("Quanto custa um ar pra minha loja?" é `orcamento`).

## Confirmado, inferido e pendente

- Confirmado (responsável, 07/11): D1 `orcamento` quando só pede orçamento; D2 conta como atendido, uma pergunta sobre o serviço, qualifica se o lead não souber; D3 serviço dito vence, antes ou depois; D4 parte 6 da 006, mesma entrega, medição em 22/11 no Haiku; prompt fica 1.5.0.
- Confirmado (código, mapa de `feat/006-falas-e-interacao`): enum derivado de `cfg.servicos` em `contrato.ts` l. 37, `turno.ts` l. 156, `dataset.mjs` l. 119; `servido` em `contrato.ts` l. 188 e `qualificado_exige_servico` l. 277; `fora_escopo` tratado no prompt l. 24, 38, 227, 267, 274 e em `contrato.ts` l. 202; n8n, painel e métricas não leem o valor do serviço; `ajuste` com 52 casos, maior id n36.
- Inferido: S18 — `fora_escopo` vence `orcamento` ("orçamento de geladeira"). S19 — `qualificado` pode ser `true` num turno `perguntar` (n41); os casos não conferem o campo nesse turno. S20 — a versão 1.5.0 do prompt absorve o valor novo porque ainda não está na `staging` (1.2.0).
- Confirmado (responsável, 07/11, respostas): P1 (S17 virou fato), P2, P3 e S21.
- Confirmado (responsável, 07/11): caso n42, para manter a cobertura da RE11 da 006-5.
- Pendente: nada.
