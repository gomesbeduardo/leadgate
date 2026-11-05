# 006-3 — Falas e modo de interação: emenda após a leitura humana (regras)

**Status:** aprovada pelo responsável em 05/11/2026, com as suposições S1 a S11; reabre a 006 antes do PR.
**Partes:** 3ª de 4. Ordem de leitura: [006-1](006-1-regras.md), [006-2](006-2-prompt-e-avaliacao.md), esta (regras, contrato, prompt, critérios) e [006-4](006-4-emenda-casos.md) (casos, linhas do prompt, testes T1–T24 e emendas às specs anteriores). Onde esta parte diz "substitui", o texto daqui vence o das duas e o da [001](001-filtro-leads.md).
**Issue:** #11.
**Pedido:** notas literais do responsável na leitura de 33 conversas (T18 reprovado). As que fixam regra:
- a01: "Não comece com 'Obrigado por procurar a CentralEng.', ninguém fala assim, comece com um Oi (...) pode apenas esclarecer que não trabalham com residência mas que pode tentar ver com a equipe se há algum dia livre na agenda. Nunca se desfaça do cliente, nem negue o serviço. Mas também não abrace tudo, a decisão final deve ser pra equipe de venda, então na dúvida, fala que vai confirmar e nesse meio tempo é onde iria disparar o aviso pra vendas assumir de forma 'seamless'."
- a02: "'São José nós atendemos sim' ninguém fala assim (...) iria pular direto para 'Quantos aparelhos...'. Se for afirmar, seja direto, e também não confirme endereço se já sabe, só pergunte ou cite endereço em caso de dúvida ou omissão."
- a03: "'Infelizmente não atuamos diretamente na região, mas posso te encaminhar pra equipe ver se consegue te encaixar na escala' ou algo do tipo."
- a04: "nem tudo precisa ser pontuado de volta pro Lead (...) nem sabe se esse cara já é cliente... Urgência só para quem já é nosso. (...) não precisa retornar o número dele na fala, apenas diga 'Iremos entrar em contato pelo número que nos passou'."
- a09: "Que instalação? Nem sabe, não foi atrás. A ideia é entender o cliente e não simplesmente se desfazer porque falou de valor direto. Tente buscar mais info. Pergunta nome, contato, cidade, qual a necessidade do serviço."
- a10: "como perguntou, é necessário afirmar isso. Mas também diga que se preferir pode pedir por um humano e depois disso repassa pro time de vendas."
- a13: "tem q ir mais atrás do que/quem é. Nenhum lead vai chegar assim do nada e já ter confirmação que será atendido. (...) parece que tu promete atendimento para todos..."
- n01: "Deveria ter ficado quieto, sem falar o que faz. Se quiser responder fala que não viu mas que por conduta da empresa não pode ficar falando sobre isso." n02: "na 2 talvez nem responda." n03: "Foi muito grosso na hora de fechar, deveria ser mais 'suave'."
- n06: "'Boa tarde/dia/noite, aqui é a CentralEng, com o que posso ajudar?'. Fica mais leve." n07: "eu não responderia se a segunda mensagem for um ? depois de um oi seco." n09: "Ficou genérica e dá pra ver que é automatizada." n10: "Não saia falando do produto/serviço, parece desesperado." n11: "Caiu no golpe da receita de bolo e se perdeu. Mandou mensagem quando não devia." n19: "Totalmente errado (...) Ele mandou um asdfg...."
- Rodada de respostas (fecha as antigas P1–P7). Contato: "Como é pelo whatsapp (no real) teoricamente já temos o número, o que dá pra pedir é uma via extra de contato, outro numero ou email nesse caso". Mensagem mista: "Se for receita de bolo, assunto aleatório, n responde, se parece com algo que atende, aí pergunta."
- Aprovados sem mudança: n04, n08, n15, n16, a07, a08, a14.

## Problema

