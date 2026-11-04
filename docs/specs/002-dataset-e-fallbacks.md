# 002 — Dataset sintético para o prompt e fallbacks do atendimento

**Status:** decisões P1–P4 tomadas pelo responsável em 03/11; implementação autorizada, texto final segue para a leitura dele no PR
**Pedido:** "Faça uma rodada para gerar um dataset que pode ser usado para 'treinar' o modelo que vai ficar responsável pelas respostas. E precisamos de alguns fallbacks nele caso algo falhe ou até contar falha de conexão ou falhas comuns. No pior dos casos apenas não responde e espera o humano atuar sempre, mas com um aviso notificando o vendedor que o 'bot caiu'"
**Decisões ligadas:** spec 001 (R8 respostas dinâmicas, R9 prompt, R10 travas e regeneração, R12 avaliação). Esta spec altera R8, R9, R10 e R12; o que muda está em R20.
**Numeração:** regras começam em R13 para não colidir com a spec 001. C, T, S e P são desta spec.

## Problema

1. **"Treinar" não é fine-tuning.** Os modelos Claude não são ajustados pelo cliente pela API pública. O que dá para fazer é (a) alimentar o prompt com exemplos revisados e (b) ampliar a avaliação para medir o efeito. É isso que esta spec chama de "treinar". Hoje há 20 casos fictícios (14 de ajuste, 6 reservados) e até 3 exemplos de estilo no prompt, escritos à mão.
2. **Falha técnica é tratada só em parte.** O turno tenta até 3 vezes (`ia.max_regeracoes` = 2), e `refusal` e `max_tokens` contam como tentativa falha. Esgotou: o lead lê `textos.falha_tecnica`. Se o n8n cai, `POST /api/chat` devolve 200 com o mesmo texto. Um turno da avaliação morreu por erro transitório de DNS dentro do contêiner do n8n; o nó HTTP ganhou 3 tentativas. Falta: segundo modelo, contagem por tipo de falha, taxa de falha ao lado da avaliação e aviso ao vendedor quando o bot cai.

Quem usa: o responsável (roda a rodada e revisa a amostra), quem lê a avaliação (taxa de falha), o vendedor (recebe o aviso e assume), o lead (sem resposta no pior caso, como aconteceria no WhatsApp).

## Contexto atual (confirmado no código e na spec 001)

