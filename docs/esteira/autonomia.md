# Como ligar a esteira autônoma em outro projeto

A esteira roda sozinha porque as travas ficam em hooks, fora do alcance do modelo. O que ela pode fazer é decidido por configuração; o que ela nunca pode fazer é negado por código.

## Passos

1. Copie `.claude/skills/esteira/SKILL.md` e ajuste as fontes, os portões e o conjunto reservado da avaliação.
2. Crie `docs/aprendizados.md` e `docs/esteira/metricas.md`, com o cabeçalho deste repositório.
3. Inclua o repositório na lista `REPOS_PESSOAIS` do hook de PR. Sem essa entrada, o merge espera o rótulo humano.
4. Configure dois hooks no `.claude/settings.local.json`: `PreCompact`, que grava git, branches e contêineres num arquivo de estado, e `SessionStart` com matcher `compact`, que manda reler esse arquivo e o handoff.
5. Abra as primeiras issues com o rótulo `esteira` e rode `/loop /esteira`.

## O que continua negado

- Push direto em branch protegida, `--admin` e rótulo de revisão humana.
- PR sem as seções de contexto, mudança, teste, riscos e revisão com veredito.
- Regra de negócio nova sem spec, mudança na honestidade sobre ser IA e leitura do conjunto reservado para ajustar o prompt.

## O que a primeira rodada ensinou

- Antes de abrir um repositório, liste as referências remotas. `refs/pull/N/head` guarda o histórico antigo mesmo depois de um force push, por isso a publicação limpa foi feita num repositório novo.
- Teste com fixture escrita à mão não prova o contrato com a plataforma. A contagem de modelos passava em 273 testes e estava errada no primeiro turno real.
- Revisor independente acha o que o autor não vê: uma métrica que nunca podia reprovar e uma regex que transformava frases comuns em defeito.
- Agente de revisão recebe o diff e a spec, nunca o resumo de quem implementou.
