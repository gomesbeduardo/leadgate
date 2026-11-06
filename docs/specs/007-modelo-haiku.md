# 007 — Modelo principal mais barato

**Status:** aguardando aprovação do responsável.
**Pedido:** "Vamos usar modelos mais baratos, fiquei sem crédito de API em 2 dias de testes..."
**Specs ligadas:** 001 (`ia.modelo`, R10), 002 (camada 2 de fallback, P4). Esta spec emenda o valor de `ia.modelo` e desliga a camada 2 por configuração.

## Problema

Cada turno do agente chama o `claude-opus-5-5`, e a avaliação repete isso em dezenas de turnos. Os testes consumiram o crédito da API em 2 dias, e nenhuma rodada real pode acontecer sem nova recarga.

## Decisões do responsável (06/11/2026)

- **D1.** `ia.modelo` passa a ser `claude-haiku-5-5`.
- **D2.** `ia.modelo_reserva` fica vazio. O código da camada 2 continua no lugar, como a spec 002 já prevê ("vazio desliga a camada").
- **D3.** O piso de aceite são 12 de 14 acertos em cada campo, nos casos de ajuste.

## Escopo

Entra: `config/empresa.json`; os testes e o stub que supõem o Haiku como reserva; README, `docs/estado.md` e a spec 002, no que a troca deixar falso.

## Critérios

- **C1.** Dado `config/empresa.json`, então `ia.modelo = claude-haiku-5-5`, `ia.modelo_reserva = ""`, e `ia.effort`, `ia.max_regeracoes` e `ia.max_tokens` não mudam.
- **C2.** Dado o primário esgotado e a reserva vazia, quando o turno falha, então nenhuma chamada sai com outro modelo, o lead não recebe texto e o estado é `aguardando_humano`, com `proxima_acao = encaminhar_humano`.
- **C3.** Dado `ia.modelo_reserva` preenchido, então a camada 2 continua funcionando (T11 e T12 da spec 002 seguem válidos com a reserva em fixture de teste).
- **C4.** Dado o stub, quando o primário é o Haiku, então o cenário "primário falha, reserva responde" continua distinguindo os dois modelos.
- **C5.** Dados os 14 casos de ajuste com o modelo novo, então cada um dos 6 campos tem pelo menos 12/14 acertos e nenhuma resposta passa pelas travas com vazamento. Caso barrado pela trava conta como erro.
- **C6.** Dado o README, então os números medidos no Opus ficam identificados como tal, os do Haiku aparecem separados e a frase de que o Haiku não substitui o principal sai.

## Testes de aceite

| Id | Critério | Entrada | Ação | Resultado esperado | Tipo |
|---|---|---|---|---|---|
| T1 | C1 | `config/empresa.json` | `grep -n '"modelo' config/empresa.json` | modelo `claude-haiku-5-5`, reserva `""` | manual |
| T2 | C2 | config real; stub responde 503 em toda chamada | 1 turno | 3 requisições HTTP, todas com `model = claude-haiku-5-5`; 3 registros `5xx` com `modelo = primario`; `resposta = null`; `estado = aguardando_humano` | automatizado |
| T3 | C2 | config real; stub devolve texto não JSON em toda chamada | 1 turno | 3 registros `schema`, `origem = falha`, nenhum `model` diferente do primário (é o T15 da spec 002 com a config real) | automatizado |
| T4 | C3 | fixture com `modelo_reserva = claude-sonnet-5-5`; primário 503 × 3, reserva com JSON válido | 1 turno | `origem = modelo`, `modelo_respondeu = reserva` | automatizado |
| T5 | C4 | stub no cenário de falha do primário, com reserva de teste | 1 chamada por modelo | primário 503, reserva 200 | automatizado |
| T6 | C5 | `prompts/agente.md` sem mudança | `DEMO_PAINEL=1 node scripts/avaliar.mjs --conjunto ajuste && node scripts/tabela-avaliacao.mjs` | `avaliacao/tabela.md` com 12/14 ou mais em `tipo_servico`, `segmento`, `cidade`, `urgencia`, `qualificado` e `proxima_acao` | real, gasta crédito |
| T7 | todos | repositório | `npx vitest run`, `npx tsc --noEmit`, `npm run build:servico`, `npm run gerar:workflow` | todos passam, sem diferença em `n8n/` | portão |

## Fora do escopo

- Mudar `prompts/agente.md`, a validação ou a lógica do turno.
- Rodar de novo o conjunto reservado. O número dele continua sendo o do Opus, medido uma vez.
- Gerar de novo o dataset. O gerador usa `ia.modelo`, então uma rodada futura sairia no Haiku.
- Cache de prompt e contagem de tokens na avaliação.

## Consequências

- **Mais turnos em silêncio.** Sem reserva, turno que esgota o Haiku vai direto para humano. O caso que a trava de vazamento barrou na medição anterior do Haiku, por exemplo, deixaria o lead sem resposta.
- **Acerto menor que o do Opus.** A medição anterior foi de 12 a 13 acertos por campo em 14, contra 14/14 no Opus, e o prompt continua ajustado no Opus.
- **Reprovou em T6:** nada é ajustado por conta própria. A decisão volta ao responsável.

## Pergunta aberta

**P1. Como medir em T6.** O `CLAUDE.md` pede a comparação `npm run comparar:prompt` quando `config/` muda. Ela roda 3 vezes os 14 casos na base e 3 na branch, e a base é o Opus. Recomendação: abrir uma exceção nesta entrega e rodar só `avaliar` uma vez no Haiku, comparando com os números do Opus já registrados em `avaliacao/tabela.md`. A alternativa é seguir a comparação, que dá uma medida de variação mas volta a gastar no Opus.

## Dependência

T6 precisa de crédito na API. O restante roda com o stub.
