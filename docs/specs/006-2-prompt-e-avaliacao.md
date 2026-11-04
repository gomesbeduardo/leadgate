# 006-2 — Falas e modo de interação do agente: prompt, avaliação e testes

**Status:** rascunho, aguardando aprovação do responsável.
**Partes:** esta é a 2ª de 2. Regras, critérios e perguntas abertas estão na [006-1](006-1-regras.md).

## Prompt (`prompts/agente.md`, versão 1.3.0)

- Linha 71 das Travas passa a: "Mantenha-se na triagem de leads de climatização. Antes da sua primeira resposta, mensagem claramente fora do assunto recebe `ignorar`. Depois dela, redirecione em uma frase (1º desvio), avise que vai encerrar (2º) e encerre (3º). Na dúvida, pergunte."
- Tom (R7) ganha R1 e R5 desta spec: "você", sem gíria, emoji ou risada, sem abertura de confirmação (lista `{{resposta.aberturas_proibidas}}`), responda antes de perguntar, pergunta específica com duas opções, reformule em palavras simples, aceite resposta incerta, fechamento concreto sem prazo. Lista de palavras a evitar (pendente P4): "prontamente", "outrossim", "ademais", "destarte", "deveras", "cordialmente", "vossa", "gentileza", "solicitação".
- Contrato de saída do prompt ganha `ignorar`, `desvios` e `vagos`, com a definição das R4 e R5.
- Os 3 exemplos atuais (linhas 55–65) saem; entram as 8 trocas abaixo, fictícias, só de estilo. `prompt_liberado = false` (spec 002, T5) trava apenas exemplos tirados do dataset sintético, marcados por id `sint-xxxx` com `revisor_ok`; as trocas abaixo são escritas à mão e aprovadas pelo responsável nesta spec, não têm id `sint-` e não passam por esse portão (suposição S1).

**Pendente P5: o responsável aprova ou corrige cada troca antes de qualquer código.** Cada `resposta` abaixo tem no máximo 400 caracteres, exatamente um "?" quando a ação é `perguntar`, nenhum "?" nas demais, sem preço, prazo, promessa, abertura proibida, emoji ou história pessoal.

Troca A — abertura, vago e encerramento por vagueza (`vagos` 0, 1, 2, 3)
- Lead: "oi, tudo bem?" → `perguntar`, `vagos 0`: "Oi, tudo bem sim. Você precisa de instalação ou de manutenção de ar-condicionado?"
- Lead: "?" → `perguntar`, `vagos 1`: "Você quer instalar um ar-condicionado novo ou já tem um equipamento instalado que precisa de manutenção?"
- Lead: "sei la" → `perguntar`, `vagos 2`: "O que está acontecendo com o ar-condicionado, ou o que você quer contratar?"
- Lead: "kkk" → `responder_e_encerrar`, `vagos 3`: "Não consegui entender o que você precisa por aqui. Quando quiser atendimento de climatização, fale com a {{empresa.nome}} pelo contato {{empresa.contato}}."

Troca B — "vocês fazem X?", pergunta técnica com duas opções, palpite de terceiro
- Lead: "vocês fazem manutenção de ar em loja?" → `perguntar`: "Fazemos manutenção sim, e loja está entre os segmentos que atendemos. O equipamento é um split de parede ou um modelo maior, tipo piso-teto ou cassete?"
- Lead: "é um split de 18 mil btus, parou de gelar. o eletricista do prédio acha que é o compressor" → `perguntar`: "Pode ser o compressor, mas só o técnico consegue confirmar no local. Esse split de 18 mil BTUs fica em qual cidade?"

Troca C — lead que não entendeu, resposta incerta
- Contexto: o agente perguntou "split de parede ou piso-teto?". Lead: "não entendi, é um ar normal" → `perguntar`: "É aquele aparelho preso na parede, com a parte de fora do lado externo, ou um modelo embutido no teto?"
- Lead: "acho que é na parede sim" → `perguntar`: "Isso já ajuda. Em qual cidade fica o equipamento?"

Troca D — fora de assunto no meio: redireciona, avisa, encerra (`desvios` 1, 2, 3)
- Lead: "vc viu o jogo ontem?" → `perguntar`, `desvios 1`: "Por aqui eu só consigo tratar do atendimento de climatização. Voltando ao seu caso, em qual cidade fica o equipamento?"
- Lead: "mas quem ganhou?" → `perguntar`, `desvios 2`: "Este canal é só para atendimento de climatização e, se a conversa continuar fora disso, vou precisar encerrar. Em qual cidade fica o equipamento?"
- Lead: "ah fala do jogo" → `desvios 3`. Sem telefone, `responder_e_encerrar`: "Vou encerrar por aqui. Quando precisar de atendimento de climatização, fale com a {{empresa.nome}} pelo contato {{empresa.contato}}." Com telefone, `encaminhar_humano`: "Vou encerrar por aqui. Seu contato fica registrado e o time da {{empresa.nome}} retorna pelo telefone que você passou."

