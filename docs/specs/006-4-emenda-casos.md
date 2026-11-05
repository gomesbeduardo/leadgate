# 006-4 — Falas e modo de interação: emenda após a leitura humana (casos e testes)

**Status:** rascunho (aguarda aprovação do responsável; reabre a 006 antes do PR).
**Partes:** 4ª de 4. Ordem de leitura: [006-1](006-1-regras.md), [006-2](006-2-prompt-e-avaliacao.md), [006-3](006-3-emenda-regras.md) (regras RE1–RE10, contrato, prompt, critérios C1–C14, pergunta aberta P1) e esta (casos de avaliação, linhas do prompt, testes de aceite e emendas às specs anteriores). As regras, os critérios e a pergunta citados aqui são os da 006-3.
**Issue:** #11.

## Casos de avaliação

Casos existentes, `esperado` que muda (`avaliacao/casos.json` e `regressao.json`; nenhum caso `reservado` muda):

| Caso | Hoje | Passa a | Regra |
|---|---|---|---|
| a01 residencial | `responder_e_encerrar`, qualificado false | `perguntar`, qualificado false; resposta sem "Obrigado por procurar", sem "?" pedindo telefone antes dos três dados | RE1, RE5 |
| a03 Joinville | `responder_e_encerrar` | `perguntar`, qualificado false, cidade Joinville | RE1 |
| a04 sala de servidores | `encaminhar_vendas` | `perguntar` (1ª da lista curta), `urgencia = alta`, `ja_cliente = null`, resposta sem "99999-0002" e sem frase de comentário | RE2, RE7 |
| a02 | `perguntar` | igual; resposta não contém "atendemos" nem "São José" | RE4 |
| a09 preço | `perguntar` | igual; resposta não começa por "Valores" nem "Preço" (leitura: pergunta a necessidade) | RE3 |
| a10 "você é um robô?" | `perguntar` | igual; resposta contém marcador de IA e "pessoa" ou "humano" | RE9 |
| a13 Palhoça | `perguntar` | igual; sem confirmação de atendimento (leitura) | RE4 |
| n01 | `perguntar`, desvios 1 | igual; resposta sem "climatização", "atendimento", "canal" | RE8 |
| n02 | `perguntar`, desvios 2 | `ignorar`, resposta vazia, desvios 2 | RE8 |
| n03, g10 | `responder_e_encerrar`, desvios 3 | igual; resposta sem "encerrar" (leitura: suave) | RE8 |
| n06 "oi" | `perguntar`, vagos 0 | igual; sem "instalação"/"manutenção"; contém "ajudar" | RE5 |
| n07 "oi" / "?" | `perguntar`, vagos 1 | `ignorar`, resposta vazia, vagos 1 | RE6 |
| n08 | `responder_e_encerrar`, vagos 3 | igual (2ª vaga agora é pergunta, 3ª encerra) | RE6 |
| n09 calor | `perguntar` | igual; sem "faz toda a diferença", sem "instalação"/"manutenção" | RE5 |
| n10 loja | `perguntar` | igual; sem "instalação ou manutenção" | RE5 |
| n11 mista | `perguntar`, desvios 0 | igual; resposta sem "bolo", "receita", "valor", "preço", "orçamento"; contém "loja" | RE10 |
| n19 qualificado, 3 vagas | `encaminhar_vendas`, vagos 3, fechamento | vira dois casos: n19 (1 vaga) `perguntar`, vagos 1; n19b (2 vagas) `encaminhar_vendas`, resposta vazia, vagos 2 | RE6 |
| n13 | `perguntar`, afirma antes | igual; afirmação curta, sem "segmento" nem "região" | RE4 |

Sem mudança: a05–a08, a11, a12, a14, n04, n05, n12, n14–n18, g01–g09.

Casos novos (ajuste, salvo nota; telefones e e-mails fictícios):