Na leitura, o responsável rejeitou o comportamento do prompt 1.3.0: o agente recusa lead (residencial, fora da região) em vez de passar a decisão a vendas; trata urgência de desconhecido como de cliente; confirma atendimento e endereço antes de saber quem é o lead; se desfaz de quem pergunta preço; lista os serviços na abertura; comenta a situação do lead de volta; ecoa o telefone; avisa e fecha com rispidez em fora de assunto; e encaminha a vendas um lead que mandou "asdfg".

## Escopo

Entra: RE1–RE10, contrato (`ja_cliente`, `email`, `ressalvas`), validação, prompt 1.4.0, período do dia no turno, casos, testes e nova leitura humana (006-4). Fora: § Fora do escopo.

## Regras da emenda

### RE1. Ninguém é recusado: a decisão final é de vendas (substitui 001 R1 §final, R3 "Lead invalidado", R5 "cidade fora da lista")

- `qualificado` continua sendo a R1 da 001 (serviço atendido, segmento aceito, cidade da lista, telefone). Só muda o que ele decide: **não decide mais quem chega a vendas**.
- Lead residencial ou de cidade fora da lista segue a coleta normal (RE3) e vai a vendas com `encaminhar_vendas`, `qualificado = false` e a ressalva marcada (`ressalvas`, § Contrato). O agente nunca diz "não atendemos" nem decide que o local é inviável: não há mapeamento por região, quem decide é vendas.
- Residencial: na primeira resposta em que o segmento fica claro, uma frase diz que o foco da empresa é comercial e industrial e que vai confirmar com a equipe se há espaço na agenda; na mesma mensagem segue a coleta (uma pergunta). Sem detalhar o que a empresa faz ou não.
- Cidade fora da lista: uma frase no espírito de "não atuamos diretamente na região, mas posso encaminhar para a equipe ver se encaixa na escala", e segue a coleta.
- A frase de confirmar com a equipe é o próprio aviso a vendas; não há segundo passo visível ao lead.
- `tipo_servico = fora_escopo` (não é climatização) continua recusa: `qualificado = false`, `responder_e_encerrar`, sem pedir telefone.
- **Contato do lead residencial ou fora da região.** Na demonstração (chat web, sem número de canal) o agente pede **uma vez** telefone ou e-mail, numa pergunta só ("Me passa um telefone ou e-mail para a equipe retornar?"). Dá um dos dois: `encaminhar_vendas` com `ressalvas` e `telefone` ou `email` preenchido. Recusa ("não passo contato"): `responder_e_encerrar` suave citando `empresa.contato`, sem insistir. Só aqui a recusa de contato encerra; lead em escopo segue a 001 R5 (recusar um dado não encerra antes do teto, Troca F).
- Intenção para o canal real, sem código nesta spec: no WhatsApp o número do canal já é o telefone e a pergunta vira "via extra de contato" opcional (outro número ou e-mail).

### RE2. Urgência só para quem já é cliente (substitui 001 R4)

- Campo novo `ja_cliente` (`true | false | null`): o lead disse que já é cliente (`true`), que não é (`false`) ou não falou (`null`). Não há base para conferir; vale o que o lead diz.
- Atalho da R4 (só obrigatórios, pula a lista curta, `encaminhar_vendas` assim que fecham) **só** com `ja_cliente = true` e `urgencia = alta`.
- Lead novo com emergência: `urgencia = alta` registrada, coleta normal (RE3), **inclusive a lista curta inteira**, uma pergunta por mensagem. A resposta não comenta a gravidade de volta, não promete prazo e vai direto à pergunta. Ao fim da lista curta, `encaminhar_vendas` com fechamento no espírito de "Iremos entrar em contato pelo número que nos passou", **sem repetir o número** (RE7).

### RE3. Ordem de coleta e pergunta de preço (mantém 001 R3)

- Ordem da 001 R3 continua: serviço, segmento, cidade; depois nome e telefone; depois lista curta. Teto 8. A nota a09 se lê como "busque a informação, não se desfaça", não como ordem nova.
- Pergunta de preço ou prazo não encerra nem desvia a coleta. A resposta nunca abre com "valores quem passa é vendas"; pergunta o que o lead precisa (próximo dado da ordem), no espírito de "Me conta o que você precisa instalar e onde fica?". No máximo uma oração curta pode dizer que valores e datas são combinados pela equipe comercial, só depois da pergunta ou na mesma frase. Nada é inventado (Travas da 001 R10 continuam).

