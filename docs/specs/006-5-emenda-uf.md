# 006-5 — Falas e modo de interação: emenda da UF (área de atendimento por estado)

**Status:** aprovada pelo responsável em 05/11/2026, com as suposições S12 a S16.
**Partes:** 5ª da 006. Ordem de leitura: [006-1](006-1-regras.md), [006-2](006-2-prompt-e-avaliacao.md), [006-3](006-3-emenda-regras.md), [006-4](006-4-emenda-casos.md) e esta. Emenda a 006-3 RE1 (abre a segunda exceção ao "nunca diga que não atende") e a 006-4 § "Sem mudança: g01–g09" (g01 muda). Onde esta parte diz "substitui", o texto daqui vence.
**Issue:** #11.
**Pedido** (responsável, 05/11/2026, revisando o caso "Santa Maria-DF"): "Verficar estado e UF, se for muito longe já avisa e nega, não faz sentido. Atende apenas RS e SC em regiões perto das cidades." Respostas do grilling: "Buscar pelo nome qual UF, se for em mais de um UF, pergunta." / "Avisa e encerra, não repassa contato porque teoricamente, ele já tem o contato (...). E não manda pra vendas se for muito longe" / "Só vai a vendas se o LEAD é REALMENTE muito quente." / "Vale o estado" / "Cidade da lista não pergunta" / "Por UF, sem horas" / "Recusa sempre; exceção entra na 007".

## Problema

A RE1 manda nunca recusar por região: Santa Maria-DF (a 2.000 km) hoje vira "cidade parecida" com Santa Maria-RS, segue a coleta e chega a vendas (g01 espera `encaminhar_humano`). O responsável quer recusa direta fora de RS e SC, sem pedir contato e sem acionar vendas.

## Escopo

Entra: RE11, campo `uf`, config `regiao.ufs_atendidas`, validação, `cidadeParecida`, prompt 1.5.0, g01 e quatro casos novos. Fora: § Fora do escopo.

## RE11. Fora de RS e SC: avisa e encerra (emenda a RE1; substitui 006-3 RE1 "não há mapeamento por região")

- Área de atendimento é por UF, sem horas de distância: `regiao.ufs_atendidas: ["RS", "SC"]` em `config/empresa.json`. Vale qualquer distância: Curitiba-PR recusa como Manaus.
- `uf` (§ Contrato) é o que o lead disse, ou a UF que o modelo sabe pelo nome da cidade quando o nome existe num estado só.
- Cidade da lista (`regiao.cidades`) sem UF dita: vale a UF da lista (`regiao.ufs`), sem perguntar. "São José" é SC; "Santa Maria" é RS.
- Cidade fora da lista cujo nome existe em mais de uma UF, sem UF dita: o agente pergunta o estado (`perguntar`, `uf = null`), na vez da cidade na ordem da RE3.
- `uf` fora de `ufs_atendidas`: `responder_e_encerrar`, `qualificado = false`, uma frase, sem pedir telefone nem e-mail, sem citar `empresa.contato`, nada vai a vendas nem a humano, com ou sem contato no histórico. Frase no espírito de "Infelizmente não atendemos em Manaus: atuamos em regiões do RS e de SC."
- Esta e `fora_escopo` são as únicas exceções ao "nunca diga que não atende" da RE1.
- Dentro de RS ou SC e fora da lista (Joinville, Uruguaiana): RE1 sem mudança, ressalva `fora_regiao`, vendas decide.
- UF explícita diferente da UF da cidade da lista ("Santa Maria-DF") não é erro de digitação: deixa de ser "parecida" e cai nesta regra.
- Residencial com UF fora: a recusa vence; a frase do foco comercial não aparece (S13).
- Depois da recusa, lead que pede uma pessoa ou pergunta se é IA: a 001 R11 e a RE9 valem (responde), mas a rota continua `responder_e_encerrar` sem contato e sem humano (S12).

## Contrato (acrescenta a 006-3 § Contrato)

- Saída do modelo ganha `uf: string | null` (duas letras maiúsculas; obrigatório no Zod e em `Saida` de `contrato.ts`, no `schemaSaida` de `turno.ts`, no contrato do prompt e em `scripts/stub-api.mjs`).
- Lead que diz só o estado ("sou do Paraná"), sem cidade: `uf = "PR"`, `cidade = null`; a recusa já vale (S14).
- `cidadeParecida(cidade, cfg)`: hoje tira o sufixo "-UF" e compara o nome com todas as cidades da lista. Passa a: com sufixo, compara só com as cidades da lista cuja UF em `regiao.ufs` é a do sufixo; sem sufixo, como hoje. "Santa Maria-DF" não é parecida; "Santa Mria-RS" continua parecida.
- `CAMPOS_FALAS` (`src/avaliacao/metricas.mjs`) ganha `uf`: pontua só quando `esperado` traz o campo.
- `ressalvas`: sem mudança; na recusa por UF não há rota, o valor não é lido.

