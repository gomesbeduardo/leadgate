## Acerto por campo

| Campo | Acerto ajuste (n=14) | Acerto reservado (n=6) |
|---|---|---|
| tipo_servico | 14/14 (100%) | 6/6 (100%) |
| segmento | 14/14 (100%) | 5/6 (83%) |
| cidade | 14/14 (100%) | 6/6 (100%) |
| urgencia | 14/14 (100%) | 6/6 (100%) |
| qualificado | 14/14 (100%) | 6/6 (100%) |
| proxima_acao | 14/14 (100%) | 6/6 (100%) |

Amostra pequena: 14 casos de ajuste e 6 reservados; os percentuais variam muito com um caso a mais ou a menos.

## Confianca contra o limiar

| Conjunto | acerto com confianca >= limiar | acerto com confianca < limiar | erro com confianca >= limiar | erro com confianca < limiar | limiar separa (acerto alto + erro baixo) |
|---|---|---|---|---|---|
| ajuste | 10 | 4 | 0 | 0 | 10/14 |
| reservado | 3 | 2 | 1 | 0 | 3/6 |

Caso que falhou conta como erro com confianca abaixo do limiar.

## Checklist de tom e travas (aprovados / aplicaveis)

### ajuste

| Caso | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Aprovados |
|---|---|---|---|---|---|---|---|---|---|---|---|
| a01 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a02 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a03 | ok | ok | falhou | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 2/3, 4 pendente(s) |
| a04 | ok | ok | falhou | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 2/3, 4 pendente(s) |
| a05 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a06 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a07 | ok | ok | ok | n/a | pendente | pendente | pendente | n/a | pendente | pendente | 3/3, 5 pendente(s) |
| a08 | ok | ok | ok | n/a | pendente | pendente | pendente | n/a | pendente | pendente | 3/3, 5 pendente(s) |
| a09 | ok | ok | ok | ok | pendente | pendente | n/a | n/a | pendente | pendente | 4/4, 4 pendente(s) |
| a10 | ok | ok | ok | n/a | pendente | pendente | n/a | pendente | pendente | pendente | 3/3, 5 pendente(s) |
| a11 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a12 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a13 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| a14 | ok | ok | ok | n/a | pendente | pendente | pendente | n/a | pendente | pendente | 3/3, 5 pendente(s) |

### reservado

| Caso | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Aprovados |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r01 | ok | ok | ok | ok | pendente | pendente | n/a | pendente | pendente | n/a | 4/4, 4 pendente(s) |
| r02 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| r03 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| r04 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| r05 | ok | ok | ok | n/a | pendente | pendente | pendente | n/a | pendente | pendente | 3/3, 5 pendente(s) |
| r06 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |

## Variacao e custo

| Conjunto | Pares de aberturas identicas (T14: zero) | Tentativas por turno (media) |
|---|---|---|
| ajuste | 1 | 1.03 |
| reservado | 0 | 1.13 |

## Regressão (falhas do passado, conjunto separado: não entra nos números acima)

n=9

| Campo | Acerto regressão |
|---|---|
| tipo_servico | 9/9 (100%) |
| segmento | 9/9 (100%) |
| cidade | 9/9 (100%) |
| urgencia | 9/9 (100%) |
| qualificado | 9/9 (100%) |
| proxima_acao | 9/9 (100%) |

Confiança: acerto alta 3, acerto baixa 6, erro alta 0, erro baixa 0.

| Caso | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Aprovados |
|---|---|---|---|---|---|---|---|---|---|---|---|
| g01 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| g02 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| g03 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| g04 | ok | ok | ok | n/a | pendente | pendente | n/a | n/a | pendente | pendente | 3/3, 4 pendente(s) |
| g05 | ok | ok | ok | ok | pendente | pendente | n/a | pendente | pendente | pendente | 4/4, 5 pendente(s) |
| g06 | ok | ok | ok | ok | pendente | pendente | n/a | n/a | pendente | pendente | 4/4, 4 pendente(s) |
| g07 | ok | ok | ok | ok | pendente | pendente | n/a | n/a | pendente | pendente | 4/4, 4 pendente(s) |
| g08 | ok | ok | ok | n/a | pendente | pendente | pendente | n/a | pendente | pendente | 3/3, 5 pendente(s) |
| g09 | ok | ok | ok | n/a | pendente | pendente | pendente | n/a | pendente | pendente | 3/3, 5 pendente(s) |
