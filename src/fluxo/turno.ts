import { z } from 'zod'
import type { Config } from '../config/schema'
import { montarPrompt, ErroMontagem } from '../prompt/montar'
import { validarSaida } from '../validacao/saida'
import { telefonesDoLead, type Mensagem, type Saida, type Violacao } from '../validacao/contrato'

export type Estado = {
  historico: Mensagem[]
  promptMontado: string
  tentativa: number
  correcao: string | null
}
export type Resultado = {
  resposta: string
  proxima_acao: Saida['proxima_acao']
  saida: Saida | null
  tentativas: number
  origem: 'modelo' | 'falha'
  erro: boolean
  violacoes: Violacao[]
  conversa: Mensagem[]
}
export type Passo = { fim: true; resultado: Resultado } | { fim: false; estado: Estado }

const EntradaSchema = z.object({
  historico: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40)
    .refine((h) => h.reduce((n, m) => n + m.content.length, 0) <= 8000, 'historico longo demais')
    .refine((h) => h.at(-1)?.role === 'user', 'a ultima mensagem deve ser do user')
    .refine((h) => h.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')), 'o historico deve alternar user/assistant, comecando por user'),
})

// Numero da propria empresa (empresa.contato) escrito pelo lead nao e contato do lead.
const temTelefone = (historico: Mensagem[], cfg: Config) =>
  historico.filter((m) => m.role === 'user').some((m) => telefonesDoLead(m.content, cfg.empresa.contato).length > 0)

function falha(historico: Mensagem[], tentativas: number, violacoes: Violacao[], cfg: Config): Resultado {
  return {
    resposta: cfg.textos.falha_tecnica,
    proxima_acao: temTelefone(historico, cfg) ? 'encaminhar_humano' : 'responder_e_encerrar',
    saida: null,
    tentativas,
    origem: 'falha',
    erro: true,
    violacoes,
    conversa: historico,
  }
}

export function iniciarTurno(entrada: unknown, modelo: string, cfg: Config): Passo {
  const parsed = EntradaSchema.safeParse(entrada)
  if (!parsed.success) {
    // Entrada invalida: nao guarda historico do cliente nem encaminha a um humano.
    return { fim: true, resultado: falha([], 0, [], cfg) }
  }
  const historico = parsed.data.historico as Mensagem[]
  try {
    const promptMontado = montarPrompt(modelo, cfg)
    return { fim: false, estado: { historico, promptMontado, tentativa: 1, correcao: null } }
  } catch (e) {
    if (e instanceof ErroMontagem) return { fim: true, resultado: falha(historico, 0, [], cfg) }
    throw e
  }
}

export function schemaSaida(cfg: Config): object {
  const nulavel = (s: object) => ({ anyOf: [s, { type: 'null' }] })
  const enumStr = (valores: string[]) => ({ type: 'string', enum: valores })
  const properties = {
    tipo_servico: nulavel(enumStr([...cfg.servicos, 'fora_escopo'])),
    segmento: nulavel(enumStr(cfg.segmentos)),
    cidade: nulavel({ type: 'string' }),
    nome: nulavel({ type: 'string' }),
    telefone: nulavel({ type: 'string' }),
    urgencia: nulavel(enumStr(['alta', 'media', 'baixa'])),
    dados_faltantes: { type: 'array', items: enumStr(['tipo_servico', 'segmento', 'cidade', 'telefone']) },
    qualificado: { type: 'boolean' },
    confianca: { type: 'number' },
    proxima_acao: enumStr(['perguntar', 'encaminhar_vendas', 'responder_e_encerrar', 'encaminhar_humano']),
    resposta: { type: 'string' },
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

export function montarRequisicao(estado: Estado, cfg: Config): object {
  const messages: { role: string; content: string }[] = [...estado.historico]
  if (estado.correcao !== null) messages.push({ role: 'system', content: estado.correcao })
  return {
    model: cfg.ia.modelo,
    max_tokens: cfg.ia.max_tokens,
    system: estado.promptMontado,
    messages,
    output_config: { effort: cfg.ia.effort, format: { type: 'json_schema', schema: schemaSaida(cfg) } },
  }
}

function extrairTexto(respostaApi: unknown): { texto: string } | { motivo: string } {
  const r = respostaApi as { stop_reason?: unknown; content?: unknown } | null
  const stop = r?.stop_reason
  if (stop === 'refusal' || stop === 'max_tokens') {
    return { motivo: `A resposta anterior foi interrompida (${String(stop)}). Responda de novo, de forma mais curta, somente com o JSON do contrato.` }
  }
  const blocos = Array.isArray(r?.content) ? (r!.content as { type?: unknown; text?: unknown }[]) : []
  const bloco = blocos.find((b) => b?.type === 'text' && typeof b.text === 'string')
  if (!bloco) return { motivo: 'A resposta anterior veio sem texto. Responda somente com o JSON do contrato.' }
  return { texto: bloco.text as string }
}

export function processarResposta(estado: Estado, respostaApi: unknown, cfg: Config): Passo {
  const ext = extrairTexto(respostaApi)
  let violacoes: Violacao[]
  if ('motivo' in ext) {
    violacoes = [{ tipo: 'schema', regra: 'sem_texto', detalhe: ext.motivo }]
  } else {
    const v = validarSaida(ext.texto, { historico: estado.historico, cfg, promptMontado: estado.promptMontado })
    if (v.ok) {
      return {
        fim: true,
        resultado: {
          resposta: v.saida.resposta,
          proxima_acao: v.saida.proxima_acao,
          saida: v.saida,
          tentativas: estado.tentativa,
          origem: 'modelo',
          erro: false,
          violacoes: [],
          conversa: estado.historico,
        },
      }
    }
    violacoes = v.violacoes
  }
  if (estado.tentativa < 1 + cfg.ia.max_regeracoes) {
    const correcao =
      'Sua resposta anterior foi rejeitada pelos seguintes motivos. Corrija todos e responda somente com o JSON do contrato:\n' +
      violacoes.map((x) => `- ${x.detalhe}`).join('\n')
    return { fim: false, estado: { ...estado, tentativa: estado.tentativa + 1, correcao } }
  }
  return { fim: true, resultado: falha(estado.historico, estado.tentativa, violacoes, cfg) }
}

export function falhaDeApi(estado: Estado, cfg: Config): Resultado {
  return falha(estado.historico, estado.tentativa, [], cfg)
}