| Código | Hoje | Passa a |
|---|---|---|
| `fora_uf_exige_encerrar` | não existe | `uf` preenchida e fora de `ufs_atendidas` → `responder_e_encerrar`, `qualificado = false`, e `resposta` **não** cita `empresa.contato` (`citaContato` falso); qualquer outra ação é violação |
| `uf_contradiz_lista` | não existe | anti-invenção: `cidade` da lista (sem sufixo) e `uf` preenchida diferente da UF da lista, sem que nenhuma mensagem `user` contenha a sigla (duas letras isoladas, sem acento) ou o nome do estado → violação. Ex.: `cidade: "Santa Maria"`, `uf: "DF"`, lead nunca disse DF: violação. Cidade fora da lista: sem conferência (o modelo pode saber a UF) |
| `encerrar_com_telefone_exige_humano` | contato real → não pode encerrar | isenta quando `uf` fora de `ufs_atendidas` |
| `encerrar_sem_telefone_exige_contato` | encerrar sem telefone cita `empresa.contato` | isenta quando `uf` fora de `ufs_atendidas` |
| `cidade_fora_exige_nao_qualificado` | cidade fora e não parecida → `qualificado = false` | sem mudança; "Santa Maria-DF" agora dispara, porque deixa de ser parecida |
| `recusa_exige_encerrar`, `vendas_exige_qualificado`, `humano_exige_contato`, `telefone_nao_confere`, `email_nao_confere` | existentes | sem mudança |
| `cidadeAtendida` | aceita "Cidade-UF" só se a UF bate com `regiao.ufs` | sem mudança |

## Prompt (versão 1.5.0; README repete)

- Contrato: campo `uf` com a definição da RE11 (dita pelo lead, ou sabida pelo nome quando único; `null` na dúvida).
- Regra nova, junto da RE1: fora de RS e SC avisa e encerra em uma frase, sem pedir contato, sem citar o contato da empresa, sem oferecer vendas. Cidade da lista não pergunta estado; homônimo fora da lista pergunta.
- Troca nova: "Manutenção na minha loja em Manaus" → frase de recusa (exemplo da RE11), `responder_e_encerrar`.

## Casos (g01 em `avaliacao/regressao.json`; n33–n36 em `avaliacao/casos.json`, conjunto `ajuste`; `reservado` intocado)

| Caso | Mensagem exata | Esperado |
|---|---|---|
| g01 (muda) | "Manutenção na minha loja em Santa Maria-DF, 48 99999-0001" | era `encaminhar_humano`; vira `responder_e_encerrar`, `qualificado = false`, `uf = "DF"`, `resposta_nao_contem`: "3307-7010", "3364-9840", "telefone", "e-mail"; `resposta_contem_um`: "não atendemos", "não atuamos" |
| n33 | "Preciso de manutenção no ar da minha loja em Manaus" | `responder_e_encerrar`, `qualificado = false`, `uf = "AM"`, `telefone = null`; `resposta_nao_contem`: "3307-7010", "3364-9840", "telefone", "e-mail" |
| n34 | "Instalação de split na minha empresa em Curitiba-PR, 41 99999-0002" | `responder_e_encerrar`, `qualificado = false`, `uf = "PR"`; `resposta_nao_contem`: "3307-7010", "3364-9840", "equipe comercial", "vendas" |
| n35 | "Quero orçamento de ar pra minha loja em Bom Jesus" | `perguntar`, `uf = null`, `cidade = "Bom Jesus"`; `resposta_contem_um`: "estado", "UF", "qual Bom Jesus" |
| n36 | "Quero instalar um ar na minha loja em São José" | `perguntar`, `uf = "SC"`; `resposta_nao_contem`: "estado", "UF", "não atendemos" |

## Critérios

- C15 — Dado `uf` fora de `ufs_atendidas`, com ou sem contato, então `responder_e_encerrar`, `qualificado = false`, resposta sem `empresa.contato` e sem pedido de contato; `encaminhar_vendas`, `encaminhar_humano` ou `perguntar` é rejeitado (T25, T26, T27).
- C16 — Dado cidade da lista sem UF dita, então `uf` da lista e nenhuma pergunta de estado; `uf` diferente da lista sem a sigla no histórico é rejeitada (T28, T30).
- C17 — Dado cidade fora da lista com nome em mais de uma UF, sem UF dita, então `perguntar` com `uf = null` (T29).
- C18 — Dado "Cidade-UF" com UF diferente da UF da cidade da lista, então `cidadeParecida` é falsa e `cidade_fora_exige_nao_qualificado` dispara (T30, T31).
- C19 — Dado prompt 1.5.0, então o teste de prompt passa, `uf` está no contrato e na saída do stub (T32).

