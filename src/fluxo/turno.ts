import { z } from 'zod'
import type { Config } from '../config/schema'
import { montarPrompt, ErroMontagem } from '../prompt/montar'
import { validarSaida } from '../validacao/saida'
import type { Mensagem, Saida, Violacao } from '../validacao/contrato'

export type Tipo = 'rede' | 'dns' | 'timeout' | '429' | '5xx' | 'cliente' | 'refusal' | 'max_tokens' | 'schema' | 'servico'
export type ModeloAtual = 'primario' | 'reserva'
export type Registro = { ts: string; tipo: Tipo; modelo: ModeloAtual; tentativa: number; camada: 1 | 2 }

export type Estado = {
  historico: Mensagem[]
  promptMontado: string
  /** Chamadas logicas do turno (sobe a cada regeneracao e na troca para a reserva). */
  tentativa: number
  correcao: string | null
  modelo_atual: ModeloAtual
  /** Chamadas logicas ja feitas ao modelo atual (1 = primeira). */
  tentativa_modelo: number
  /** Repeticao HTTP da chamada logica atual (1 = primeira). */
  tentativa_http: number
  /** Requisicoes HTTP ja respondidas ou falhadas no turno. */
  chamadas: number
  registros: Registro[]
  /** Inicio do turno, em ms; o prazo de ia.timeout_turno_ms conta daqui. */
  inicio_ms: number
}
export type Resultado = {
  resposta: string | null
  proxima_acao: Saida['proxima_acao']
  estado_conversa: 'aguardando_humano' | null
  saida: Saida | null
  tentativas: number
  origem: 'modelo' | 'falha'
  erro: boolean
  violacoes: Violacao[]
  conversa: Mensagem[]
  tipo: Tipo | null
  modelo_respondeu: ModeloAtual | null
  camada: 1 | 2 | 3
  registros: Registro[]
}
export type Passo = { fim: true; resultado: Resultado } | { fim: false; estado: Estado; esperar_ms: number }

const MAX_REGISTROS = 50
const clamp = (max: number) => z.number().int().transform((n) => Math.min(Math.max(n, 0), max))

const TIPOS = ['rede', 'dns', 'timeout', '429', '5xx', 'cliente', 'refusal', 'max_tokens', 'schema', 'servico'] as const