| Id | Histórico | Esperado |
|---|---|---|
| n20 | a01 + agente / lead: "pode ser, 48 99999-0004" | `encaminhar_vendas`, qualificado false, `ressalvas: ["residencial"]`, resposta sem os dígitos |
| n21 | a03 + agente / lead: "sou o João, 47 99999-0005" | `encaminhar_vendas`, qualificado false, `ressalvas: ["fora_regiao"]` |
| n22 | "o ar da nossa loja parou, já somos clientes de vocês, Palhoça, 48 99999-0006" | `urgencia = alta`, `ja_cliente = true`, `encaminhar_vendas`, sem lista curta |
| n23 | a10 + agente / lead: "prefiro falar com uma pessoa, 48 99999-0007" | `encaminhar_humano`, resposta sem os dígitos |
| n24 | n19b + lead: "asdfg", com `silencio_ocorrido` | `ignorar`, vagos 3, sem novo encaminhamento |
| n25 | n02 (silêncio) + lead: "fala do jogo" sem telefone | `responder_e_encerrar`, desvios 3, cita contato, sem "encerrar" |
| n26 | a04 + agente / lead respondendo cada pergunta da lista curta (`conversa.perguntas_curtas`), até a última | `encaminhar_vendas`, `ja_cliente = null`, `urgencia = alta`, resposta sem "?" e sem os dígitos de "99999-0002"; contém "número" |
| n27 | a10 + agente / lead: "prefiro falar com uma pessoa" (sem telefone) | `perguntar`, um "?", resposta contém "telefone" ou "e-mail" |
| n27b | n27 + agente / lead: "48 99999-0008" | `encaminhar_humano`, resposta sem os dígitos |
| n28 | a01 + agente pede contato / lead: "não passo telefone, pode ser por email: ana.souza@gmail.com" | `encaminhar_vendas`, qualificado false, `ressalvas: ["residencial"]`, `email = "ana.souza@gmail.com"`, `telefone = null` |
| n29 | a01 + agente pede contato / lead: "não quero passar contato nenhum" | `responder_e_encerrar`, qualificado false, cita contato, sem "?" |
| n30 | cidade e segmento ditos, sem telefone; agente pergunta; lead "asdfg"; agente "Não entendi, pode repetir?"; lead "qwerty" | `ignorar`, resposta vazia, vagos 2 |
| n31 | "Me dá uma receita de bolo de cenoura" (só isso, primeira mensagem) | `ignorar`, desvios 1 |
| g11 (regressão) | igual a n20 | `encaminhar_vendas`, qualificado false |

`scripts/avaliar.mjs`: `CAMPOS` ganha `ja_cliente` e `email` quando o `esperado` os traz; aceita `resposta` nula também com vendas e `vagos = 2`. Tabela (`scripts/tabela-avaliacao.mjs`): item 7 é n/a quando o caso não tem `esperado.desvios ≥ 1` nem `tipo: "fora_assunto"` (recomendação de mecanismo; a regra é a decisão do responsável).

## Prompt (versão 1.4.0; linhas do `prompts/agente.md` 1.3.0)

- R1 (l. 22), R4 (l. 26), R5 (l. 28), R3 (l. 34–39): reescritos por RE1, RE2, RE3 e 006-3 § Contrato; `ja_cliente` e `email` entram no contrato de saída (l. 171–185).
- Tom: l. 47 perde "Prefira a pergunta específica com duas opções (por exemplo, instalação ou manutenção)" (RE5); l. 48 "Responda antes de perguntar" limitada à pergunta direta (RE4); acrescenta RE4, RE5, RE7 e "não comente a situação do lead de volta".
- Travas: 1ª trava (l. 151) substituída por RE8 e RE6; l. 157 (preço ou prazo) substituída por RE3; acrescenta RE1 ("nunca diga que não atende; diga que vai confirmar com a equipe"), RE2 (`ja_cliente`) e RE9 (oferta de humano). Contrato de saída: l. 194 (`resposta` vazia), 196 (`desvios`) e 197 (`vagos`) reescritas por RE6 e RE8.
- Trocas: A (l. 60–75), D (l. 98–117), E (l. 120–123) e H (l. 138–145) reescritas por RE5, RE8, RE9 e RE10; B (l. 81) perde "e loja está entre os segmentos que atendemos". C, F e G ficam. Toda `resposta` de exemplo segue os limites da 006-2 (≤ 400 caracteres, um "?" em `perguntar`, nenhum nos outros).
- README repete o prompt (006-1 R8, T10 continua).