## Testes de aceite

| T | Entrada exata | Ação | Resultado exato | Tipo e arquivo |
|---|---|---|---|---|
| T25 | n33: saída `uf: "AM"`, `telefone: null`, `acao: responder_e_encerrar`, resposta "Infelizmente não atendemos em Manaus: atuamos em regiões do RS e de SC." | validar | sem violação; a mesma saída com `acao: perguntar` → `fora_uf_exige_encerrar` | unit, `tests/validacao.test.ts` (C15) |
| T26 | n34: `uf: "PR"`, `telefone: "41999990002"`, `acao: responder_e_encerrar`, resposta sem `empresa.contato` | validar | sem violação (`encerrar_com_telefone_exige_humano` isento); com `acao: encaminhar_vendas` → `fora_uf_exige_encerrar` | unit, `tests/validacao.test.ts` (C15) |
| T27 | n33 com resposta citando `empresa.contato` | validar | `fora_uf_exige_encerrar` | unit, `tests/validacao.test.ts` (C15) |
| T28 | n36: `cidade: "São José"`, `uf: "SC"`, `acao: perguntar` | validar | sem violação | unit, `tests/validacao.test.ts` (C16) |
| T29 | n35: `cidade: "Bom Jesus"`, `uf: null`, `acao: perguntar`, resposta "Qual estado fica Bom Jesus?" | validar | sem violação; `fora_uf_exige_encerrar` não dispara com `uf = null` | unit, `tests/validacao.test.ts` (C17) |
| T30 | histórico só com g01 adaptado "Manutenção na minha loja em Santa Maria", saída `cidade: "Santa Maria"`, `uf: "DF"` | validar | `uf_contradiz_lista`; com a mensagem original "Santa Maria-DF" → sem `uf_contradiz_lista`, e `cidadeParecida("Santa Maria-DF")` é falsa | unit, `tests/validacao.test.ts` (C16, C18) |
| T31 | `cidadeParecida("Santa Mria-RS")` e `cidadeParecida("Santa Mria")` | chamar | ambas verdadeiras; `cidadeParecida("Santa Maria-DF")` falsa | unit, `tests/validacao.test.ts` (C18) |
| T32 | `prompts/agente.md` 1.5.0, `scripts/stub-api.mjs` | teste de prompt e `npx vitest run` | versão 1.5.0, `uf` no contrato; stub devolve `uf` e passa no Zod | unit, teste de prompt existente (C19) |
| T33 | casos g01, n33–n36 | comparação do README | os cinco passam na ação e nos campos esperados | avaliação (C15–C17) |

## Fora do escopo

Exceção do lead "muito quente" (vai a vendas mesmo fora da UF): entra na spec 007, quando existir a faixa quente/morno/frio; aqui recusa sempre. Horas de distância ou mapeamento geográfico. Conferência da UF por base externa. Canal WhatsApp real. Casos `reservado`. Mudança de tela ou de `app.ts`.

## Confirmado, inferido e pendente

- Confirmado (responsável, 05/11): área por UF sem horas; `ufs_atendidas` RS e SC; cidade da lista não pergunta; homônimo fora da lista pergunta; recusa sem pedir contato, sem vendas, em qualquer distância; "muito quente" fica para a 007.
- Confirmado (código, `contrato.ts` l. 59–91): `SUFIXO_UF`, `cidadeAtendida` só aceita sufixo que bate com `regiao.ufs`; `cidadeParecida` tira o sufixo e compara com toda a lista; 006-3 § Contrato para as regras `encerrar_*`.
- Inferido: S12 — depois da recusa, pergunta sobre IA ou pedido de pessoa recebe resposta (001 R11, RE9), mas sem `encaminhar_humano` e sem pedir contato. S13 — residencial com UF fora: a recusa vence e a frase do foco comercial não aparece. S14 — só o estado dito, sem cidade, preenche `uf` e já recusa quando fora. S15 — `uf_contradiz_lista` confere só cidade da lista; fora da lista o modelo pode preencher pelo conhecimento. S16 — nome do estado por extenso conta como "UF dita" para a anti-invenção.
- Pendente: nada.

## Ajustes da primeira medição (acompanham a 006-4)

A primeira rodada real mostrou três erros nos casos, sem mudança de regra. n12 ("receita de bolo\nvende rifa?") aceita `desvios` 1 ou 2, porque a RE8 conta as linhas do turno unido e a ação é a mesma. n19, n19b e n24 têm o histórico semeado sem turnos vagos anteriores. n01 confere as palavras vetadas só na última resposta (`resposta_ultima_nao_contem`), porque a saudação pode citar "atendimento".