const HistoricoSchema = z
  .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
  .min(1)
  .max(40)
  .refine((h) => h.reduce((n, m) => n + m.content.length, 0) <= 8000, 'historico longo demais')
  .refine((h) => h.at(-1)?.role === 'user', 'a ultima mensagem deve ser do user')
  .refine((h) => h.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')), 'o historico deve alternar user/assistant, comecando por user')

const EntradaSchema = z.object({ historico: HistoricoSchema })

/** O estado volta do cliente de uma rota interna: forma validada e contadores limitados. */
export const EstadoSchema = z.object({
  historico: HistoricoSchema,
  promptMontado: z.string().min(1).max(200_000),
  tentativa: clamp(100),
  correcao: z.string().max(4000).nullable(),
  modelo_atual: z.enum(['primario', 'reserva']),
  tentativa_modelo: clamp(100),
  tentativa_http: clamp(100),
  chamadas: clamp(1000),
  inicio_ms: z.number().int().min(0),
  registros: z
    .array(
      z.object({
        ts: z.string().max(40),
        tipo: z.enum(TIPOS),
        modelo: z.enum(['primario', 'reserva']),
        tentativa: clamp(1000),
        camada: z.union([z.literal(1), z.literal(2)]),
      }),
    )
    .max(MAX_REGISTROS),
})

/** Uniao de mensagens consecutivas do user por quebra de linha (como no WhatsApp), antes da validacao. */
function unirUsers(entrada: unknown): unknown {
  const h = (entrada as { historico?: unknown } | null)?.historico
  if (!Array.isArray(h) || h.length > 1000) return entrada
  const saida: unknown[] = []
  for (const m of h) {
    const ant = saida.at(-1) as { role?: unknown; content?: unknown } | undefined
    const atual = m as { role?: unknown; content?: unknown } | null
    if (
      ant && atual && ant.role === 'user' && atual.role === 'user' &&
      typeof ant.content === 'string' && typeof atual.content === 'string'
    ) {
      // Fica com os 4000 caracteres mais recentes em vez de reprovar a entrada inteira.
      saida[saida.length - 1] = { role: 'user', content: (ant.content + '\n' + atual.content).slice(-4000) }
    } else saida.push(m)
  }
  return { ...(entrada as object), historico: saida }
}

function silencio(
  historico: Mensagem[], tentativas: number, tipo: Tipo | null, violacoes: Violacao[], registros: Registro[],
  roteia = true,
): Resultado {
  return {
    resposta: null,
    proxima_acao: roteia ? 'encaminhar_humano' : 'responder_e_encerrar',
    estado_conversa: roteia ? 'aguardando_humano' : null,
    saida: null,
    tentativas,
    origem: 'falha',
    erro: true,
    violacoes,
    conversa: historico,
    tipo,
    modelo_respondeu: null,
    camada: 3,
    registros,
  }
}

export function iniciarTurno(entrada: unknown, modelo: string, cfg: Config, agora: () => number = Date.now): Passo {
  const parsed = EntradaSchema.safeParse(unirUsers(entrada))
  if (!parsed.success) {
    // Entrada invalida: nao guarda historico do cliente nem encaminha a um humano.
    return { fim: true, resultado: silencio([], 0, null, [], [], false) }
  }
  const historico = parsed.data.historico as Mensagem[]
  try {
    const promptMontado = montarPrompt(modelo, cfg)
    return {
      fim: false,
      esperar_ms: 0,
      estado: {
        historico, promptMontado, tentativa: 1, correcao: null, modelo_atual: 'primario',
        tentativa_modelo: 1, tentativa_http: 1, chamadas: 0, registros: [], inicio_ms: agora(),
      },
    }
  } catch (e) {
    if (e instanceof ErroMontagem) return { fim: true, resultado: silencio(historico, 0, 'servico', [], []) }
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
    desvios: { type: 'integer', enum: [0, 1, 2, 3] },
    vagos: { type: 'integer', enum: [0, 1, 2, 3] },
    proxima_acao: enumStr(['perguntar', 'encaminhar_vendas', 'responder_e_encerrar', 'encaminhar_humano', 'ignorar']),
    resposta: { type: 'string' },
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

export function montarRequisicao(estado: Estado, cfg: Config): object {
  const messages: { role: string; content: string }[] = [...estado.historico]
  if (estado.correcao !== null) messages.push({ role: 'system', content: estado.correcao })
  return {
    model: estado.modelo_atual === 'reserva' ? cfg.ia.modelo_reserva : cfg.ia.modelo,
    max_tokens: cfg.ia.max_tokens,
    system: estado.promptMontado,
    messages,
    output_config: { effort: cfg.ia.effort, format: { type: 'json_schema', schema: schemaSaida(cfg) } },
  }
}

type RespostaN8n = { status?: number; cabecalhos?: Record<string, string>; corpo?: unknown; erro?: string }
export type Classe =
  | { tipo: null; saida: Saida }
  | { tipo: Tipo; violacoes: Violacao[]; retryAfterMs?: number; limiteGasto?: boolean }

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function normalizar(resposta: unknown): RespostaN8n {
  if (!ehObj(resposta)) return {}
  // Compatibilidade: corpo cru da API (com content ou stop_reason) vale como status 200.
  if (!('status' in resposta) && !('erro' in resposta) && !('corpo' in resposta) && ('content' in resposta || 'stop_reason' in resposta)) {
    return { status: 200, corpo: resposta }
  }
  const cab: Record<string, string> = {}
  if (ehObj(resposta.cabecalhos)) {
    for (const [k, v] of Object.entries(resposta.cabecalhos)) if (typeof v === 'string' || typeof v === 'number') cab[k.toLowerCase()] = String(v)
  }
  return {
    status: typeof resposta.status === 'number' ? resposta.status : undefined,
    cabecalhos: cab,
    corpo: resposta.corpo,
    erro: typeof resposta.erro === 'string' ? resposta.erro : undefined,
  }
}

const viol = (detalhe: string, regra: string): Violacao[] => [{ tipo: 'schema', regra, detalhe }]

export function classificar(estado: Estado, resposta: unknown, cfg: Config): Classe {
  const r = normalizar(resposta)
  const sem = (tipo: Tipo): Classe => ({ tipo, violacoes: [] })
  if (r.status === undefined) {
    const e = r.erro ?? ''
    if (/ENOTFOUND|EAI_AGAIN/i.test(e)) return sem('dns')
    if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(e)) return sem('timeout')
    return sem('rede')
  }
  const st = r.status
  if (st === 429) {
    const corpo = r.corpo as { error?: { details?: { error_code?: unknown } } } | undefined
    const limiteGasto = corpo?.error?.details?.error_code === 'enforced_spend_limit_reached'
    const ra = Number(r.cabecalhos?.['retry-after'])
    const retryAfterMs = r.cabecalhos?.['retry-after'] !== undefined && Number.isFinite(ra) && ra >= 0 ? Math.min(ra * 1000, 30000) : undefined
    return { tipo: '429', violacoes: [], limiteGasto, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) }
  }
  if (st >= 500 && st <= 599) return sem('5xx')
  if (st < 200 || st > 299) return st >= 400 && st < 500 ? sem('cliente') : sem('rede')
  const c = r.corpo as { stop_reason?: unknown; content?: unknown } | null | undefined
  const stop = c?.stop_reason
  if (stop === 'refusal' || stop === 'max_tokens') {
    return {
      tipo: stop,
      violacoes: viol(`A resposta anterior foi interrompida (${stop}). Responda de novo, de forma mais curta, somente com o JSON do contrato.`, 'sem_texto'),
    }
  }
  const blocos = Array.isArray(c?.content) ? (c!.content as { type?: unknown; text?: unknown }[]) : []
  const bloco = blocos.find((b) => b?.type === 'text' && typeof b.text === 'string')
  if (!bloco) return { tipo: 'schema', violacoes: viol('A resposta anterior veio sem texto. Responda somente com o JSON do contrato.', 'sem_texto') }
  const v = validarSaida(bloco.text as string, { historico: estado.historico, cfg, promptMontado: estado.promptMontado })
  if (v.ok) return { tipo: null, saida: v.saida }
  return { tipo: 'schema', violacoes: v.violacoes }
}

const TIPOS_REDE: Tipo[] = ['rede', 'dns', 'timeout', '429', '5xx']

export function processarResposta(estado: Estado, resposta: unknown, cfg: Config, agora: () => number = Date.now): Passo {
  const p = decidir(estado, resposta, cfg, agora)
  if (p.fim) return p
  // Prazo do turno: sem folga para outra chamada (espera mais timeout_ms) antes de o proxy abortar,
  // encerra aqui em silencio com o tipo da ultima falha, para o turno nao virar `n8n`.
  const restante = estado.inicio_ms + cfg.ia.timeout_turno_ms - agora()
  if (restante < p.esperar_ms + cfg.ia.timeout_ms) {
    const ultimo = p.estado.registros.at(-1)
    return { fim: true, resultado: silencio(estado.historico, estado.tentativa, ultimo?.tipo ?? 'timeout', [], p.estado.registros) }
  }
  return p
}

function decidir(estado: Estado, resposta: unknown, cfg: Config, agora: () => number): Passo {
  const cl = classificar(estado, resposta, cfg)
  const chamadas = estado.chamadas + 1
  const camada: 1 | 2 = estado.modelo_atual === 'primario' ? 1 : 2
  if (cl.tipo === null) {
    return {
      fim: true,
      resultado: {
        // Silencio deliberado (spec 006 R6): resposta vazia do modelo vai ao cliente como null.
        resposta: cl.saida.resposta.trim() === '' ? null : cl.saida.resposta,
        proxima_acao: cl.saida.proxima_acao,
        estado_conversa: null,
        saida: cl.saida,
        tentativas: estado.tentativa,
        origem: 'modelo',
        erro: false,
        violacoes: [],
        conversa: estado.historico,
        tipo: null,
        modelo_respondeu: estado.modelo_atual,
        camada,
        registros: estado.registros,
      },
    }
  }
  const registros = [
    ...estado.registros,
    { ts: new Date(agora()).toISOString(), tipo: cl.tipo, modelo: estado.modelo_atual, tentativa: chamadas, camada },
  ].slice(-MAX_REGISTROS)
  const base = { ...estado, chamadas, registros }

  const esgotar = (correcao: string | null): Passo => {
    if (estado.modelo_atual === 'primario' && cfg.ia.modelo_reserva !== '') {
      return {
        fim: false,
        esperar_ms: 0,
        estado: { ...base, modelo_atual: 'reserva', tentativa: estado.tentativa + 1, tentativa_modelo: 1, tentativa_http: 1, correcao },
      }
    }
    return { fim: true, resultado: silencio(estado.historico, estado.tentativa, cl.tipo, cl.violacoes, registros) }
  }

  if (TIPOS_REDE.includes(cl.tipo)) {
    if (cl.tipo === '429' && cl.limiteGasto) return esgotar(estado.correcao)
    if (estado.tentativa_http < cfg.ia.tentativas_http) {
      const espera = cl.retryAfterMs ?? cfg.ia.espera_ms[estado.tentativa_http - 1] ?? cfg.ia.espera_ms.at(-1) ?? 0
      return { fim: false, esperar_ms: espera, estado: { ...base, tentativa_http: estado.tentativa_http + 1 } }
    }
    return esgotar(estado.correcao)
  }
  if (cl.tipo === 'cliente') return esgotar(estado.correcao)

  const correcao =
    'Sua resposta anterior foi rejeitada pelos seguintes motivos. Corrija todos e responda somente com o JSON do contrato:\n' +
    cl.violacoes.map((x) => `- ${x.detalhe}`).join('\n')
  const limite = estado.modelo_atual === 'primario' ? 1 + cfg.ia.max_regeracoes : cfg.ia.tentativas_reserva
  if (estado.tentativa_modelo < limite) {
    return {
      fim: false,
      esperar_ms: 0,
      estado: { ...base, tentativa: estado.tentativa + 1, tentativa_modelo: estado.tentativa_modelo + 1, tentativa_http: 1, correcao },
    }
  }
  return esgotar(correcao)
}
