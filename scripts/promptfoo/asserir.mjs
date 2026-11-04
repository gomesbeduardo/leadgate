// Asserção do promptfoo: nota 0/1 por campo, com a semantica de src/avaliacao/metricas.mjs (avaliarCaso).
import { CAMPOS, acertoCampo } from '../../src/avaliacao/metricas.mjs'

/** @param {any} output ultimo turno do /api/chat; @param {any} context */
export function pontuar(output, esperado) {
  // Mesma condicao de avaliarCaso: turno com origem 'falha', erro ou sem saida invalida todos os campos.
  const valido = Boolean(output && output.origem !== 'falha' && !output.erro && output.saida)
  // saida_valida: 1 so quando o turno tem saida utilizavel; o somar.mjs usa para invalidar a comparacao (falha tecnica nao e erro de campo).
  const namedScores = {}
  for (const c of CAMPOS) namedScores[c] = valido && acertoCampo(c, output.saida[c], esperado?.[c] ?? []) ? 1 : 0
  namedScores.saida_valida = valido ? 1 : 0
  const acertos = CAMPOS.filter((c) => namedScores[c] === 1).length
  return {
    pass: valido && acertos === CAMPOS.length,
    score: acertos / CAMPOS.length,
    reason: valido ? `${acertos}/${CAMPOS.length} campos` : 'saida invalida',
    namedScores,
  }
}

export default function asserir(output, context) {
  return pontuar(output, context?.vars?.esperado)
}
