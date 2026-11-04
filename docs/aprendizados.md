# Aprendizados

Cada entrada traz a evidência, a causa provada e a regra. A skill `esteira` lê este arquivo antes de cada ciclo e acrescenta entradas ao fim dele. Lição repetida vira teste ou portão.

## 03/11/2026 — Correção antes da causa provada

**Evidência:** o primeiro teste no n8n real falhou com `$.derived is not a function`. A hipótese foi que o `$` gerado pela compactação colidia com o `$` do n8n. O ajuste foi feito, e o erro voltou como `util_exports.derived is not a function`.
**Causa:** a hipótese vinha só do nome da variável. Nenhum experimento a separava de outras.
**Regra:** antes de corrigir um erro de ambiente, rode um teste mínimo que confirme a causa. Um workflow de diagnóstico de 15 linhas achou a causa real em uma tentativa.

## 03/11/2026 — O nó Code do n8n 2.46 não é JavaScript comum

**Evidência:** no nó Code, `Object.defineProperty` não define nada e não acusa erro; `Reflect.defineProperty` funciona. O Zod depende da primeira função e quebra ao carregar. 68 testes passavam, inclusive os que executavam o código do nó com `new Function`.
**Causa:** o executor do n8n endurece os globais. O teste simulava o nó num ambiente sem essa proteção.
**Regra:** simulação de plataforma não prova integração. Toda fatia que depende do n8n só termina depois de rodar no contêiner. A validação saiu do nó Code para um serviço Node, sem contornar a proteção.

## 03/11/2026 — Trava de vazamento contra dado público

**Evidência:** a regra "resposta sem trecho de 40+ caracteres igual ao prompt" reprovaria toda resposta que citasse `empresa.contato`, que tem mais de 60 caracteres e é exigido pela regra R5.
**Causa:** duas regras corretas isoladamente, sem teste da interação entre elas.
**Regra:** toda trava nova ganha um teste com o texto que outra regra exige. Dado público é retirado antes da comparação.

## 03/11/2026 — Resolvedor de DNS no contêiner

**Evidência:** dentro do contêiner, `getaddrinfo EAI_AGAIN api.anthropic.com`, embora a máquina resolvesse o nome.
**Causa:** o DNS interno do Docker não alcançava o resolvedor local do host (`systemd-resolved`). Com `dns:` explícito no Compose, o mesmo teste resolveu.
**Regra:** o `docker-compose.yml` declara os servidores de DNS. Antes de investigar o fluxo, teste a rede de dentro do contêiner.

## 03/11/2026 — Chave colada com aspas

**Evidência:** a API devolveu 401 com a chave recém-criada. O valor no `.env` tinha um espaço e aspas em volta.
**Causa:** formatação, não credencial. Foi diagnosticada pela forma do valor, sem imprimir a chave.
**Regra:** nunca imprima segredo para depurar. Confira formato, tamanho e prefixo.

## 03/11/2026 — Avaliação que falhou em silêncio

**Evidência:** a primeira rodada devolveu 404 em todos os casos, e o script terminou com código 0.
**Causa:** o webhook do n8n ainda não tinha registrado quando a rodada começou, e o script gravava o erro como resultado do caso.
**Regra:** avaliação que não mediu nada tem de sair com erro. `scripts/avaliar.mjs` espera o webhook por até 60 segundos e termina com código 1 se ele não responder.

## 03/11/2026 — Regra que empurrava o modelo a errar

**Evidência:** com `Santa Maria-DF`, a regra `dados_completos_exigem_qualificado` forçava `qualificado = true` para uma cidade fora da região.
**Causa:** a regra olhava só se os dados estavam preenchidos, sem olhar a região.
**Regra:** validador que obriga uma decisão precisa de um teste com um caso em que a decisão certa é a oposta.

## 03/11/2026 — Recusa contada como promessa

**Evidência:** "não oferecemos desconto" era rejeitada pela lista de promessas proibidas, e o caso gastava as 3 chamadas.
**Causa:** a lista procurava o radical sem olhar a negação antes dele.
**Regra:** toda lista de termos proibidos ganha um teste com a recusa correta daquele termo.

## 04/11/2026 — Métrica que nunca podia falhar

