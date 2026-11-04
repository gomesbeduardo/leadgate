# Spec 003: prazo por dia da semana e data solta

Cumpre R10 da spec 001, que proíbe citar prazo. Não cria regra nova: amplia a detecção da camada 2.

## Pedido

Issue #3: "cobre prazo por dia da semana e data solta".

## Problema

A trava aceita "Atendemos na sexta-feira.", "Fazemos amanhã mesmo." e "dia 12/11". O lead lê isso como compromisso de data, e a equipe comercial não prometeu nada.

## Critérios

- Dado "Atendemos na sexta-feira.", "Fazemos amanhã mesmo." ou "dia 12/11", quando `validarResposta` roda, então devolve `resposta_prazo`.
- Dado "Passamos no sábado.", "Vamos na terça." ou "A visita fica para 12/11/2026.", quando `validarResposta` roda, então devolve `resposta_prazo`.
- Dado "Atendemos de segunda a sexta, das 8h às 18h.", quando `validarResposta` roda, então não devolve `resposta_prazo`, porque é horário de atendimento.
- Dado "Isso fica fora da região que atendemos hoje.", "Estou passando agora mesmo para o nosso time.", "É a segunda unidade do prédio?", "Na segunda unidade também?" ou "Cobre 3/4 do galpão?", quando `validarResposta` roda, então não devolve `resposta_prazo`.
- O item 3 do checklist continua usando o mesmo detector.
- A avaliação de ajuste não piora em nenhum campo.

## Testes de aceite

Os casos acima, em `tests/resposta.test.ts`, com a rodada real de ajuste comparada a `avaliacao/tabela.md`.

## Fora do escopo

Mudar o prompt, o horário da configuração ou as outras travas.

## Perguntas abertas

Nenhuma.
