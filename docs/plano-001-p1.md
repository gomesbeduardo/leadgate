# Plano da prioridade 1 — spec 001

Base: `d388f2d`. Branch: `feat/001-nucleo-p1`.

**Pronto quando:** T24 roda ponta a ponta (`docker compose up`, chat, n8n, modelo, JSON validado) e a tabela de acerto por campo sai de `avaliacao/resultado.json`.

**Fora desta prioridade:** Supabase, notificação real a vendas, WhatsApp, GitHub Pages e busca de cidade.

## Fatias

| # | Entrega | Testes da spec | Quem | Chamadas |
|---|---|---|---|---|
| 0 | Scaffold: dependências, TypeScript, Vitest, `.env.example` | portões rodam | sessão principal (ok do responsável) | feito |
| 1 | Schema da configuração, `config/empresa.json`, contrato e validação cruzada | T2, T4, T9, T10, T12 | `worker` | ~22 |
| 2 | Camada 2 da `resposta` (R10) | T13 | `worker` | ~15 |
| 3 | `prompts/agente.md` e montagem do prompt | T21, T22 | `worker` | ~18 |
| 4 | Funções dos nós: preparar chamada, instrução de correção, rota de falha e bundle único | T11 (com stub) | `worker` | ~22 |
| 5 | Serviço de validação, workflow do n8n e `docker-compose.yml` | T24, parte de T11 | `worker` no serviço e no workflow, sessão principal no Compose | ~25 |
| 6 | Tela do chat, com aviso LGPD | T23 | `worker`, com revisão visual da sessão principal | ~22 |
| 7 | 20 casos, executor da avaliação e tabela | T1, T3, T5–T8, T14–T20, T26 | `worker` | ~25 |

As fatias 2 e 3 rodam em paralelo depois da 1. A chave da API só é necessária a partir da fatia 5.

## Decisões de configuração

- Cidades: lista curta de 16 cidades, aprovada pelo responsável.
- `atendente.nome`: "Atendimento CentralEng".
- `empresa.horario`: das 8h às 18h.
- `empresa.contato`: os dois telefones públicos da LP, (55) 3307-7010 e (48) 3364-9840. O WhatsApp segue pendente na própria LP.
- `ia.limiar_confianca`: 0,7, a calibrar na avaliação.
- `ia.modelo`: `claude-opus-5-5`, com `effort` em `low` na configuração.

## Ajustes à spec que precisam de ciência do responsável

- `segmentos[]` entra na configuração: `segmentos_aceitos[]` sozinho não cobre `residencial`, que precisa ser um valor válido do schema para ser recusado.
- `ia.temperatura` sai: a API atual recusa o parâmetro, e `ia.effort` ocupa o lugar dele.
- Validação fora do nó Code: aprovada pelo responsável em 03/11, porque o n8n 2.46 desativa `Object.defineProperty`, do qual o Zod depende.
- T13: "menu" também reconhece enumeração no meio da linha (`1)`), porque o exemplo do próprio teste não começa a linha com número.
