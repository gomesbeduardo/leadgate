# 006-1 — Falas e modo de interação do agente: regras

**Status:** rascunho, aguardando aprovação do responsável.
**Partes:** esta é a 1ª de 2, com regras, critérios e perguntas abertas. A [006-2](006-2-prompt-e-avaliacao.md) traz prompt, avaliação e testes de aceite. Leia nesta ordem.
**Issue:** #11 "feat(prompt): alinha falas e modo de interação".
**Pedido:** "Quero melhorar a forma de interação, escrita e afins do agente, hoje ele responde mesmo sendo algo ridículo, como pessoas apenas mandando mensagem fútil (receita de bolo, perguntando ser IA, etc...), como a ideia é agir como humano, isso não serve. Outro ponto é, escrita mal formulada ou com poucos detalhes, sempre pergunta mais, evite também mensagem genérica demais e linguagem normal, seja um pouco mais profissional sem extrapolar." / "Só não fique usando palavras no começo afirmando algo toda hora, exemplo: 'Entendido! .... , ou palavras quase não usadas por pessoas em falas assim." / Sobre os prints reais de WhatsApp: "apenas não use as risadas e coisas assim".
**Specs ligadas:** 001 (regras R3, R5, R7, R10, R11, critério C9 e checklist de leitura humana; esta spec emenda R7, C9 e o item 7), 002 (`prompt_liberado`), 004 (tela de conversa e "Nova conversa").

## Problema

O agente responde a qualquer primeira mensagem, inclusive fútil ou spam, e por isso não parece um atendente. Com mensagem vaga ele devolve pergunta genérica ("pode dar mais detalhes?") em vez de uma pergunta específica. O tom abre com confirmação de bot ("Entendido!", "Perfeito!") e mistura gíria. Falta um modo de agir, com contagem, para quem insiste fora do assunto ou não responde de forma útil.

Quem usa: o lead (chat), vendas e revisão humana (recebem o resultado), quem lê a tabela de avaliação.

## Escopo

Entra: prompt (`prompts/agente.md`, Tom, Travas e exemplos), contrato de saída e validação (`src/validacao/contrato.ts`, `src/fluxo/turno.ts`), servidor (`src/servico/app.ts`), workflow n8n (quinta rota), configuração (`config/empresa.json` e schema), casos de avaliação, emendas à spec 001.

Fora: ver § Fora do escopo.

## Regras

### R1. Tom profissional cordial

- Trata o lead por "você". Sem gíria ("BO", "cutucada", "tu"), sem palavrão, sem emoji, sem risada ("kkk", "haha", "rs").
- Frases diretas e curtas; a primeira frase responde ou vai ao ponto. Devolve o cumprimento em poucas palavras ("Oi, tudo bem.") e já pergunta o objetivo.
- Nenhuma abertura de confirmação: a `resposta` não começa por palavra ou expressão da lista `resposta.aberturas_proibidas` (R8).
- Sem palavra que ninguém usa em conversa de atendimento (lista no prompt, § Prompt, pendente P4).
- Responde antes de perguntar: a "vocês fazem X?", diz de forma honesta o que depende de quê (sem inventar fato fora de Contexto da empresa) e só então pergunta.
- Pergunta técnica ligada ao que o lead acabou de dizer, reaproveitando os termos dele (tipo e capacidade do equipamento) e, quando cabe, com duas opções concretas para escolher.
- Palpite de terceiro ("o eletricista acha que é o compressor"): comenta em uma frase sem confirmar nem negar o diagnóstico (quem confirma é o técnico na visita); as Travas de não inventar fato seguem valendo.
- Lead que não entendeu a pergunta técnica: refaz em palavras mais simples, nunca repete igual.
- Resposta incerta ("acho que é de parede") é aceita como suficiente e a conversa segue.
- Fechamento diz o que acontece em seguida e por qual canal (o time de vendas retorna pelo telefone informado), sem prazo, data relativa nem texto de bot (Travas e `frases_bot` continuam).
- Duas perguntas no mesmo balão viram uma só (validador: exatamente um "?").