### RE4. Não confirmar atendimento nem endereço antes de saber quem é o lead (substitui 006-1 R1 "responde antes de perguntar", em parte)

- Lead que descreve o pedido (a02, a13) não recebe confirmação de atendimento ("nós atendemos sim", "pode deixar") nem repetição de endereço ou cidade já informados. A resposta vai direto à próxima pergunta.
- Cidade ou endereço só aparece na resposta para tirar dúvida ou quando o lead omitiu.
- Pergunta direta "vocês fazem X?" (n13) continua com resposta direta, em poucas palavras ("Fazemos."), e a pergunta seguinte, sem explicar segmento nem região.
- Sem frase de reconhecimento da situação do lead antes da pergunta (a04).

### RE5. Abertura leve, sem listar serviços (substitui 006-1 R1 "Devolve o cumprimento (...) e já pergunta o objetivo"; 006-2 Trocas A e E; prompt Tom l. 47)

- O serviço informa ao prompt o período do dia pela hora de Brasília. Hoje não existe: `iniciarTurno` (`src/fluxo/turno.ts`) monta o prompt por `montarPrompt(modelo, cfg)` sem data, mas já recebe o relógio `agora`. Recomendação: marcador `{{periodo_do_dia}}` preenchido em `iniciarTurno` a partir de `agora()` em `America/Sao_Paulo`; faixas (S7): manhã 05:00–11:59, tarde 12:00–17:59, noite 18:00–04:59.
- "oi", "bom dia", "tá um calor insuportável aqui" ou mensagem sem pedido: saudação curta e pergunta aberta. Frase base: "Boa tarde, aqui é a {{empresa.nome}}, com o que posso ajudar?" (não bate com "como posso ajudar hoje" de `frases_bot` nem com "como posso ajudar?" vetado no Tom l. 54; manter a forma "com o que"). Variação aceita: espelhar a saudação do lead ou só o período. O prompt varia; o validador não fixa texto.
- Em nenhuma mensagem o agente lista os serviços ("instalação ou manutenção?") antes de o lead dizer o que precisa. Se o lead já falou do pedido ("queria ver um ar pra loja"), a pergunta é aberta sobre a necessidade ("Me conta o que você precisa para a loja?"), não um menu. Pergunta com duas opções (006-1 R1) só sobre dado técnico, depois que a necessidade está dita; o Tom deixa de recomendá-la como padrão.
- Sem frase genérica sobre calor, conforto ou produto (n09).
- `resposta.frases_bot` (`config/empresa.json`) ganha "Obrigado por procurar" (fecha a01).
- A frase base fica só nas Trocas (seção de exemplos, que `resposta.ts` exclui da comparação de vazamento); no Tom aparece só em forma curta, senão a resposta que a repete cai em `resposta_vazamento_prompt` (trecho de 36 caracteres; S8).

### RE6. Mensagem sem sentido (substitui 006-1 R5 itens `vagos` 1–3 e 006-2 Troca A, linhas 2–4)

Vaga continua como na R5 (sem sentido aparente, julgada pelo modelo). Três escadas:
- **Sem nenhum dado ainda** (lead só cumprimentou, agente só saudou; n07): 1ª vaga → silêncio (`ignorar`, `resposta` vazia, `vagos = 1`). 2ª → pergunta aberta reformulada (`perguntar`, `vagos = 2`). 3ª → como hoje: sem telefone `responder_e_encerrar` citando `empresa.contato` (n08, aprovado).
- **Lead qualificado** (n19): 1ª → "Não entendi, pode repetir?" (`perguntar`, `vagos = 1`; a frase é a pergunta do turno). 2ª → silêncio e o caso vai a vendas sem mensagem: `encaminhar_vendas`, `resposta` vazia, `vagos = 2`. Seguinte → `ignorar`, `vagos = 3`, sem novo encaminhamento.
- **Com dado, sem qualificar**: 1ª → "Não entendi, pode repetir?" (`perguntar`, `vagos = 1`). 2ª → silêncio sem rotear (`ignorar`, `resposta` vazia, `vagos = 2`); a conversa fica aberta. 3ª → como a 001 R5 hoje: sem contato, `responder_e_encerrar` citando `empresa.contato`; com contato, `encaminhar_humano` com uma frase de fechamento (S9).
- Troca A, linha 1 ("oi, tudo bem?") passa a seguir RE5. Mensagem com qualquer dado zera `vagos`, como hoje.

