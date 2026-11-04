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
| a01 | ok | ok | ok | n/a | ok | falhou | n/a | n/a | ok | ok | 6/7 |
| a02 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| a03 | ok | ok | ok | n/a | ok | falhou | n/a | n/a | ok | ok | 6/7 |
| a04 | ok | ok | ok | n/a | ok | falhou | n/a | n/a | ok | ok | 6/7 |
| a05 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| a06 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| a07 | ok | ok | ok | n/a | ok | ok | ok | n/a | ok | ok | 8/8 |
| a08 | ok | ok | ok | n/a | ok | ok | ok | n/a | ok | ok | 8/8 |
| a09 | ok | ok | ok | ok | ok | ok | n/a | n/a | ok | ok | 8/8 |
| a10 | ok | ok | ok | n/a | ok | ok | n/a | ok | ok | ok | 8/8 |
| a11 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| a12 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| a13 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| a14 | ok | ok | ok | n/a | falhou | ok | ok | n/a | ok | ok | 7/8 |

### reservado

| Caso | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Aprovados |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r01 | ok | ok | ok | ok | ok | ok | n/a | ok | ok | n/a | 8/8 |
| r02 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| r03 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| r04 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| r05 | ok | ok | ok | n/a | ok | ok | ok | n/a | ok | ok | 8/8 |
| r06 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |

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
| g01 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| g02 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| g03 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| g04 | ok | ok | ok | n/a | ok | ok | n/a | n/a | ok | ok | 7/7 |
| g05 | ok | ok | ok | ok | ok | ok | n/a | ok | ok | ok | 9/9 |
| g06 | ok | ok | ok | ok | ok | ok | n/a | n/a | ok | ok | 8/8 |
| g07 | ok | ok | ok | ok | ok | ok | n/a | n/a | ok | ok | 8/8 |
| g08 | ok | ok | ok | n/a | ok | ok | ok | n/a | ok | ok | 8/8 |
| g09 | ok | ok | ok | n/a | ok | ok | ok | n/a | ok | ok | 8/8 |

## Validação sintética (conjunto à parte: não entra nos números acima)

Validação sintética (n=42); gabarito gerado por modelo, ainda sem revisão humana.

| Campo | Acerto validação |
|---|---|
| tipo_servico | 37/42 (88%) |
| segmento | 41/42 (98%) |
| cidade | 32/42 (76%) |
| urgencia | 28/42 (67%) |
| qualificado | 40/42 (95%) |
| proxima_acao | 35/42 (83%) |

## Taxa de falha

A taxa é por conjunto.

- validacao: 1/90 = 1,1 % ([falhas-validacao.md](falhas-validacao.md))