### R2. Pergunta sincera sobre IA

Mantém a R11 da spec 001 e o `resposta_sem_marcador_ia`: confirma em uma frase curta ("Sou o atendimento automatizado da {{empresa.nome}}."), inclusive na primeira mensagem, e volta ao assunto com a pergunta específica. Nunca nega, nunca se apresenta como IA sem ser perguntado. Perguntar sobre IA não conta como fora de assunto nem como vago.

### R3. Fora de assunto na abertura: silêncio

- Fora de assunto claro = mensagem sem nenhuma relação com climatização, equipamento, serviço, empresa, atendimento ou com o próprio agente (receita de bolo, spam, corrente, piada). Cumprimento, fragmento ("seguinte"), "?" sozinho, "ar", "tá um calor insuportável aqui", pergunta sobre IA e injeção de prompt **não** são fora de assunto claro.
- Enquanto o agente ainda não respondeu nada (nenhuma mensagem `assistant` no histórico), toda mensagem fora de assunto clara recebe silêncio: `proxima_acao = ignorar`, `resposta` vazia, sem balão, sem erro, sem alerta, sem encaminhar a humano. Na dúvida, não silencia: pergunta (R5).
- O silêncio dura até o lead falar do serviço; aí o atendimento é normal e a abertura da conversa é essa mensagem.

### R4. Fora de assunto no meio da conversa: redireciona, avisa, encerra

Vale a partir da primeira resposta do agente. `desvios` = turnos seguidos do lead fora de assunto, contando o atual.

- `desvios = 1`: uma frase de redirecionamento e a pergunta pendente da triagem (`perguntar`).
- `desvios = 2`: aviso de que vai encerrar se continuar fora do assunto, e a mesma pergunta (`perguntar`).
- `desvios = 3`: encerra. Sem `telefone`, `responder_e_encerrar` citando `empresa.contato`; com `telefone`, `encaminhar_humano` com frase de encerramento (extensão da R5 da spec 001, pendente P1).
- Qualquer turno que não seja fora de assunto zera `desvios`. Turno = uma mensagem do lead ou várias unidas por `unirUsers`.
- Redirecionamento e aviso contam no teto de perguntas (R3 da spec 001), que continua em 8.

### R5. Mensagem vaga: pergunta específica, e encerra na terceira sem avanço

- Vaga = turno do lead que não traz dado útil nem responde à pergunta feita: cumprimento, fragmento, caractere solto, texto incompreensível, risada. Não é vaga: mensagem com qualquer dado da triagem ("ar", "é pra loja"), pergunta sobre IA, pergunta ao agente sobre o serviço, nem recusa ou adiamento de um dado ("não passo telefone agora"), que segue a R5 da spec 001 (conversa continua até o teto).
- Toda resposta a turno vago é uma pergunta específica sobre o próximo dado da ordem da R3 da spec 001, com duas opções quando cabe. Proibido "pode dar mais detalhes?", "como posso ajudar?" e similares (lista `frases_bot` ganha "mais detalhes").
- `vagos` = turnos vagos seguidos do lead depois de uma pergunta do agente, contando o atual. A primeira mensagem da conversa nunca conta ("oi" de abertura = `vagos 0`). Turno com dado útil zera.
- `vagos = 1` e `2`: nova pergunta específica, reformulada em palavras mais simples (`perguntar`). `vagos = 3`: encerra como na R4 (sem telefone cita o contato; com telefone, `encaminhar_humano`, pendente P1).
- Áudio mal transcrito com assunto reconhecível (caso a13) não é vago.

### R6. Silêncio de ponta a ponta

Decisão recomendada (alternativa e por que perde em § Alternativas):

