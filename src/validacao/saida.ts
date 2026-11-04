import type { Config } from '../config/schema'
import { analisarContrato, type Mensagem, type ResultadoValidacao } from './contrato'
import { validarResposta } from './resposta'

export function validarSaida(
  textoModelo: string,
  ctx: { historico: Mensagem[]; cfg: Config; promptMontado: string },
): ResultadoValidacao {
  const { saida, violacoes } = analisarContrato(textoModelo, ctx)
  const ultimaMsgLead = [...ctx.historico].reverse().find((m) => m.role === 'user')?.content
  const todas = saida
    ? [...violacoes, ...validarResposta(saida.resposta, { cfg: ctx.cfg, promptMontado: ctx.promptMontado, ultimaMsgLead })]
    : violacoes
  return todas.length > 0 || !saida ? { ok: false, violacoes: todas } : { ok: true, saida }
}