**Evidência:** o item 2 do checklist lia as violações do turno gravado, e turno aceito sempre grava a lista vazia. Só a revisão final notou.
**Causa:** o teste cobria o caso que passa, e nenhum caso em que o item devesse reprovar sozinho.
**Regra:** toda métrica nova ganha um teste em que ela reprova sozinha, sem outra métrica reprovar junto.

## 04/11/2026 — Regex de prazo mais larga que a trava real

**Evidência:** "fora da região que atendemos hoje" contava como citar prazo no checklist, e o README descrevia isso como defeito das respostas. A trava da conversa já exigia "ainda hoje" ou "hoje mesmo".
**Causa:** duas definições de prazo, uma na conversa e outra na avaliação.
**Regra:** avaliação e trava usam a mesma definição. README com número só depois de abrir o caso que gerou o número.

## 04/11/2026 — Fixture escrita à mão escondeu o contrato real

**Evidência:** 273 testes verdes, e o primeiro turno no n8n real contou o modelo principal como reserva. O fluxo devolve `primario` ou `reserva`, e a fixture usava o nome do modelo.
**Causa:** a fixture foi escrita a partir do brief, não copiada da saída real do fluxo.
**Regra:** fixture de integração vem de uma resposta real gravada. Fatia que lê dado de outro componente roda na pilha antes de fechar.

## 04/11/2026 — Medição que media zero

**Evidência:** a rodada de validação gravou `taxa_falha = 0/0 = 0,0 %`, porque a avaliação chamava o webhook e só o proxy conta os turnos. A revisão apontou pelo código, e a rodada real confirmou.
**Causa:** o contador foi ligado num caminho, e a avaliação usava outro.
**Regra:** denominador zero se escreve "não medida", nunca `0,0 %`. É a segunda vez que um número falso de sucesso aparece (ver "Avaliação que falhou em silêncio"), por isso virou teste.

## 04/11/2026 — Gabarito gerado contra o contrato

**Evidência:** 24 de 82 conversas sintéticas tinham `qualificado = true` sem telefone do lead, o que o contrato proíbe. 212 testes do gerador passavam.
**Causa:** o prompt do gerador reescreveu a regra de memória, sem ligação com o validador.
**Regra:** dado gerado passa pelas mesmas regras do produto antes de entrar no dataset, com um teste que compara as duas definições.

## 04/11/2026 — Achado de revisor também precisa de prova

**Evidência:** a revisão final disse que `role: 'system'` no meio da conversa daria erro 400. As rodadas reais tinham turnos com 2 tentativas terminando sem erro, e a afirmação caiu.
**Causa:** o revisor afirmou um fato de API de memória, sem chamar a API.
**Regra:** todo achado é conferido contra o código e contra execução real antes de virar correção.

## 04/11/2026 — Uma rodada do modelo não mede piora

**Evidência:** na issue #3, a rodada de ajuste deu `segmento` 13/14 contra 14/14 da tabela, e a regra da esteira bloquearia o PR. Repetindo, a base deu 13, 14 e 13, e a branch deu 13, 13 e 14, com erro em a05 ou a06, nos dois lados.
**Causa:** a resposta do modelo varia entre rodadas, e a tabela guarda uma rodada só.
**Regra:** campo que piorou em uma rodada não bloqueia nem libera. Repita 3 vezes na branch e na base e compare a soma de acertos: bloqueia se a da branch ficar abaixo. A skill `esteira` já exige isso.

## 04/11/2026 — Status repetido em dois lugares do README

**Evidência:** ao registrar a leitura humana, a linha 211 do README foi atualizada, e a linha 128 continuou dizendo que ninguém tinha feito a leitura. A revisão apontou a contradição.
**Causa:** o mesmo fato estava escrito em dois lugares, e a busca antes de editar não foi feita.
**Regra:** antes de mudar um status em documento, procure o assunto no repositório inteiro e atualize todas as ocorrências.

## 04/11/2026 — Log público sem o que foi negado

**Evidência:** o agente terminou duas execuções sem PR, com 5 ferramentas negadas, e o log só mostrava a contagem. Com o passo de listagem, cada bloqueio apareceu numa execução: `git checkout`, depois `git push -q`.
**Causa:** a saída completa fica desligada porque o repositório é público, e nada filtrado substituía essa informação.
**Regra:** todo job com lista fechada de ferramentas imprime as negações filtradas antes de qualquer ajuste. Lista de comando exato falha com variação de opção, então o prompt diz o comando exato de cada passo.