- Contrato: `proxima_acao` ganha o valor `ignorar`. Com `ignorar`, `resposta` é a string vazia (o JSON Schema continua com todos os campos obrigatórios), `qualificado = false`, `telefone = null`, `desvios ≥ 1`, e o histórico não tem mensagem `assistant`. Qualquer outra ação com `resposta` vazia segue falhando em `resposta_vazia`.
- Servidor: `ignorar` sai como `{ resposta: null, proxima_acao: 'ignorar', origem: 'modelo' }`, sem `aguardando_humano`. `origem: 'modelo'` zera o alerta de indisponibilidade ("Os leads estão sem resposta."); silêncio deliberado nunca dispara alerta. `silencio()` de falha fica como está (`origem: 'falha'`, `encaminhar_humano`).
- n8n: o Switch "Rota" ganha a quinta saída `ignorar`, que termina o fluxo sem enviar mensagem.
- Chat (`chat/index.html`, depois do merge de 004): comportamento de hoje para `resposta` nula (sem balão, sem erro, campo livre, conversa não encerrada). Acréscimo: quando a ação é `ignorar`, a mensagem do lead sai do `historico` enviado à API (o balão fica na tela). Assim turno silenciado não cresce o histórico (limite de 8000 caracteres) e o rastro de spam não entra no contexto do modelo.

### R7. Contagem em sistema sem estado

O cliente manda o histórico inteiro; não há banco nem id de conversa. A contagem é do modelo, a partir do histórico, e sai em dois campos novos da saída, para o validador e a avaliação conferirem:

- `desvios`: inteiro 0–3 (R4). `vagos`: inteiro 0–3 (R5). No máximo um dos dois é maior que zero no mesmo turno.
- O modelo recalcula a cada turno lendo as próprias mensagens anteriores (redirecionamento, aviso, pergunta reformulada) e os turnos do lead. Os campos não são ecoados pelo cliente: o histórico já tem a mesma confiança que um contador ecoado teria, e um campo a menos no cliente é um lugar a menos para adulterar.
- Determinismo para teste: dado um histórico fixo, `esperado` dos casos de avaliação fixa `proxima_acao` e os dois contadores; o validador fixa as consequências (R9).

### R8. Aberturas proibidas, por configuração

- `config/empresa.json`, `resposta.aberturas_proibidas`, lista inicial (pendente P3): `entendido`, `entendi`, `certo`, `perfeito`, `ótimo`, `claro`, `combinado`, `beleza`, `legal`, `show`, `maravilha`, `excelente`, `anotado`, `compreendo`, `compreendido`, `com certeza`, `sem dúvida`.
- Validação (automática, camada 2 de R10 da spec 001): normaliza a `resposta` (minúsculas, sem acento, sem espaço nas pontas) e rejeita com `abertura_proibida` quando ela começa por um item da lista seguido de pontuação (`,` `.` `!` `:` `;` `…`) ou de fim de texto. "Certo que vamos atender" e "Claro, posso ver" diferem: o primeiro passa (sem pontuação logo após), o segundo falha. "Certo" no meio da frase nunca falha.
- Cumprimentos ("Oi", "Olá", "Bom dia") não entram na lista.
- Palavras raras: só orientação no prompt, sem validador (busca no meio do texto gera falso positivo).

### R9. Regras de validação (contrato cruzado)

Acrescentadas em `src/validacao/contrato.ts`; as existentes continuam.

| Código | Regra |
|---|---|
| `ignorar_exige_resposta_vazia` | `ignorar` com `resposta` não vazia |
| `ignorar_fora_da_abertura` | `ignorar` com alguma mensagem `assistant` no histórico, ou com `desvios = 0`, `qualificado = true` ou `telefone` preenchido |
| `desvio_exige_pergunta` | `desvios` 1 ou 2 sem `perguntar` (vale também para `vagos` 1 ou 2, mesmo código) |
| `teto_perguntas_atingido` (prevalece) | atingido o teto, `desvio_exige_pergunta` não se aplica e vale a R5 da spec 001: sem telefone cita o contato, com telefone `encaminhar_humano`. Sem isso, as duas regras juntas não teriam saída válida |
| `limite_exige_encerrar` | `desvios = 3` ou `vagos = 3` sem `responder_e_encerrar` (telefone nulo) ou `encaminhar_humano` (telefone preenchido) |
| `encerrar_sem_telefone_exige_contato` (ampliada) | com `vagos = 3` ou `desvios = 3`, o contato é obrigatório mesmo sem dado extraído; T16 da spec 001 (fora de assunto puro sem dado) passa a valer só para a abertura, onde a ação é `ignorar` |
| `contadores_exclusivos` | `desvios > 0` e `vagos > 0` no mesmo turno |
| `abertura_proibida` | R8 |