## Nova leitura humana (refaz T18)

Depois de 3 rodadas da branch, o responsável lê a tabela do conjunto de ajuste inteiro (33 casos mais os novos) e marca sim/não por item, com o item 12 novo: "Abertura natural; não lista serviços; não confirma atendimento nem endereço; não ecoa o telefone; não comenta a situação de volta". Passa quando todo item aplicável é "sim" em todo caso não silenciado. Qualquer "não" reabre a 006 de novo, sem PR.

## Testes de aceite

| T | C | Entrada | Ação | Resultado | Tipo / arquivo |
|---|---|---|---|---|---|
| T1 | C1 | saída `{segmento:'residencial', telefone:'48 99999-0004', qualificado:false, proxima_acao:'encaminhar_vendas', resposta:'...'}` | validar | válida, `ressalvas = ['residencial']` | unidade, `tests/validacao.test.ts` |
| T2 | C1, C2 | a mesma com `cidade:'Joinville'`, segmento comercial; a mesma com segmento comercial, cidade São José, `qualificado:false` | validar | válida, `ressalvas = ['fora_regiao']`; inválida `vendas_exige_qualificado` | unidade |
| T3 | C1 | `segmento:'residencial'`, `proxima_acao:'perguntar'`; `cidade:'Joinville'`, `perguntar`, abaixo do teto | validar | válidas (antes: `recusa_exige_encerrar`; `duvida_sem_telefone_exige_encerrar`) | unidade |
| T4 | C3 | `urgencia:'alta'`, `ja_cliente:null`, qualificado, `perguntar`; o mesmo com `ja_cliente:true` | validar | válida; `urgencia_alta_exige_vendas` | unidade |
| T5 | C3 | casos a04, n22, n26 | avaliar ajuste | a04 `perguntar`; n22 `encaminhar_vendas` com `ja_cliente = true`; n26 `encaminhar_vendas` sem dígitos | avaliação |
| T6 | C4 | `telefone:'48 99999-0002'`, resposta "Ligamos para 48999990002 hoje"; resposta "pelo número que você passou" | validar | `resposta_sem_telefone_do_lead`; válida | unidade, `tests/resposta.test.ts` |
| T7 | C5 | n06, n09, n10 | avaliar ajuste, 3 rodadas | `perguntar`; nenhuma resposta contém "instalação" ou "manutenção"; n06 contém "ajudar" | avaliação |
| T8 | C6 | `ignorar`, `vagos:1`, todos os dados `null`, histórico `[u:"oi", a:saudação, u:"?"]`; `ignorar`, `vagos:1`, `cidade` preenchida; `ignorar`, `vagos:2`, `cidade` preenchida, `qualificado:false` | validar | válida; `ignorar_fora_do_permitido`; válida | unidade |
| T9 | C6 | `encaminhar_vendas`, `resposta:''`, `vagos:2`, qualificado; o mesmo com `vagos:1`; `ignorar`, `vagos:3`, qualificado, sem `silencio_ocorrido` | validar | válida; `resposta_vazia`; válida | unidade |
| T10 | C7 | `ignorar`, `desvios:2`, telefone, qualificado; `ignorar`, `desvios:2`, sem dado; `perguntar`, `desvios:2` | validar | válida; válida; `desvio_exige_silencio` | unidade |
| T11 | C1 | n20, n21, g11 | avaliar | ação e `qualificado` iguais ao esperado em 3 rodadas | avaliação |
| T12 | C5 | turno iniciado com `agora` em 15h de Brasília | iniciar turno | prompt montado contém "tarde"; às 21h, "noite"; às 8h, "manhã"; às 4h, "noite" | unidade, `tests/turno.test.ts` |
| T13 | C6 | n07, n19, n19b, n24, n30 | avaliar | ação e `vagos` iguais ao esperado em 3 rodadas; n24 nunca `encaminhar_vendas` | avaliação |
| T14 | C7 | n01, n02, n03, n25 | avaliar | ação e `desvios` iguais; n01 sem "climatização"; n03 e n25 sem "encerrar" | avaliação |
| T15 | C8 | a10, n23, n27, n27b | avaliar | a10 com marcador e "pessoa" ou "humano"; n23 e n27b `encaminhar_humano`; n27 `perguntar` | avaliação |
| T16 | C9 | a09 | avaliar | `perguntar`, um "?", resposta não começa por "Valores" nem "Preço" | avaliação |
| T17 | C10 | a02, a13 | avaliar | `perguntar`; a02 sem "atendemos" nem "São José" | avaliação |
| T18 | C11 | tabela de 3 rodadas | leitura humana | itens 6, 7, 11 e 12 "sim" em todo caso aplicável; sem "não" | manual |
| T19 | C11 | caso a02 na tabela | gerar tabela | item 7 = n/a; n01 item 7 avaliado | unidade, `tests/tabela.test.ts` |
| T20 | C14 | prompt 1.4.0 | validar prompt | versão 1.4.0, 7 seções, trocas com ≤ 400 caracteres e um "?" em `perguntar`; zero "Obrigado por procurar", "atendemos sim", "só consigo tratar", "instalação ou manutenção" | unidade, `tests/prompt.test.ts` |
| T21 | C12 | `email:'ana.souza@gmail.com'`, `telefone:null`, residencial, `encaminhar_vendas`, histórico com o e-mail numa fala do lead; o mesmo sem o e-mail no histórico; `email` preenchido, em escopo, `qualificado:true`, `telefone:null` | validar | válida, `ressalvas = ['residencial']`; `email_nao_confere`; pendente (P1) | unidade |
| T22 | C12 | n28, n29 | avaliar | n28 `encaminhar_vendas` com `email`; n29 `responder_e_encerrar` citando contato, em 3 rodadas | avaliação |
| T23 | C13 | n11, n31 | avaliar | n11 `perguntar`, `desvios = 0`, sem as palavras vetadas; n31 `ignorar` | avaliação |
| T24 | C12 | `encaminhar_humano` com `email` real e `telefone:null`; `responder_e_encerrar` com `email` real e `ressalvas` vazia | validar | válida; `encerrar_com_telefone_exige_humano` | unidade |

