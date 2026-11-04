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