### RE7. Nunca ecoar o telefone (nova)

A `resposta` não contém os dígitos do `telefone` extraído (comparação só por dígitos, a partir de 8 seguidos). Fechamento diz "pelo número que você passou". Guarda nova `resposta_sem_telefone_do_lead` em `src/validacao/resposta.ts`.

### RE8. Fora de assunto no meio: uma frase leve, silêncio, fechamento suave (substitui 006-1 R4 itens `desvios` 1 e 2; 006-2 Troca D)

- `desvios = 1`: uma frase curta que não diz o que a empresa faz nem "este canal é só para…" (ex.: "Não vi, e por conduta da empresa não posso falar disso."), seguida da pergunta pendente (`perguntar`).
- `desvios = 2`: silêncio (`ignorar`, `resposta` vazia), em qualquer estado do lead. Sem aviso de encerramento.
- `desvios = 3`: sem telefone, `responder_e_encerrar` suave: sem "vou encerrar", sem advertência; diz que fica à disposição quando o lead quiser falar do serviço e cita `empresa.contato`. Com telefone: continua a 006-1 R4 (silêncio; `encaminhar_vendas` com `resposta` vazia se qualificado, `ignorar` se não).
- Contagem: `desvios` conta mensagens seguidas do lead fora de assunto, inclusive várias no mesmo turno unido (como n18 já faz). O sinal `silencio_ocorrido` (chat → `app.ts` → `FATO_SILENCIO`) **não muda** de mecânica nem de código: significa só "já houve silêncio nesta conversa" e vale só como permissão de `ignorar` para lead qualificado; deixa de forçar `desvios = 3`. O modelo conta pelo histórico; manda a vendas uma vez só, na 3ª; da 4ª em diante `ignorar` com `desvios = 3`. Duplicidade em vendas por erro de contagem continua efeito aceito (006-1 R4).

### RE9. Pergunta sobre IA: confirma e oferece humano (acrescenta a 006-1 R2 e 001 R11)

- À pergunta sincera, a resposta confirma em uma frase (marcador de IA, como hoje), diz que se o lead preferir pode pedir para falar com uma pessoa do time, e faz a pergunta pendente (`perguntar`, um "?").
- Lead que pede a pessoa, com contato (telefone ou, na demonstração, e-mail): `encaminhar_humano` e uma frase dizendo que alguém do time entra em contato pelo número (ou e-mail) passado (S3).
- Sem contato: uma pergunta pedindo telefone ou e-mail (`perguntar`); com a resposta, `encaminhar_humano`. Recusa: `responder_e_encerrar` suave citando `empresa.contato` (S10).
- Oferecer humano só quando o lead perguntou sobre IA; nunca por iniciativa própria.

### RE10. Mensagem mista na abertura (n11)

- Primeira mensagem só aleatória ("Me dá uma receita de bolo de cenoura"): silêncio, como hoje (`ignorar`, `desvios = 1`).
- Primeira mensagem (ou turno unido) com parte aleatória e parte que parece o que a empresa atende ("receita de bolo / queria orçamento de ar pra minha loja"): resposta só à parte do serviço, sem citar a parte aleatória nem preço: "Boa tarde, aqui é a {{empresa.nome}}. Me conta o que você precisa para a loja?" (`perguntar`, `desvios = 0`; RE3 e RE5 valem).

## Contrato (acrescenta à 001 § Contrato e 006-1 R6)