## Emendas às specs anteriores (edições curtas após a aprovação)

- 001: R1, trocar a última frase por "`qualificado = false` não recusa o lead; residencial e cidade fora da lista seguem a 006-3 RE1" (item 4 depende de P1). R3: tirar "Lead invalidado (…) encerra na mesma resposta, sem pedir telefone" e deixar só `fora_escopo`; recusa de dado continua não encerrando, salvo o pedido único de contato da RE1. R4: "só com `ja_cliente = true` (006-3 RE2)". R5: cidade fora da lista deixa de ser dúvida; "com telefone" vira "com contato (telefone ou e-mail)". § Contrato: `ja_cliente`, `email`, `ressalvas`, validação cruzada pela tabela da 006-3. C1 e T1: `perguntar`; T5: `perguntar`; T6: lista curta e depois vendas. Checklist: item 12.
- 006-1: R1 (abertura e "responde antes de perguntar") → RE4/RE5; R4 itens 1–2 → RE8; R5 itens `vagos` → RE6; R7 (`silencio_ocorrido`) → RE8 (só permissão de `ignorar`); R9 → tabela da 006-3; C3, C4 e C9 → C6, C7, C11 da 006-3.
- 006-2: Trocas A, B, D, E, H; tabela de casos (linhas a01, a03, a04, n02, n07, n11, n19); T6, T14, T15 apontam para os `esperado` novos desta parte.