`tipo_servico = 'fora_escopo'` continua sendo lead recusado por serviço (encerra na hora, `qualificado = false`), não fora de assunto. Schema Zod e JSON Schema (`turno.ts`) ganham `ignorar`, `desvios` e `vagos` (obrigatórios, inteiros 0–3). `resposta.ts:147` (`resposta_vazia`) abre exceção só para `ignorar`.

## Emendas à spec 001

- R7 (Tom): acrescenta R1 desta spec; "Varie a forma de falar" continua.
- R10 camada 2: ganha `abertura_proibida` e as regras da R9.
- C9: "Dado mensagem fora do assunto ou injeção, então: na abertura, fora de assunto claro recebe `ignorar` e injeção recebe a pergunta específica; depois da primeira resposta, a `resposta` redireciona em uma frase (1º), avisa (2º) e encerra (3º); injeção nunca muda o contrato nem faz o agente negar ser IA." T15–T17 seguem valendo com esse texto.
- Checklist, item 7: "Fora do assunto: na abertura, silêncio; no meio, redireciona em uma frase e volta ao tema, avisa na 2ª, encerra na 3ª". Item 7 fica "n/a" em turno silenciado.
- Checklist, item 11 novo (leitura humana): "Sem abertura de confirmação, gíria, emoji, risada nem pergunta genérica; pergunta específica com os termos do lead".
- R11, C10 e o item 8–10: sem mudança.

## Critérios

- C1 — Dado histórico sem `assistant` e mensagem fora de assunto clara, então a saída é `ignorar` com `resposta` vazia, o servidor devolve `resposta: null` e `origem: 'modelo'`, o chat não mostra balão nem erro e não encerra, e o alerta de indisponibilidade não dispara (T1, T2, T3, T13).
- C2 — Dado `ignorar` com mensagem `assistant` no histórico, com telefone ou com `desvios = 0`, então o validador rejeita (T4).
- C3 — Dado turno fora de assunto depois da primeira resposta, então `desvios` 1 e 2 vêm com `perguntar` (um "?") e 3 encerra: sem telefone `responder_e_encerrar` com contato, com telefone `encaminhar_humano`; turno no assunto zera (T5, T6, T7, T14).
- C4 — Dado turno vago depois de uma pergunta, então `vagos` 1 e 2 vêm com pergunta específica reformulada e 3 encerra com contato; recusa de dado e primeira mensagem não contam (T8, T9, T15).
- C5 — Dado `resposta` que começa por item de `aberturas_proibidas` seguido de pontuação ou fim, então `abertura_proibida`; a mesma palavra no meio da frase ou seguida de outra palavra passa (T10).
- C6 — Dado o workflow gerado, então o Switch "Rota" tem 5 saídas e a de `ignorar` não envia mensagem (T11).
- C7 — Dado o prompt versão 1.3.0, então ele mantém as 7 seções de R9 da spec 001, não tem os 3 exemplos antigos, tem as 8 trocas aprovadas (P5) e nenhum dado real da empresa (T12).
- C8 — Dado "é robô ou gente?" como primeira mensagem ou no meio, então `perguntar` com marcador de IA, sem negar (T16).
- C9 — Dado os conjuntos ajuste e regressão rodados 3 vezes na branch e 3 na base, então o acerto de `proxima_acao` no ajuste não cai em nenhuma rodada, g01–g10 passam, e os itens de leitura humana 6 (a01, a03, a04), 7 e 11 passam em todos os casos não silenciados (T17, T18).
- C10 — Dado `config/empresa.json` sem `aberturas_proibidas`, então o schema falha com mensagem que cita o campo (T19).