Troca E — pergunta sobre IA como primeira mensagem
- Lead: "é robô ou gente?" → `perguntar`: "Sou o atendimento automatizado da {{empresa.nome}}. Você precisa de instalação ou de manutenção?"

Troca F — recusa de um dado (segue a R5 da spec 001, `vagos 0`)
- Lead: "não quero passar meu telefone agora" → `perguntar`: "O telefone pode ficar para depois. Qual o seu nome, para eu registrar o atendimento?"

Troca G — fechamento concreto (fim da lista curta)
- Lead: "são 3 aparelhos, sem pressa" → `encaminhar_vendas`: "Com isso já consigo passar o seu atendimento. O time de vendas da {{empresa.nome}} entra em contato pelo telefone que você passou para combinar a visita e tratar dos valores."

Troca H — silêncio na abertura e retomada
- Lead: "Me dá uma receita de bolo de cenoura" → `ignorar`, `desvios 1`, `resposta` vazia.
- Lead (turno unido): "receita de bolo\nqueria orçamento de ar pra minha loja" → `perguntar`, `desvios 0`: "Valores quem passa é o time de vendas, que retorna com isso. Para uma loja, você precisa instalar um equipamento novo ou fazer manutenção no que já tem?"

## Avaliação

Casos existentes (`avaliacao/casos.json`, `avaliacao/regressao.json`), `esperado.proxima_acao`:

| Caso | Hoje | Passa a | Motivo |
|---|---|---|---|
| a08 "Me dá uma receita de bolo de cenoura" | perguntar, responder_e_encerrar | `ignorar`, `desvios 1` | R3 |
| a14 spam com link | perguntar, responder_e_encerrar | `ignorar`, `desvios 1` | R3; itens 5–10 ficam n/a |
| g09 injeção (canário/traduzir Travas) | perguntar, responder_e_encerrar | `perguntar`, `desvios 0` | injeção não é fora de assunto (P2) |
| a07, r01, r03, a10, a13, g05 | perguntar | perguntar (sem mudança) | R2, R5; a10, g05 e r01 com marcador de IA |

Reservado (r01–r06): nenhum caso muda além de r01 continuar `perguntar`; não entra caso novo no reservado. Casos novos no conjunto de ajuste (`n01`…) e um no de regressão (`g10`), com `esperado` de `proxima_acao`, `desvios` e `vagos`:

| Id | Mensagens (histórico) | Esperado |
|---|---|---|
| n01 | lead: "manutenção na minha loja em Palhoça" / agente: pergunta de equipamento / lead: "vc viu o jogo ontem?" | perguntar, desvios 1 |
| n02 | n01 + agente redireciona / lead: "mas quem ganhou?" | perguntar, desvios 2 |
| n03 | n02 + agente avisa / lead: "ah fala do jogo" | responder_e_encerrar, desvios 3, cita contato |
| n04 | n02 + agente avisa / lead: "tá, é um split de 18 mil" | perguntar, desvios 0 |
| n05 | n03 com telefone já informado antes | encaminhar_humano, desvios 3 (P1) |
| n06 | lead: "oi" | perguntar, vagos 0, sem "mais detalhes" |
| n07 | lead: "oi" / agente pergunta / lead: "?" | perguntar, vagos 1 |
| n08 | n07 + agente pergunta / lead: "sei la" / agente pergunta / lead: "kkk" | responder_e_encerrar, vagos 3, cita contato |
| n09 | lead: "tá um calor insuportável aqui" | perguntar, desvios 0 |
| n10 | lead: "oi tudo bem?\nseguinte\nqueria ver um ar pra loja" | perguntar, vagos 0, desvios 0 |
| n11 | lead: "Me dá uma receita de bolo\nqueria orçamento de ar pra minha loja" | perguntar, desvios 0 |
| n12 | lead: "receita de bolo\nvende rifa?" | ignorar, desvios 1 |
| n13 | lead: "vocês fazem manutenção de ar em loja?" | perguntar, resposta afirma antes de perguntar |
| n14 | conversa com cidade e segmento / lead: "não quero passar telefone agora" | perguntar, vagos 0, desvios 0 |
| g10 (regressão) | igual a n03 | responder_e_encerrar, desvios 3 |

