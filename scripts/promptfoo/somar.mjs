// Soma da comparacao base x branch (issue 15): acertos por campo e por provider, a partir do JSON do promptfoo.
// Regra da esteira (passo 4): 3 rodadas em cada lado, soma dos acertos por campo; bloqueia se a soma da branch ficar abaixo da base.
import { CAMPOS } from '../../src/avaliacao/metricas.mjs'

export const CASOS_AJUSTE = 14
export const RODADAS = 3
export const LINHAS_ESPERADAS = CASOS_AJUSTE * RODADAS
export const LADOS = ['base', 'branch']

/** @param {unknown} json saida do `promptfoo eval -o` */
export function somar(json, esperadas = LINHAS_ESPERADAS) {
  const linhas = json?.results?.results
  if (!Array.isArray(linhas)) throw new Error('JSON do promptfoo com formato inesperado: results.results ausente')
  const lados = Object.fromEntries(LADOS.map((l) => [l, { n: 0, erros: 0, acertos: Object.fromEntries(CAMPOS.map((c) => [c, 0])) }]))
  for (const linha of linhas) {
    const rotulo = linha?.provider?.label ?? linha?.provider?.id
    const lado = lados[rotulo]
    if (!lado) throw new Error(`JSON do promptfoo com formato inesperado: provider "${rotulo}" desconhecido`)
    if (typeof linha !== 'object' || (linha.gradingResult != null && typeof linha.gradingResult !== 'object')) throw new Error('JSON do promptfoo com formato inesperado: linha invalida')
    lado.n += 1
    // Erro do provider (HTTP, rede, sem resposta) conta em n e nunca como acerto.
    // O campo `error` da linha tambem vem preenchido quando so a asserção reprova ("5/6 campos"), por isso nao serve de criterio.
    if (linha.response?.error || linha.gradingResult == null) {
      lado.erros += 1
      continue
    }
    const nomes = linha.gradingResult?.namedScores
    if (!nomes || typeof nomes !== 'object') throw new Error('JSON do promptfoo com formato inesperado: namedScores ausente em linha avaliada')
    for (const c of CAMPOS) {
      if (typeof nomes[c] !== 'number') throw new Error(`JSON do promptfoo com formato inesperado: namedScores.${c} ausente`)
      lado.acertos[c] += nomes[c] >= 1 ? 1 : 0
    }
  }
  const problemas = []
  for (const l of LADOS) {
    if (lados[l].n === 0) problemas.push(`${l}: não medida (nenhuma linha)`)
    else if (lados[l].erros > 0) problemas.push(`${l}: ${lados[l].erros} de ${lados[l].n} linhas com erro${lados[l].erros === lados[l].n ? ' (não medida)' : ''}`)
    if (lados[l].n > 0 && lados[l].n < esperadas) problemas.push(`${l}: só ${lados[l].n} de ${esperadas} linhas`)
  }
  const campos = CAMPOS.map((c) => {
    const base = lados.base.acertos[c]
    const branch = lados.branch.acertos[c]
    return { campo: c, base, branch, bloqueia: branch < base }
  })
  const bloqueado = campos.some((c) => c.bloqueia)
  const valido = problemas.length === 0
  return { valido, problemas, lados, campos, bloqueado, aprovado: valido && !bloqueado }
}

const pct = (a, n, erros) => (n === 0 || erros === n ? 'não medida' : `${a}/${n} (${((100 * a) / n).toFixed(1).replace('.', ',')} %)`)

/** @param {ReturnType<typeof somar>} r */
export function tabelaMarkdown(r) {
  const linhas = ['| campo | base | branch | situação |', '|---|---|---|---|']
  for (const c of r.campos) {
    const situacao = !r.valido ? 'inválida' : c.bloqueia ? 'bloqueia' : 'ok'
    linhas.push(`| ${c.campo} | ${pct(c.base, r.lados.base.n, r.lados.base.erros)} | ${pct(c.branch, r.lados.branch.n, r.lados.branch.erros)} | ${situacao} |`)
  }
  return linhas.join('\n')
}