- Saída do modelo ganha `ja_cliente: true | false | null` e `email: string | null` (obrigatórios no schema Zod de `contrato.ts` e no JSON Schema de `schemaSaida`, `turno.ts`). `vagos` e `desvios` continuam 0–3.
- `email`: o e-mail que o lead escreveu, ou `null`. Regra anti-invenção `email_nao_confere` (S11): o valor, sem maiúsculas e sem espaços nas pontas, aparece literalmente em alguma mensagem `user` do histórico; senão, violação cruzada. O serviço não extrai e-mail.
- **Contato real** = `telefone` real (regra `telefone_nao_confere` de hoje) ou `email` real. Vale para vendas com `ressalvas` e para `encaminhar_humano`. E-mail sozinho não qualifica: lead em escopo com só e-mail fica `qualificado = false`, ressalva `so_email`, e vai a vendas (a 001 R1 item 4 segue exigindo `telefone`). A subida de nível por ter e-mail é da faixa da spec 007.
- Saída do serviço (não do modelo) ganha `ressalvas: string[]`, calculada em `contrato.ts`: `"residencial"` quando `segmento` informado e fora de `segmentos_aceitos`; `"fora_regiao"` quando `cidade` preenchida, fora da lista e não parecida (até 2 edições, `cidadeParecida` de hoje); `"so_email"` quando há `email` real sem `telefone` e os outros obrigatórios estão fechados. Vazia nos demais casos. Vai junto na rota de vendas e humano do n8n; nenhum nó novo. (Nome e lugar: recomendação, S1.)
- Período do dia: entrada do turno, não do contrato de saída.

Validação cruzada (códigos de `src/validacao/contrato.ts` e `resposta.ts`; substitui as linhas citadas da 001 e da 006-1 R9):

| Código | Hoje | Passa a |
|---|---|---|
| `recusa_exige_nao_qualificado` | `fora_escopo` ou segmento não aceito → `qualificado = false` | sem mudança |
| `recusa_exige_encerrar` | idem → `responder_e_encerrar` | só `fora_escopo` |
| `vendas_exige_qualificado` | exige `qualificado = true` | `qualificado = true` **ou** (`ressalvas` não vazia e contato real) |
| `cidade_fora_exige_nao_qualificado` | só dentro de `precisaRotear` | sempre que `cidade` fora da lista e não parecida |
| `duvida_com_telefone_exige_humano`, `duvida_sem_telefone_exige_encerrar`, `duvida_sem_telefone_exige_contato` | cidade fora (abaixo do teto, salvo parecida) ou teto com dado faltando | cidade fora **deixa de disparar**; só teto com dado faltando. Nesse teto, com contato real e `ressalvas` não vazia, `encaminhar_vendas` também vale |
| `humano_exige_telefone` | telefone real | vira `humano_exige_contato`: telefone ou e-mail real |
| `encerrar_com_telefone_exige_humano` | telefone real | contato real (telefone ou e-mail), salvo `desvios = 3` sem telefone: a RE8 encerra, inclusive com só e-mail |
| `encerrar_sem_telefone_exige_contato`, `confianca_baixa_sem_vendas`, `ignorar_exige_resposta_vazia`, `telefone_nao_confere` | existentes | sem mudança; `email_nao_confere` novo, mesma lógica do telefone |
| `urgencia_alta_exige_vendas` | `urgencia = alta`, qualificado, `desvios = 0` → vendas | só com `ja_cliente = true` e `vagos = 0` a mais; sem isso, `urgencia = alta` não obriga nada |
| `qualificado_exige_acao` | qualificado: `perguntar`, vendas, ou `ignorar` com `silencio_ocorrido` | aceita `ignorar` também com `desvios = 2` e `vagos = 3` |
| `ignorar_fora_do_permitido` | abertura fora de assunto ou fim silencioso | acrescenta: `vagos = 1` com todos os campos de dado `null` e sem contato; `vagos = 2` com dado e `qualificado = false`; `vagos = 3` com `qualificado = true`; `desvios = 2` em qualquer estado; `desvios = 3` com telefone (qualificado ou não) |
| `desvio_exige_pergunta` | `desvios`/`vagos` 1 ou 2 exigem `perguntar` | só `desvios = 1`, `vagos = 1` (com dado) e `vagos = 2` (sem dado) |
| `desvio_exige_silencio` | não existe | `desvios = 2` → `ignorar`; `vagos = 2` com dado: qualificado → `encaminhar_vendas` com `resposta` vazia, não qualificado → `ignorar` |
| `limite_exige_encerrar` (`desvios = 3`) | sem telefone encerrar; com telefone vendas vazio se qualificado sem silêncio, senão `ignorar` | sem telefone encerrar; com telefone e não qualificado `ignorar`; qualificado sem silêncio, vendas vazio; qualificado com `silencio_ocorrido`, vendas vazio **ou** `ignorar` (RE8: o silêncio da 2ª já liga o sinal, e o modelo conta pelo histórico); o texto suave é leitura |
| `limite_exige_encerrar` (`vagos = 3`) | sem telefone encerrar; qualificado vendas; senão humano | sem contato → `responder_e_encerrar` com contato; qualificado → `ignorar`; com dado sem qualificar e contato → `encaminhar_humano` |
| `resposta_vazia` (`resposta.ts`, `vazioPermitido`) | vazia só com `ignorar` ou vendas com `desvios = 3` | acrescenta vendas com `vagos = 2` |
| `resposta_sem_telefone_do_lead` | não existe | RE7 |

