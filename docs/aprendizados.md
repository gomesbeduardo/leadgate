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