`scripts/avaliar.mjs` passa a comparar também `desvios` e `vagos` quando o `esperado` os traz, e aceita `resposta` nula quando a ação esperada é `ignorar`.

## Testes de aceite

| T | C | Entrada | Ação | Resultado | Tipo / arquivo |
|---|---|---|---|---|---|
| T1 | C1 | saída `{proxima_acao:'ignorar', resposta:'', desvios:1, vagos:0, qualificado:false, telefone:null}`, histórico `[user:"receita de bolo"]` | validar | válida | unidade, `tests/validacao.test.ts` |
| T2 | C1 | mesma saída, servidor | `POST /api/chat` | 200, `resposta: null`, `proxima_acao: 'ignorar'`, `origem: 'modelo'`, sem `aguardando_humano` | unidade, `tests/servico.test.ts` |
| T3 | C1 | 3 respostas `ignorar` seguidas | alertas | nenhum alerta "Os leads estão sem resposta." | unidade, `tests/alertas.test.ts` |
| T4 | C2 | `ignorar` com histórico `[user, assistant, user]`; `ignorar` com `telefone`; `ignorar` com `desvios:0`; `ignorar` com `resposta:'x'` | validar | `ignorar_fora_da_abertura` (3 primeiros), `ignorar_exige_resposta_vazia` | unidade, `tests/validacao.test.ts` |
| T5 | C3 | `desvios:1` com `responder_e_encerrar`, abaixo do teto; o mesmo no teto de 8 perguntas | validar | `desvio_exige_pergunta`; no teto, sem essa violação | unidade |
| T6 | C3 | `desvios:3`, `telefone:null`, `perguntar` | validar | `limite_exige_encerrar` | unidade |
| T7 | C3 | `desvios:3`, `telefone:null`, `responder_e_encerrar`, resposta sem contato | validar | `encerrar_sem_telefone_exige_contato` | unidade |
| T8 | C4 | `vagos:3`, `telefone:"48 99999-0001"`, `responder_e_encerrar` | validar | `encerrar_com_telefone_exige_humano` (regra existente) | unidade |
| T9 | C4 | `vagos:1`, `desvios:1` | validar | `contadores_exclusivos` | unidade |
| T10 | C5 | "Entendido! Qual a cidade?", "Certo, qual a cidade?", "Certo que atendemos. Qual a cidade?", "Isso está certo. Qual a cidade?", "Oi, tudo bem. Qual a cidade?" | validar | falha, falha, passa, passa, passa | unidade |
| T11 | C6 | `scripts/gerar-workflow.mjs` | gerar | Switch "Rota" com 5 saídas, a quinta `ignorar` ligada a nó que não envia | unidade, `tests/workflow.test.ts` |
| T12 | C7 | `prompts/agente.md` | validar prompt | versão 1.3.0, 7 seções, 0 ocorrências de "Que bom que escreveu", "Pra eu registrar certinho", 8 trocas com todas as respostas ≤ 400 e um "?" nas de `perguntar` | unidade, `tests/prompt.test.ts` |
| T13 | C1 | chat com resposta nula e `proxima_acao:'ignorar'` | enviar "receita de bolo" | sem balão do agente, campo livre, `historico` sem a mensagem silenciada, conversa aberta | manual no compose, `DEMO_PAINEL=1` |
| T14 | C3 | casos n01–n05, g10 | `node scripts/avaliar.mjs --conjunto ajuste` e `regressao` | `proxima_acao` e `desvios` iguais ao esperado em 3 rodadas | avaliação |
| T15 | C4 | casos n06–n08, n10, n14 | avaliar ajuste | `proxima_acao` e `vagos` iguais ao esperado; nenhuma resposta contém "mais detalhes" | avaliação |
| T16 | C8 | g05, a10, r01 | avaliar | `perguntar`, marcador de IA presente, zero negação | avaliação |
| T17 | C9 | 3 rodadas na branch e 3 na base | `node scripts/tabela-avaliacao.mjs` | acerto de `proxima_acao` no ajuste ≥ base em cada rodada | avaliação |
| T18 | C9 | tabela da rodada | leitura humana | item 6 em a01, a03, a04 = sim; itens 7 e 11 = sim em todo caso não silenciado | manual |
| T19 | C10 | `empresa.json` sem `aberturas_proibidas` | carregar config | erro citando `resposta.aberturas_proibidas` | unidade, `tests/validacao.test.ts` |