- Chat em `chat/index.html`, servido pelo serviço Node (`src/servico/app.ts`); `POST /api/chat` repassa ao webhook do n8n.
- Workflow: Webhook → `Preparar turno` (HTTP ao serviço `/preparar`) → IF → `Tentativa` → `Nó de IA (Claude)` (HTTP à API da Anthropic, 3 tentativas) → `Validar saída` (HTTP `/validar`) → IF `Regenerar?` (volta) → Switch `Rota` → `Vendas (simulado)` / `Humano (simulado)` → `Responder`.
- `src/fluxo/turno.ts`: `falha()` monta o resultado com `origem: 'falha'`, `resposta = textos.falha_tecnica` e `proxima_acao = encaminhar_humano` se há telefone no histórico, senão `responder_e_encerrar`. `extrairTexto()` trata `refusal` e `max_tokens` como violação de schema e pede regeneração.
- `config/empresa.json`: `ia.modelo = claude-opus-5-5`, `ia.effort = low`, `ia.max_regeracoes = 2`, `ia.max_tokens = 4000`.
- Avaliação: `avaliacao/casos.json` (20 casos), `scripts/avaliar.mjs` (chama o webhook), `avaliacao/tabela.md` (acerto por campo). Prompt em `prompts/agente.md`.
- Tudo roda localmente com Docker Compose. Nenhum canal de notificação está configurado. Só dado fictício no repositório; lead real fica fora mesmo anonimizado.
- API: o parâmetro `fallbacks` do lado do servidor (Messages API, cabeçalho beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`) cobre recusas; para 429 e indisponibilidade, quem tenta um segundo modelo somos nós.

## Regras

### R13 — O que "treinar" significa aqui (confirmado pela API; forma é recomendação)

Nenhum fine-tuning. "Treinar" = exemplos revisados no prompt (R15) + conjunto de validação maior (R14). O README diz isso em uma frase na seção de avaliação. A spec não promete melhora de acerto: promete medir.

### R14 — Rodada de geração do dataset (recomendação)

- **Gerador:** script local (recomendação: `scripts/gerar-dataset.mjs`) que chama o mesmo modelo (`ia.modelo`) com um prompt próprio de gerador, não o prompt do agente. Cada chamada produz uma conversa fictícia completa (mensagens do lead e do agente) e o gabarito dos campos do contrato (`tipo_servico`, `segmento`, `cidade`, `urgencia`, `qualificado`, `proxima_acao`), sem o campo `resposta` no gabarito.
- **Volume:** `dataset.volume` conversas por rodada, padrão 80 (faixa aceita 60–100). Teto de chamadas por rodada `dataset.max_chamadas`, padrão 150; o script para ao atingir o teto e grava o que já tem.
- **Cobertura mínima por categoria** (as de R12 da spec 001): `claro`, `ambiguo`, `emergencia`, `fora_escopo`, `spam`, `audio_mal_transcrito`, `injecao`, `pergunta_ia`, `multiturno` (3+ mensagens do lead). Mínimo 5 conversas por categoria; o resto distribuído pelo gerador. Rodada que termina com categoria abaixo de 5 é marcada `incompleta` no relatório e não alimenta o prompt.
- **Dado fictício:** nomes inventados, telefones no padrão `48 99999-xxxx` / `55 99999-xxxx`, cidades da lista configurada e até 20% de cidades fora dela. O gerador recebe essa instrução; o script rejeita conversa com telefone fora desse padrão.
- **Duplicata contra `avaliacao/casos.json`:** conversa rejeitada quando a primeira mensagem do lead, normalizada (minúsculas, sem acento, sem pontuação, espaços únicos), é igual à de algum caso, ou quando o conjunto de palavras da primeira mensagem tem Jaccard ≥ 0,8 com o de algum caso. Os 6 casos reservados entram na comparação, mas **nunca** são lidos para outro fim: o gerador não os recebe como exemplo.
- **Armazenamento separado de `casos.json`:** `avaliacao/dataset/exemplos.json` e `avaliacao/dataset/validacao.json` (recomendação de caminho). Divisão por id estável: ids com hash par vão a `exemplos`, ímpar a `validacao`, alvo ~50/50. `validacao` nunca alimenta o prompt; `exemplos` só alimenta depois da revisão.
- **Revisão humana antes de entrar no prompt:** amostra de `dataset.amostra_revisao` conversas de `exemplos` (padrão 15, mínimo 1 por categoria), sorteada pelo script e listada em `avaliacao/dataset/revisao.md`. O responsável marca cada uma `ok` ou `rejeitada`. Só conversa com `revisado: true` e `revisor_ok: true` pode virar exemplo do prompt. Amostra com 3 ou mais rejeições invalida a rodada inteira para o prompt (continua valendo como validação, com as rejeitadas removidas).
- **Custo e limite:** o script imprime ao fim tokens de entrada e de saída somados (da resposta da API) e o número de chamadas; o repositório não cita preço (decisão da spec 001). Estimativa (inferida, S1): ~4,5 mil tokens por chamada, ~360 mil tokens por rodada de 80.
- **Registro da rodada:** `avaliacao/dataset/rodada.json` com data, modelo, volume pedido, geradas, rejeitadas por motivo (duplicata, telefone, schema), tokens e status (`completa` | `incompleta`).

### R15 — Exemplos no prompt (regra declarada; mantém o limite de R9)

- O limite de R9 fica em **3 exemplos de estilo**. O que muda é a origem: os 3 passam a vir de `exemplos.json` com `revisor_ok: true`, um por categoria escolhida, trocados à mão pelo responsável (não pelo script) e registrados na versão do prompt.
- Critério de escolha: as 3 categorias com menor acerto na última `tabela.md`; empate, prefere `ambiguo`, `multiturno`, `fora_escopo`, nessa ordem.
- O exemplo entra como entrada do lead + `resposta`, marcado como exemplo de estilo, sem preço, prazo ou fato não configurado (R9 continua valendo).
- Trocar exemplo = nova versão do prompt + rodar a avaliação de novo (14 de ajuste e `validacao.json`); os 6 reservados continuam rodando uma única vez, ao fim.
- Subir o limite para 5 é P3.

### R16 — Camadas de fallback, nesta ordem (decidido em P1)

Cada turno percorre as camadas até uma produzir resposta. A camada que respondeu vai em `origem` (R17).

1. **Repetir a chamada.** Tipos `rede`, `dns`, `timeout`, `429`, `5xx` (R17): até `ia.tentativas_http` tentativas (padrão 3) com espera `ia.espera_ms` entre elas (padrão `[1000, 3000]`; a 1ª tentativa não espera). Hoje são as 3 tentativas do nó HTTP; a espera passa a ser configurada. `timeout` usa `ia.timeout_ms` (padrão 25000). Esgotadas as repetições num tipo desses, o modelo está esgotado para o turno: não há regeneração com instrução de correção, porque o erro não é de conteúdo. Tipos `refusal`, `max_tokens`, `schema`: regeneração como hoje (R10 da spec 001), até `ia.max_regeracoes`; cada regeneração tem as suas próprias `ia.tentativas_http` repetições de rede.
2. **Segundo modelo.** `ia.modelo_reserva` (id configurado; vazio desliga a camada). Entra quando o primário esgotou a camada 1 **em qualquer tipo**, com o mesmo histórico e a última instrução de correção (se houver), por até `ia.tentativas_reserva` regenerações (padrão 2) nos tipos de conteúdo, cada uma com as mesmas `ia.tentativas_http` repetições de rede; nos tipos de rede, esgotadas as repetições, a reserva está esgotada. Teto por turno nos tipos de conteúdo = 3 regenerações do primário + 2 da reserva = 5 chamadas lógicas. A resposta da reserva passa pela mesma validação (camada 2 de R10). O parâmetro `fallbacks` do servidor **não** é usado nesta entrega: só cobre recusa e esconde a contagem por tipo (recomendação; reabrir se a API passar a cobrir 429 e indisponibilidade).
3. **Silêncio com humano assumindo.** O produto final conversa pelo WhatsApp, e o comportamento já é o de lá: quando nenhum modelo responde, o lead não recebe texto nenhum e a conversa fica com `estado = aguardando_humano`, com `proxima_acao = encaminhar_humano` e alerta ao vendedor (R18). Vale com ou sem telefone, porque no WhatsApp o número do lead é conhecido. Vale também quando o proxy não alcança o n8n ou o n8n não alcança o serviço. `POST /api/chat` devolve 200 com `{ resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo }`. A tela não mostra bolha do bot, erro, nem aviso de falha; só `?painel=1` exibe o estado.
4. **Serviço fora do ar.** A tela já aberta trata a falha de `fetch` como silêncio: a mensagem do lead fica na conversa, sem texto de erro. A tela nova não carrega, e nada na spec muda isso.

**Mensagens seguidas do lead.** Depois de um silêncio, o lead pode escrever de novo. Mensagens consecutivas de `user` são unidas por quebra de linha antes da validação de alternância (`EntradaSchema`), como quem manda duas mensagens no WhatsApp. Se o bot voltou, ele responde ao conjunto. Pausar o bot enquanto um humano conversa fica fora desta entrega (S6).

### R17 — Contagem de falhas por tipo (recomendação)

Tipos e como se detecta:

| Tipo | Detecção |
|---|---|
| `rede` | erro de socket sem resposta HTTP (`ECONNREFUSED`, `ECONNRESET`), fora DNS e timeout |
| `dns` | `ENOTFOUND` / `EAI_AGAIN` |
| `timeout` | sem resposta em `ia.timeout_ms` |
| `429` | status 429 |
| `5xx` | status 500–599 (inclui 529 da API) |
| `refusal` | `stop_reason = refusal` |
| `max_tokens` | `stop_reason = max_tokens` |
| `schema` | texto não é JSON ou falha no schema/validação cruzada (inclui camada 2 de R10) |
| `n8n` | proxy não recebe resposta válida do webhook (erro de rede, timeout ou status ≠ 200) |
| `servico` | n8n não recebe resposta válida de `/preparar` ou `/validar`; o workflow devolve ao proxy `{ origem: 'falha', tipo: 'servico' }` (S2) |

- **Quem conta:** o serviço Node, no proxy (`/api/chat`), que é o único componente vivo quando o n8n cai. Cada tentativa que falha vira um registro; cada turno vira um registro de turno.
- **Onde:** arquivo `dados/falhas.json` (recomendação; volume do Compose para sobreviver a reinício) e `GET /falhas`, que devolve o resumo abaixo. Registro de tentativa: `{ ts, turno_id, tipo, origem_componente: 'modelo' | 'n8n' | 'servico', modelo, tentativa, camada, recuperado }`. `recuperado = true` quando o turno acabou com `origem = 'modelo'` depois da falha.
- **Resumo** (`GET /falhas` e bloco ao lado da `tabela.md`): turnos totais, turnos com `origem = 'falha'`, taxa de falha, tentativas falhas por tipo, turnos recuperados por camada (1, 2) e modelo que respondeu (primário | reserva).
- **Conta:** `taxa_falha = turnos_com_origem_falha / turnos_totais`, uma casa decimal em %. Turno recuperado na camada 1 ou 2 **não** conta na taxa; conta em "tentativas falhas por tipo". Exemplo: 20 turnos, 3 tiveram 429 na 1ª tentativa e responderam na 2ª, 1 esgotou tudo → `taxa_falha = 1/20 = 5,0 %`, `429 = 3`, recuperados camada 1 = 3.
- `scripts/avaliar.mjs` zera o contador antes da rodada (`DELETE /falhas`) e grava o resumo em `avaliacao/falhas.md`, referenciado pela `tabela.md`.

### R18 — Aviso ao vendedor: "bot caiu" (recomendação; canal real é P2)

- **Queda:** começa quando (a) `alerta.turnos_para_queda` turnos consecutivos terminam com `origem = 'falha'` (padrão 2), ou (b) um único turno falha com tipo `n8n` ou `servico`. Termina no primeiro turno com `origem = 'modelo'`.
- **Um alerta por queda:** disparado no início da queda. Enquanto a queda dura, novo alerta só depois de `alerta.intervalo_min` (padrão 30) minutos, e só se ainda estiver em queda. Aviso de **recuperação** no fim da queda, uma vez, com o número de turnos afetados.
- **Conteúdo do alerta** (texto configurado em `textos.alerta_queda`, com marcadores): "O atendimento automático da {{empresa.nome}} parou às {{hora}} ({{tipo}}). {{efeito_no_lead}} Atue manualmente." `efeito_no_lead` = "Os leads estão sem resposta.". Recuperação: `textos.alerta_recuperado` = "O atendimento automático da {{empresa.nome}} voltou às {{hora}}; {{n}} conversas afetadas."
- **Canais:** interface única `CanalAlerta`, com dois canais escolhidos por `ALERTA_CANAL` (padrão `simulado`). (1) `simulado`: linha no log do serviço com prefixo `ALERTA` e `GET /alertas` com a lista `{ ts, tipo_evento: 'queda' | 'recuperado', tipo_falha, turnos_afetados }`, gravada em `dados/alertas.json`. Sempre ativo. (2) `resend`: além do simulado, `POST {RESEND_BASE_URL}/emails` (padrão `https://api.resend.com`) com `Authorization: Bearer $RESEND_API_KEY` e JSON `{ from: ALERTA_EMAIL_DE, to: [ALERTA_EMAIL_PARA], subject, text }`. Pronto no código e testado contra stub; a conta real fica para quando houver domínio. Sem chave, volta ao simulado. Falha no POST não derruba o turno e conta como `alerta_nao_entregue` em `/alertas`.
- **Quem dispara:** o serviço Node, no proxy, pelos mesmos registros de R17. O n8n não dispara alerta (não sobrevive à própria queda).
- A tela do lead **não** mostra o alerta.

### R19 — Dados e LGPD (confirmado pela spec 001)

- Dataset só com dado fictício; nenhuma conversa real da avaliação ou do chat entra na geração.
- `dados/falhas.json` e `dados/alertas.json` não guardam mensagem do lead nem telefone: só ids, tipos e horários.
- Retenção igual à do histórico: `lgpd.retencao_dias`; a demo apaga ao derrubar o Compose.

### R20 — O que muda na spec 001

- **R8 (respostas dinâmicas):** a exceção da mensagem de falha técnica cai: o lead não lê texto fixo em nenhum caso, e `textos.falha_tecnica` sai da configuração. O alerta ao vendedor não é texto ao lead: R8 não o alcança.
- **R9 (prompt):** os 3 exemplos passam a vir de `exemplos.json` revisado (R15). O limite não muda.
- **R10 (regeneração):** o orçamento de tentativas ganha a camada 2 (modelo reserva); "esgotou" passa a significar esgotar as duas camadas. Falha de rede, DNS, timeout, 429 e 5xx entram no caminho de falha com tipo próprio, não como "schema".
- **R12 (avaliação):** a tabela ganha a taxa de falha (R17) e uma coluna de acerto em `validacao.json` (n = tamanho do conjunto). Os 14 + 6 continuam como estão; os 6 reservados rodam uma vez.

## Configuração (chaves novas)

`ia.modelo_reserva` (string, vazio desliga), `ia.tentativas_http` (3), `ia.espera_ms` ([1000, 3000]), `ia.timeout_ms` (25000: seis tentativas mais as esperas de 1 s e 3 s somam cerca de 158 s e cabem em `ia.timeout_turno_ms`, 180000; o prazo do turno encerra em silêncio, com o tipo da última falha, quando não sobra um `timeout_ms` para outra tentativa), `ia.tentativas_reserva` (2), `dataset.volume` (80), `dataset.max_chamadas` (150), `dataset.amostra_revisao` (15), `alerta.turnos_para_queda` (2), `alerta.intervalo_min` (30), `textos.alerta_queda`, `textos.alerta_recuperado`. Sai: `textos.falha_tecnica`. Valor de `ia.modelo_reserva`: `claude-haiku-5-5` (P4). Env: `ALERTA_CANAL`, `RESEND_API_KEY`, `RESEND_BASE_URL`, `ALERTA_EMAIL_DE`, `ALERTA_EMAIL_PARA` (todas opcionais), `IA_BASE_URL` (opcional, só para os stubs de teste; padrão é a API da Anthropic).

## Formato do dataset (recomendação)

```json
{
  "id": "sint-0001",
  "categoria": "ambiguo",
  "conjunto": "exemplos",
  "origem": "sintetico",
  "conversa": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
  "gabarito": { "tipo_servico": "manutencao", "segmento": "comercial", "cidade": "Palhoça", "urgencia": "media", "qualificado": true, "proxima_acao": "perguntar" },
  "revisado": false,
  "revisor_ok": null
}
```

Os campos do `gabarito` seguem os nomes e valores de `avaliacao/casos.json` (S3). `scripts/avaliar.mjs` aceita `validacao.json` como entrada alternativa.

## Critérios de aceite

- C1 — Dado `dataset.volume = 80`, quando a rodada roda, então `exemplos.json` + `validacao.json` somam entre 60 e 100 conversas, cada categoria tem ≥ 5, e `rodada.json` traz tokens, chamadas e status (T1, T2).
- C2 — Dado uma conversa gerada igual ou quase igual (Jaccard ≥ 0,8) a um caso de `casos.json`, então ela é rejeitada e contada em `rodada.json` (T3).
- C3 — Dado os 6 casos reservados, então nenhum texto deles aparece no prompt do gerador nem em `exemplos.json`/`validacao.json` (T4).
- C4 — Dado conversa sem `revisor_ok: true`, então ela não pode ser citada no prompt do agente; o teste do prompt confere a origem dos 3 exemplos (T5).
- C5 — Dado falha de tipo `rede`, `dns`, `timeout`, `429` ou `5xx` na 1ª tentativa e sucesso na 2ª, então o turno responde com `origem = 'modelo'`, a falha fica em `/falhas` com `recuperado = true` e a taxa de falha não sobe (T6–T10).
- C6 — Dado o primário esgotado (3 tentativas) e `ia.modelo_reserva` configurado, então a reserva recebe o mesmo histórico, responde, e `/falhas` registra `modelo = reserva` (T11).
- C7 — Dado primário e reserva esgotados, então o lead não recebe texto, o estado é `aguardando_humano`, `proxima_acao = encaminhar_humano` e o turno conta na taxa de falha (T12, T24).
- C8 — Dado `refusal`, `max_tokens` ou `schema`, então o tipo certo aparece em `/falhas` e a regeneração segue R10 (T13, T14, T15).
- C9 — Dado o n8n parado, então o proxy responde em até `ia.timeout_turno_ms`, registra `n8n`, dispara o alerta de queda uma vez e, ao voltar, o aviso de recuperação (T16, T17).
- C10 — Dado o serviço parado durante o turno do n8n, então o workflow devolve `tipo: 'servico'` e o proxy, ao receber, registra e alerta (T18). Depende da suposição S2.
- C11 — Dado dois alertas na mesma queda em menos de `alerta.intervalo_min`, então só o primeiro é emitido (T19).
- C12 — Dado `ALERTA_CANAL = resend` com chave, então o POST sai com o JSON de R18; falha no POST não altera o turno (T20, T21).
- C13 — Dado `avaliacao/tabela.md` após a rodada, então há o bloco de taxa de falha com a conta de R17, calculada por conjunto (um `avaliacao/falhas-<conjunto>.md` por conjunto, listados no bloco; conjunto sem turno medido aparece como "não medida", nunca como 0,0 %) e a coluna de `validacao.json` (T22).
- C14 — Dado `dados/falhas.json` e `dados/alertas.json`, então não há conteúdo de mensagem nem telefone (T23).

## Testes de aceite

Tipos: **unidade** = `tests/` (Vitest ou o runner que o repo já usa); **stub** = servidor HTTP local que imita a API da Anthropic (recomendação: `tests/stub-api.mjs`, cenário escolhido por cabeçalho `x-cenario` ou por rota), apontado por `IA_BASE_URL`; **manual** = conferência do responsável com captura ou saída de comando. Todo dado é fictício.

| # | Critério | Dado (entrada exata) | Ação | Resultado esperado (exato) | Tipo |
|---|---|---|---|---|---|
| T1 | C1 | `dataset.volume = 80`, stub devolvendo conversas válidas | rodar gerador | 80 conversas, cada categoria ≥ 5, `rodada.json.status = completa`, tokens > 0 | stub |
| T2 | C1 | stub que devolve só `categoria = claro` | rodar gerador | `status = incompleta`; `exemplos.json` não pode alimentar o prompt (flag `prompt_liberado = false` em `rodada.json`) | stub |
| T3 | C2 | conversa gerada cuja 1ª mensagem é "Preciso instalar um split no meu apartamento em Florianópolis" (T1 da spec 001) | filtrar | rejeitada, `rodada.json.rejeitadas.duplicata = 1` | unidade |
| T4 | C3 | prompt do gerador montado + os dois arquivos | grep das 1ªs mensagens dos 6 reservados | 0 ocorrências | manual |
| T5 | C4 | `prompts/agente.md` com 3 exemplos marcados por id `sint-xxxx` | validar prompt | cada id existe em `exemplos.json` com `revisor_ok: true`; id com `revisor_ok` ≠ true falha a validação | unidade |
| T6 | C5 | stub: 1ª tentativa fecha o socket (`ECONNRESET`), 2ª responde JSON válido | 1 turno | `origem = modelo`; `/falhas` tem 1 registro `rede`, `recuperado = true`; `taxa_falha = 0,0 %` | stub |
| T7 | C5 | `IA_BASE_URL = http://api.invalido.local` na 1ª tentativa (stub troca a URL após a 1ª) | 1 turno | registro `dns`, `recuperado = true` | stub |
| T8 | C5 | stub: 1ª tentativa demora `ia.timeout_ms + 1000`, 2ª responde | 1 turno | registro `timeout`, `recuperado = true`; turno responde em menos de `2 × ia.timeout_ms` | stub |
| T9 | C5 | stub: 1ª tentativa status 429, 2ª responde | 1 turno | registro `429`, `recuperado = true`; espera de `ia.espera_ms[0]` entre as tentativas (medida no log) | stub |
| T10 | C5 | stub: 1ª tentativa status 529, 2ª responde | 1 turno | registro `5xx`, `recuperado = true` | stub |
| T11 | C6 | stub: primário responde 503 nas 3 repetições; reserva responde JSON válido | 1 turno | `origem = modelo`, `/falhas` com 3 registros `5xx` (`modelo = primario`) e turno com `modelo_respondeu = reserva`, `camada = 2` | stub |
| T12 | C7 | stub: primário 503 × 3 repetições e reserva 503 × 3 repetições | 1 turno sem telefone | `resposta = null`; `estado = aguardando_humano`; `proxima_acao = encaminhar_humano`; tela sem bolha do bot; `taxa_falha = 100,0 %` (1/1) | stub |
| T13 | C8 | stub: `stop_reason = refusal` na 1ª, JSON válido na 2ª | 1 turno | registro `refusal`, `recuperado = true`, 2 tentativas | stub |
| T14 | C8 | stub: `stop_reason = max_tokens` na 1ª, JSON válido na 2ª | 1 turno | registro `max_tokens`, `recuperado = true` | stub |
| T15 | C8 | stub: texto "desculpe, não consigo" (não JSON) × 3 no primário, reserva desligada | 1 turno | 3 registros `schema`; `origem = falha`; conta na taxa | stub |
| T16 | C9 | `docker compose stop n8n`; enviar "Oi, quero manutenção na loja" pelo chat | 1 turno | resposta ≤ `ia.timeout_turno_ms`; tela sem bolha do bot nem erro; `/falhas` tem `n8n`; `/alertas` tem 1 `queda` com `tipo_falha = n8n`; log tem linha `ALERTA` | manual |
| T17 | C9 | após T16, `docker compose start n8n` e um turno válido | 1 turno | `/alertas` ganha 1 `recuperado` com `turnos_afetados = 1` | manual |
| T18 | C10 | serviço fora durante `Preparar turno` (stub do n8n: HTTP a `/preparar` falha) | 1 turno | workflow devolve `{ origem: 'falha', tipo: 'servico' }`; se o proxy está vivo, registra `servico` e alerta | manual |
| T19 | C11 | 2 turnos falhos consecutivos às 10:00 e mais 3 falhos até 10:20 (`intervalo_min = 30`) | 5 turnos | exatamente 1 `queda` em `/alertas`; 6º turno falho às 10:31 gera o 2º alerta | unidade (relógio injetado) |
| T20 | C12 | `ALERTA_CANAL = resend`, `RESEND_BASE_URL` apontando para um receptor local; provocar T16 | 1 turno | receptor recebe 1 POST em `/emails` com `Authorization: Bearer`, e `text` = `textos.alerta_queda` preenchido | stub |
| T21 | C12 | receptor devolve 500 | 1 turno | turno igual ao de T16; `/alertas` tem `alerta_nao_entregue = 1` | stub |
| T22 | C13 | `scripts/avaliar.mjs` com os 14 de ajuste e `validacao.json`, 2 turnos recuperados de 429 e 1 falho | rodar | `avaliacao/falhas-<conjunto>.md` (a taxa é por conjunto): `turnos = n`, `falhas = 1`, `taxa_falha = 100/n %` com uma casa; `tabela.md` lista cada `falhas-<conjunto>.md` e tem a coluna de validação | manual |
| T23 | C14 | após T16 e T22 | grep de `99999` e de qualquer mensagem do chat em `dados/*.json` | 0 ocorrências | manual |
| T24 | C7 | após T12, o lead manda "alguém aí?" com o bot de volta | 1 turno | histórico `user, user` é unido, a validação passa e o bot responde ao conjunto | stub |

Conta de T22 com n = 20 + |validacao|: se |validacao| = 40, n = 60, `taxa_falha = 1/60 = 1,7 %`; 429 = 2; recuperados camada 1 = 2.

Conta de T12 (tipo de rede): primário 3 repetições + reserva 3 repetições = 6 requisições HTTP, 6 registros `5xx` em `/falhas` com `recuperado = false`, 1 turno com `origem = falha`. Se fosse tipo de conteúdo (T15 com reserva ligada): 3 + 2 = 5 regenerações, até 15 requisições se cada uma falhasse na rede antes.

## Contratos e restrições técnicas

- Decisão existente: n8n só orquestra; o nó de IA chama a API; validação no serviço Node (spec 001). A contagem e o alerta ficam no serviço porque só ele sobrevive à queda do n8n.
- Recomendação: a camada 2 (reserva) é executada pelo workflow (novo ramo após `Tentativa` que troca `model` quando `tentativa > ia.max_regeracoes + 1`), com o serviço decidindo o próximo passo em `/preparar`/`/validar`, como já faz para a regeneração. Alternativa igualmente válida: o serviço chama a API diretamente na camada 2. O worker escolhe a que menos duplica o nó de IA e registra no PR.
- Recomendação: `IA_BASE_URL` muda só a base da URL do nó HTTP (e do gerador); em produção fica vazia.
- Nenhum preço de modelo no repositório (spec 001).

## Fora do escopo

- Fine-tuning de qualquer tipo; avaliação automática de tom (continua checklist humano de R12).
- Conta real de alerta: o canal Resend fica pronto e testado contra stub, sem conta nem domínio (P2). WhatsApp e Slack ficam fora.
- Painel do vendedor, fila de atendimento humano, retomada automática da conversa depois da queda.
- Gerar conversa a partir de lead real, mesmo anonimizado.
- Mudar o prompt do agente nesta entrega além da origem dos 3 exemplos.
- Supabase, WhatsApp, deploy hospedado (continuam fora, spec 001).

## Suposições

- S1 — Estimativa de tokens por chamada do gerador (~4,5 mil) é inferida; a rodada registra o real (R14).
- S2 — Tipo `servico` só é observável quando o proxy está vivo e o n8n consegue devolver o erro; se o processo inteiro cai, vale a camada 4 (R16, R17, C10, T18).
- S3 — Os nomes dos campos do gabarito em `casos.json` são os do contrato da spec 001; o worker confere antes de gerar (§ Formato do dataset).
- S4 — Divisão 50/50 entre `exemplos` e `validacao` por paridade de hash do id; não há balanceamento por categoria entre os dois conjuntos (R14).
- S6 — A próxima mensagem do lead depois do silêncio tenta o bot de novo: sem console de atendente, não há como saber que um humano assumiu. No WhatsApp real, esse controle vira a pausa do bot por conversa (extensão de regra, a confirmar quando houver canal).
- S5 — `ia.max_tokens` e `effort` do gerador são os mesmos do agente; subir `max_tokens` para conversa multiturno é ajuste de implementação, não de regra.

## Decisões do responsável (03/11)

- P1 — Pior caso: adaptado ao WhatsApp. Serviço falhou, o lead fica sem resposta e um atendente assume (R16, camadas 3 e 4).
- P2 — Canal do alerta: simulado, com pré-abertura para Resend (R18).
- P3 — Exemplos no prompt: mantém 3 (R15).
- P4 — Modelo reserva: menor e configurável, `claude-haiku-5-5`. Vale medir o acerto dele nos 14 de ajuste antes de citar número.

## Fatos da pesquisa que mudam a implementação

- `fallbacks` do servidor só cobre recusa, é beta, e o Haiku 5.5 não tem. Confirma R16: a reserva é nossa.
- 429 traz `retry-after`, salvo teto de gasto mensal (`error.details.error_code = enforced_spend_limit_reached`), em que repetir é inútil: vai direto à reserva. 400, 401, 402, 403, 404 e 413 também não se repetem.
- O Retry On Fail do n8n aceita no máximo 5 tentativas com 5 s fixos, sem ler `retry-after`. Recomendação: tirar o retry do nó, usar `Never Error` com resposta completa e saída de erro, e passar status, cabeçalhos e erro a `/validar`. O serviço classifica e devolve o próximo passo com a espera, e o workflow só executa (com um nó Wait). `ia.espera_ms` vira `retry-after` quando houver.
- Em `refusal` e `max_tokens`, o texto pode não seguir o schema: conferir `stop_reason` antes do `JSON.parse`. Enum pode vir com maiúscula trocada: comparar sem caixa.
- Sem conectar, webhook `responseNode` falha com 500 `{"message":"Error in workflow"}` e não há timeout do lado do n8n: o proxy precisa do próprio `ia.timeout_ms`, multiplicado pelas tentativas previstas.
