# Plano da emenda da spec 006 (006-3 e 006-4)

**BASE:** `78ac3d0`, na branch `feat/006-falas-e-interacao`, já rebaseada na `staging` de 05/11. Portões na BASE: 497 testes passam, 6 pulados, `tsc` limpo.
**Spec:** [006-3](specs/006-3-emenda-regras.md) (regras, contrato, critérios C1–C14) e [006-4](specs/006-4-emenda-casos.md) (casos, testes T1–T24). Elas entram na `staging` pelo PR #41, só de doc.

As fatias rodam em sequência na mesma worktree, com um commit por fatia, porque todas dependem da forma nova da saída ou do prompt anterior. Cada uma é feita por um `worker`, com TDD.

| Fatia | Entrega | Testes de aceite | Arquivos principais | Chamadas |
|---|---|---|---|---|
| 1. Campos e roteamento | RE1, RE2, RE7, § Contrato: `ja_cliente`, `email`, `ressalvas`, contato real | T1–T4, T6, T21, T24 | `src/validacao/contrato.ts`, `saida.ts`, `resposta.ts`, `src/fluxo/turno.ts`, `src/servico/app.ts` (painel) | ~25 |
| 2. Escadas de silêncio | RE6 e RE8 no validador, `vazioPermitido` | T8–T10 | `src/validacao/contrato.ts`, `saida.ts` | ~18 |
| 3. Período do dia | RE5: `{{periodo_do_dia}}` preenchido em `iniciarTurno` | T12 | `src/prompt/montar.ts`, `src/fluxo/turno.ts`, `prompts/agente.md`, `README.md` | ~12 |
| 4. Prompt 1.4.0 | RE1–RE10 no prompt, README igual, `frases_bot` | T20 e T10 da 006-1 | `prompts/agente.md`, `README.md`, `config/empresa.json` | ~22 |
| 5. Métricas | campos novos, resposta nula com `vagos = 2`, conferência de texto da resposta, item 7 n/a, item 12 | T19 | `src/avaliacao/metricas.mjs`, `scripts/tabela-avaliacao.mjs` | ~15 |
| 6. Casos | tabela de `esperado`, n19b, n20–n32, n27b, g11 | base de T5, T7, T11, T13–T17, T22, T23 | `avaliacao/casos.json`, `avaliacao/regressao.json`, `tests/avaliacao.test.ts` | ~15 |

Depois: três rodadas na pilha real, comparação com a `staging` e evidência (resultado, `tabela.md`, README). A leitura humana (T18) é do responsável, e a revisão final roda em sessão nova com `/pr-reviewer`. O `code-reviewer` no Opus já passou uma vez nesta entrega e não repete.

## Três pontos que a spec deixou por conferir

- **Quando o chat liga `silencio_ocorrido`:** em `chat/index.html:274`, quando a resposta vem nula, a origem é o modelo, a ação é `ignorar` ou `encaminhar_vendas` e já houve fala do agente. Zera ao chegar resposta (`:264`). Por isso o silêncio do 2º fora de assunto liga o sinal, e o 3º de lead qualificado precisa aceitar vendas: decisão do responsável em 05/11 pela RE8, caso n32.
- **`src/validacao/saida.ts`:** calcula `vazioPermitido` e chama as duas camadas. Muda em dois pontos: `vagos = 2` com vendas e o telefone passado a `validarResposta`.
- **`conversa.perguntas_curtas`:** três itens em `config/empresa.json:28` (tamanho ou quantidade, tipo de local, prazo), já entregues ao prompt. O n26 responde a esses três.

## Decisões de implementação, dentro da spec

- `ressalvas` é função exportada de `contrato.ts`, devolvida por `validarContrato` e `validarSaida` e levada a `Resultado` em `turno.ts`. O n8n repassa `Resultado` inteiro, então não muda.
- `app.ts` ganha `ressalvas` só no retorno de painel, porque a avaliação lê pelo proxy. A tela de conversa não muda.
- "Com dado" no validador olha `tipo_servico`, `segmento`, `cidade`, `nome`, `telefone` e `email`. `urgencia` fica de fora: o modelo pode preenchê-la numa mensagem sem dado.
- A conferência de texto da resposta (`resposta_nao_contem`, `resposta_contem_um`, `resposta_nao_comeca`) é uma chave nova do caso, porque hoje o avaliador só compara campos. Sem ela, T7, T14, T16, T17 e T23 não seriam medidos.
- A marcação "tipo fora de assunto" da 006-4 corresponde a `tipo: "desvio"` nos casos.