## 04/11/2026 — Regra de permissão aceita que nunca casa

**Evidência:** `Write(.revisao/veredito.json)` não deu erro e o revisor não conseguiu gravar o veredito. Com `Edit(...)`, 0 negações.
**Causa:** o Claude Code aceita regra de caminho em `Write`, mas confere escrita só contra `Edit`.
**Regra:** regra de permissão nova é provada numa execução real. Aceitar a configuração não prova nada.

## 04/11/2026 — Merge pelo token do workflow não dispara o resto

**Evidência:** o PR #25, integrado por `github-actions`, não fechou a issue #21 nem rodou `Portões` em `staging`. O PR #33, integrado pelo responsável, fechou a #27 e rodou `Portões`.
**Causa:** evento do `GITHUB_TOKEN` não dispara workflow, o que está documentado. Para o fechamento da issue, nenhuma fonte oficial explica o mecanismo.
**Regra:** depois do primeiro merge automático, confira se a issue fechou e se os workflows de `push` rodaram. Causa sem fonte fica como hipótese, com um caso de controle.

## 04/11/2026 — Recusa do modelo não testa a trava

**Evidência:** nos testes T17, T18 e T37, o agente recusou pelo prompt e não tentou o comando. Só as variantes que pediam o comando diretamente mostraram `curl`, a leitura e `git push --delete` negados.
**Causa:** a instrução do prompt age antes da lista de ferramentas.
**Regra:** teste de trava só vale quando o log mostra a negação. Recusa do modelo é outra camada e é contada à parte.

## 04/11/2026 — PR aberto usa o workflow antigo

**Evidência:** depois do merge do PR #26, duas execuções do revisor no PR #25 ainda rodaram a versão velha, e uma foi pulada pela action por diferir da branch padrão.
**Causa:** o `pull_request` usa o merge calculado do PR, que só foi atualizado depois de fechar e reabrir.
**Regra:** ao mudar workflow com PR aberto, feche e reabra o PR, gere outro evento e confira no log qual versão rodou antes de tirar conclusão.

## 04/11/2026 — Telemetria desligada ainda chama para fora

**Evidência:** com `PROMPTFOO_DISABLE_TELEMETRY=1`, o promptfoo 0.124.1 tentou um POST a `r.promptfoo.app`, e o sandbox registrou a saída. Um proxy de captura mostrou esse destino, e nenhum outro, em 326 conexões. A 0.125.1 traz o mesmo código.
**Causa:** `recordTelemetryDisabled()` chama `sendEvent`, que envia o evento "telemetry disabled" com `user_id` e o e-mail local, se houver um.
**Regra:** opção de privacidade só vale depois de conferida no pacote e na execução, não só na documentação. O comando `comparar:prompt` roda com proxy inalcançável, e um teste falha se aparecer outro destino.

## 04/11/2026 — Sonda de prontidão que não chega ao modelo

**Evidência:** a pilha respondeu 200 a `{"historico":[]}` enquanto o n8n dizia `The requested webhook "POST chat" is not registered`. As falhas contadas nessa hora vieram da própria espera.
**Causa:** histórico vazio é recusado como entrada inválida antes de chegar ao n8n, então a resposta não prova que o workflow está ativo.
**Regra:** pilha pronta é pilha que fez um turno real com `origem: modelo`. Depois da sonda, zere `/falhas` antes de medir.

## 04/11/2026 — Comparação que aprovava zero contra zero

**Evidência:** a revisão final mostrou 42 linhas zeradas em cada lado saindo como aprovadas, com `DEMO_PAINEL` desligado. Uma falha de DNS também derrubava a soma de um lado como se fosse resposta errada.
**Causa:** a regra `branch < base` só compara somas e não pergunta se a medição aconteceu.
**Regra:** é a terceira vez que um número falso de sucesso aparece (ver "Avaliação que falhou em silêncio" e "Medição que media zero"), e agora há teste. Falha técnica em qualquer lado invalida a comparação, por decisão do responsável, e lado sem nenhum acerto é "não medida".
