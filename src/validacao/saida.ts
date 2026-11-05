import type { Config } from '../config/schema'
import { analisarContrato, type Mensagem, type ResultadoValidacao } from './contrato'
import { validarResposta } from './resposta'

export function validarSaida(
  textoModelo: string,
  ctx: { historico: Mensagem[]; cfg: Config; promptMontado: string; silencioOcorrido?: boolean },
): ResultadoValidacao {
  const { saida, violacoes, ressalvas } = analisarContrato(textoModelo, ctx)
  const ultimaMsgLead = [...ctx.historico].reverse().find((m) => m.role === 'user')?.content
  // Resposta vazia so e valida em ignorar e no encaminhar_vendas silencioso (desvios=3 ou vagos=2, spec 006).
  const vazioPermitido = saida !== undefined && (saida.proxima_acao === 'ignorar' || (saida.proxima_acao === 'encaminhar_vendas' && (saida.desvios === 3 || saida.vagos === 2)))
  const todas = saida
    ? [...violacoes, ...validarResposta(saida.resposta, { cfg: ctx.cfg, promptMontado: ctx.promptMontado, ultimaMsgLead, vazioPermitido, telefone: saida.telefone })]
    : violacoes
  return todas.length > 0 || !saida ? { ok: false, violacoes: todas } : { ok: true, saida, ressalvas: ressalvas ?? [] }
}