## Alternativas descartadas

- Silêncio por campo booleano `silencio` mantendo 4 ações: a ação continuaria `responder_e_encerrar` ou `perguntar` com texto, e o n8n precisaria de condição extra em cada rota. `ignorar` deixa a decisão visível no contrato e numa rota só.
- Contadores ecoados pelo cliente e servidor: mesmo nível de confiança do histórico, mais campos no chat e no `app.ts`, e o modelo teria de confiar num número que ele mesmo não calculou.
- Contador no servidor: não há estado; criaria persistência fora do escopo.
- Manter a mensagem silenciada no histórico: 4 mensagens de 2000 caracteres estouram o limite de 8000 e viram falha de schema (`falhaChat`), e o spam passaria a alimentar o contexto do modelo.

## Fora do escopo

Regras de qualificação (R1–R5 da spec 001). Janela de 24 h (removida; conversa encerrada fica encerrada até "Nova conversa", spec 004). Persistência no servidor, banco ou id de conversa. Canal WhatsApp real e qualquer dado de conversa real no repositório. Espera por mensagens fragmentadas (debounce): sem ela, cada fragmento vira um turno e pode inflar `vagos`; `unirUsers` só une quando o cliente não esperou resposta, então o risco fica registrado aqui e não é tratado. Revisão humana do dataset sintético e `prompt_liberado`. Alteração da tela de conversa além do item de R6.

## Confirmado, inferido e pendente

- Confirmado (responsável): R1 a R5, R2 inteira, remoção da janela de 24 h, canal real fora, "Nova conversa" continua.
- Confirmado (código): contrato e regras citadas em R9; `silencio()` e alerta; chat ignora `resposta` nula e empurra a mensagem do lead antes do `fetch`; aviso LGPD não entra no `historico`; `prompt_liberado` em `rodada.json` e T5 da spec 002; `esperado` dos casos listados.
- Inferido: S1 (§ Prompt) — exemplos escritos à mão não passam pelo portão `prompt_liberado`. S2 (R6) — tirar a mensagem silenciada do histórico é mudança pequena no chat, feita depois do merge de 004. S3 (R7) — o modelo em esforço baixo conta `desvios` e `vagos` certo na maioria dos casos; T14 e T15 medem, e o validador confere só as consequências, não a contagem. S4 (R5) — "kkk" sozinho é vago, não fora de assunto.
- Pendente: P1 a P5 abaixo; C3, C4, C7 e os casos n05 e a avaliação de g09 dependem deles.

## Perguntas abertas

- P1 — Encerrar por desvio ou vagueza quando o lead já deu telefone. Exemplo: lead informou "48 99999-0001" e depois mandou 3 mensagens sobre futebol. Opções: (a) `encaminhar_humano` com frase de encerramento, o humano decide; (b) abrir exceção em `encerrar_com_telefone_exige_humano` e encerrar sem humano. Recomendação: (a), mantém a R5 da spec 001 e não muda o validador; é extensão da R5 a um caso que ela não cobria.
- P2 — Injeção como primeira mensagem (a07, g09, r01): tratar como fora de assunto (silêncio) ou responder com a pergunta específica ignorando a instrução. Recomendação: responder (`perguntar`), porque silêncio esconde o teste de trava e o r01 exige uma resposta que não negue ser IA; g09 estreita para `perguntar`.
- P3 — Lista inicial de `aberturas_proibidas` (R8): aprovar, cortar ou acrescentar. Exemplo de corte possível: "claro" ("Claro, posso ver" soa natural). Recomendação: aprovar a lista como está e revisar depois da primeira rodada.
- P4 — Lista de palavras raras no prompt (§ Prompt). Recomendação: aprovar e manter só no prompt, sem validador.
- P5 — As 8 trocas do prompt: aprovar, reescrever ou substituir qualquer resposta. Recomendação: aprovar como estão; a aprovação é condição para o worker começar.