## Prompt (versão 1.4.0)

As linhas do `prompts/agente.md` 1.3.0 a reescrever, por regra, estão na 006-4 § Prompt.

## Critérios

- C1 — Dado residencial ou cidade fora da lista com contato ao fim da coleta, então `encaminhar_vendas`, `qualificado = false`, `ressalvas` com o motivo, e nenhuma resposta diz que não atende (T1, T2, T3, T11).
- C2 — Dado `encaminhar_vendas` com `qualificado = false` e `ressalvas` vazia, então o validador rejeita (T2).
- C3 — Dado `urgencia = alta` com `ja_cliente` nulo ou falso e obrigatórios fechados, então `perguntar` (lista curta) e nenhum validador exige vendas; ao fim da lista, `encaminhar_vendas` sem os dígitos do telefone; com `ja_cliente = true`, o atalho da R4 vale (T4, T5).
- C4 — Dado telefone extraído, então a `resposta` não contém seus dígitos (T6).
- C5 — Dado primeira mensagem sem pedido ("oi", "tá um calor insuportável aqui"), então saudação curta mais pergunta aberta, sem "instalação" nem "manutenção", sem frase genérica (T7, T12).
- C6 — Dado "?" depois de "oi" e da saudação, então `ignorar`, `vagos = 1`; dado lead qualificado com mensagem sem sentido, então 1ª `perguntar` curto, 2ª `encaminhar_vendas` com `resposta` vazia, 3ª `ignorar`; dado lead com dado não qualificado, 2ª `ignorar`, `vagos = 2` (T8, T9, T13).
- C7 — Dado fora de assunto no meio, então 1º `perguntar` com frase que não cita o que a empresa faz; 2º `ignorar` em qualquer estado; 3º sem telefone `responder_e_encerrar` suave com contato; com telefone, como 006-1 R4 (T10, T14).
- C8 — Dado pergunta sincera sobre IA, então marcador de IA, oferta de pessoa do time e uma pergunta; dado lead que pede pessoa com contato, `encaminhar_humano`; sem contato, uma pergunta pedindo contato e depois `encaminhar_humano` (T15).
- C9 — Dado pedido com preço ("Quanto custa a instalação e dá pra fazer amanhã?"), então `perguntar` sobre a necessidade, sem abrir com a frase de valores (T16).
- C10 — Dado lead que descreve o pedido, então a resposta não confirma atendimento nem repete cidade/endereço já ditos (T17, leitura).
- C11 — Dado a tabela, então o item 7 fica n/a em caso sem mensagem fora de assunto; a nova leitura humana aprova todos os itens aplicáveis em todos os casos não silenciados (T18, T19).
- C12 — Dado lead residencial ou fora da região perguntado uma vez por contato: se passa e-mail dito literalmente, `encaminhar_vendas` com `email` preenchido e `telefone` nulo; se recusa, `responder_e_encerrar` citando `empresa.contato`; `email` ausente das mensagens do lead é rejeitado; e-mail real vale como contato para `encaminhar_humano` e impede `responder_e_encerrar` (T21, T22, T24). Lead em escopo com só e-mail: `qualificado = false`, ressalva `so_email`, `encaminhar_vendas`; com `qualificado = true` e `telefone` nulo o validador rejeita (`qualificado_exige_telefone` não muda).
- C13 — Dado primeira mensagem mista (n11), então `perguntar`, `desvios = 0`, resposta sem "bolo", "receita", "valor", "preço" nem "orçamento"; dado primeira mensagem só aleatória, `ignorar` (T23).
- C14 — Dado prompt 1.4.0, então passa no teste de prompt e não contém as frases vetadas (T20).

## Fora do escopo

Spec 007: faixa quente/morno/frio, cartão do lead, resumo, extração de porte, decisor e prazo. Base de clientes ou conferência de `ja_cliente`. Mapeamento geográfico. Envio real a vendas (continua simulado). Canal WhatsApp real (número do canal como telefone): só a intenção em RE1. Extração de e-mail pelo serviço; guarda contra ecoar o e-mail. Mudança na tela de conversa ou em `app.ts` (`silencio_ocorrido` fica como está; a única linha nova em `app.ts` é `ressalvas` no retorno só de painel, para a avaliação ler). Validador de "frase genérica" ou de abertura (só leitura humana). Casos `reservado`.

## Confirmado, inferido e pendente

- Confirmado (responsável, grilling e rodada de respostas): RE1 inclusive o pedido único de contato na demonstração; RE2 inclusive lista curta e fechamento "pelo número que nos passou" para lead novo; RE3 com a ordem da 001 R3; RE5; RE6 inclusive silêncio na 2ª vaga de lead com dado; RE8 inclusive `silencio_ocorrido` sem mudança; RE9 inclusive pedir contato antes de humano; RE10; item 7 n/a sem fora de assunto; reabrir a 006 na mesma branch com nova medição e nova leitura.
- Confirmado (código, lido nesta rodada): regras e códigos de `contrato.ts` da tabela; `resposta.ts` (`frases_bot`, `vazaPrompt` com exclusão das Trocas, `vazioPermitido`); `turno.ts` sem período do dia e com `agora` injetável; `config/empresa.json` `frases_bot`; linhas do prompt 1.3.0 citadas em § Prompt.
- Inferido: S1 — `ressalvas` calculada pelo serviço (nome e lugar são recomendação). S2 — contagem de `desvios` por mensagem já é o que n18 faz; `silencio_ocorrido` só libera `ignorar` (RE8). S3 — lead que pede pessoa vai por `encaminhar_humano`, mesmo caminho simulado (RE9). S4 — 3ª vaga do lead sem dado continua encerrando com contato (n08 aprovado). S5 — oferta de humano é oração, não pergunta: continua um "?" (RE9). S6 — `ja_cliente = false` só registra. S7 — faixas do período do dia (RE5). S8 — frase base só nas Trocas por causa de `resposta_vazamento_prompt` (RE5). S9 — 3ª vaga de lead com dado não qualificado segue a 001 R5 (RE6). S10 — recusa de contato ao pedir pessoa encerra como na RE1 (RE9). S11 — `email_nao_confere` espelha `telefone_nao_confere` (§ Contrato).
- Pendente: nada.

## Perguntas abertas

- Nenhuma. Em 05/11, na implementação, o responsável decidiu pela RE8 contra a linha antiga de `limite_exige_encerrar` (`desvios = 3`). P1 (e-mail sozinho qualifica?) fechada em 05/11/2026. Resposta do responsável: "Não qualifica automaticamente, mas já sobe o nível um pouco."

## Emendas às specs anteriores

Lista das edições curtas em 001, 006-1 e 006-2, a aplicar após a aprovação: 006-4 § Emendas às specs anteriores.
