import { z } from 'zod'
import type { Config } from '../config/schema'
import { digitosTelefone, extrairTelefones } from './telefone'

export type Mensagem = { role: 'user' | 'assistant'; content: string }
// Para novos tipos de verificacao (ex.: 'resposta'), basta ampliar esta uniao.
export type TipoViolacao = 'schema' | 'cruzada' | 'resposta'
export type Violacao = { tipo: TipoViolacao; regra: string; detalhe: string }

export type Acao = 'perguntar' | 'encaminhar_vendas' | 'responder_e_encerrar' | 'encaminhar_humano'
export type Saida = {
  tipo_servico: string | null
  segmento: string | null
  cidade: string | null
  nome: string | null
  telefone: string | null
  urgencia: 'alta' | 'media' | 'baixa' | null
  dados_faltantes: ('tipo_servico' | 'segmento' | 'cidade' | 'telefone')[]
  qualificado: boolean
  confianca: number
  proxima_acao: Acao
  resposta: string
}
export type ResultadoValidacao = { ok: true; saida: Saida } | { ok: false; violacoes: Violacao[] }

const enumDe = (valores: string[]) => z.enum(valores as [string, ...string[]])

function montarSchema(cfg: Config) {
  const texto = z.string().nullable()
  return z.object({
    tipo_servico: enumDe([...cfg.servicos, 'fora_escopo']).nullable(),
    segmento: enumDe(cfg.segmentos).nullable(),
    cidade: texto,
    nome: texto,
    telefone: texto,
    urgencia: z.enum(['alta', 'media', 'baixa']).nullable(),
    dados_faltantes: z.array(z.enum(['tipo_servico', 'segmento', 'cidade', 'telefone'])),
    qualificado: z.boolean(),
    confianca: z.number(),
    proxima_acao: z.enum(['perguntar', 'encaminhar_vendas', 'responder_e_encerrar', 'encaminhar_humano']),
    resposta: z.string(),
  })
}

export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

const contarInterrogacoes = (s: string) => (s.match(/[?？]/g) ?? []).length

// "Florianopolis-SC", "Florianopolis/SC", "Florianopolis, SC".
const SUFIXO_UF = /^(.*?)\s*[-/,]\s*([a-z]{2})$/

/** Cidade sem o sufixo de UF, ou null se nao esta na lista ou a UF nao bate com a da cidade. */
function cidadeAtendida(cidade: string, cfg: Config): string | null {
  const ufPorCidade = new Map(Object.entries(cfg.regiao.ufs).map(([c, uf]) => [normalizar(c), normalizar(uf)]))
  const n = normalizar(cidade)
  if (ufPorCidade.has(n)) return n
  const m = SUFIXO_UF.exec(n)
  if (m && ufPorCidade.get(m[1]!) === m[2]) return m[1]!
  return null
}

/** Distancia de edicao (Levenshtein) entre duas strings. */
function distancia(a: string, b: string): number {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(ant[j]! + 1, cur[j - 1]! + 1, ant[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    ant = cur
  }
  return ant[b.length]!
}

/** Cidade fora da lista, mas a ate 2 edicoes de uma cidade atendida: provavel erro de digitacao ou transcricao. */
function cidadeParecida(cidade: string, cfg: Config): boolean {
  const n = normalizar(cidade)
  const m = SUFIXO_UF.exec(n)
  const alvos = m ? [n, m[1]!] : [n]
  return cfg.regiao.cidades.some((c) => alvos.some((a) => distancia(a, normalizar(c)) <= 2))
}

/** Telefones do lead, sem os da propria empresa. */
export const telefonesDoLead = (texto: string, contato: string): string[] => {
  const da_empresa = new Set(extrairTelefones(contato).map(digitosTelefone))
  return extrairTelefones(texto).filter((t) => !da_empresa.has(digitosTelefone(t)))
}

/** O telefone so conta se o campo inteiro e um numero e os digitos aparecem numa fala do lead. */
function telefoneReal(telefone: string | null, historico: Mensagem[], contato: string): boolean {
  if (telefone === null || telefone.trim() === '') return false
  const achados = extrairTelefones(telefone)
  if (achados.length !== 1 || achados[0] !== telefone.trim()) return false
  const alvo = digitosTelefone(achados[0])
  return historico
    .filter((m) => m.role === 'user')
    .some((m) => telefonesDoLead(m.content, contato).some((t) => digitosTelefone(t) === alvo))
}

function schemaViol(regra: string, detalhe: string): Violacao {
  return { tipo: 'schema', regra, detalhe }
}

export function validarContrato(
  textoModelo: string,
  ctx: { historico: Mensagem[]; cfg: Config },
): ResultadoValidacao {
  const { saida, violacoes } = analisarContrato(textoModelo, ctx)
  return violacoes.length > 0 || !saida ? { ok: false, violacoes } : { ok: true, saida }
}

/** Schema + regras cruzadas; `saida` vem preenchida sempre que o JSON passou no schema. */
export function analisarContrato(
  textoModelo: string,
  ctx: { historico: Mensagem[]; cfg: Config },
): { saida?: Saida; violacoes: Violacao[] } {
  const { cfg, historico } = ctx

  let bruto: unknown
  try {
    bruto = JSON.parse(textoModelo)
  } catch {
    return {
      violacoes: [schemaViol('json_invalido', 'A saida nao e JSON valido. Responda somente com um objeto JSON no formato do contrato, sem texto extra.')],
    }
  }

  const parsed = montarSchema(cfg).safeParse(bruto)
  if (!parsed.success) {
    return {
      violacoes: parsed.error.issues.map((i) => {
        const campo = i.path.join('.') || 'raiz'
        return schemaViol(`schema_${campo}`, `Campo "${campo}" invalido: ${i.message}. Corrija para respeitar o contrato.`)
      }),
    }
  }

  const s = parsed.data as Saida
  const v: Violacao[] = []
  const cruz = (regra: string, detalhe: string) => v.push({ tipo: 'cruzada', regra, detalhe })

  const limiar = cfg.ia.limiar_confianca
  const contato = cfg.empresa.contato
  const servido = s.tipo_servico !== null && cfg.servicos.includes(s.tipo_servico)
  const aceito = s.segmento !== null && cfg.segmentos_aceitos.includes(s.segmento)
  const cidade = s.cidade !== null && s.cidade.trim() !== '' ? s.cidade : null
  const cidadeBase = cidade !== null ? cidadeAtendida(cidade, cfg) : null
  const cidadeOk = cidadeBase !== null
  // A cidade tem de ter sido dita pelo lead (o assistant do historico e do cliente).
  const cidadeDita = cidadeBase !== null && historico.some((m) => m.role === 'user' && normalizar(m.content).includes(cidadeBase))
  const temTelefone = telefoneReal(s.telefone, historico, contato)
  const telefoneInventado = s.telefone !== null && s.telefone.trim() !== '' && !temTelefone
  const recusa = s.tipo_servico === 'fora_escopo' || (s.segmento !== null && !aceito)
  const cidadeFora = cidade !== null && !cidadeOk
  const citaContato = normalizar(s.resposta).includes(normalizar(contato))

  // telefone preenchido tem de ser um unico numero dito pelo lead
  if (telefoneInventado) {
    cruz('telefone_nao_confere', 'telefone deve ser exatamente um numero que o lead informou. Use null se ele nao informou.')
  }

  // confianca no intervalo
  if (s.confianca < 0 || s.confianca > 1) {
    cruz('confianca_fora_intervalo', `confianca=${s.confianca} fora de [0, 1]. Use um valor entre 0 e 1.`)
  }

  // qualificado = true
  if (s.qualificado) {
    if (!servido) cruz('qualificado_exige_servico', 'qualificado=true exige tipo_servico atendido pela empresa. Marque qualificado=false.')
    if (!aceito) cruz('qualificado_exige_segmento_aceito', 'qualificado=true exige segmento aceito. Marque qualificado=false.')
    if (!cidadeOk) cruz('qualificado_exige_cidade', 'qualificado=true exige cidade dentro da regiao atendida. Marque qualificado=false.')
    else if (!cidadeDita) cruz('qualificado_exige_cidade_dita', 'qualificado=true exige que o lead tenha dito a cidade. Pergunte a cidade e marque qualificado=false.')
    if (!temTelefone) cruz('qualificado_exige_telefone', 'qualificado=true exige telefone preenchido. Marque qualificado=false e pergunte o telefone.')
    if (s.dados_faltantes.length > 0) cruz('qualificado_exige_sem_faltantes', 'qualificado=true exige dados_faltantes vazio. Ajuste qualificado ou dados_faltantes.')
    if (s.proxima_acao !== 'perguntar' && s.proxima_acao !== 'encaminhar_vendas') {
      cruz('qualificado_exige_acao', 'qualificado=true exige proxima_acao perguntar ou encaminhar_vendas.')
    }
  }

  // dados completos com confianca suficiente exigem qualificado
  if (servido && aceito && cidadeOk && cidadeDita && temTelefone && s.confianca >= limiar && !s.qualificado) {
    cruz('dados_completos_exigem_qualificado', 'Servico, segmento, cidade e telefone estao completos com confianca suficiente: marque qualificado=true.')
  }

  // recusa
  if (recusa) {
    if (s.qualificado) cruz('recusa_exige_nao_qualificado', 'Servico fora do escopo ou segmento nao aceito exige qualificado=false.')
    if (s.proxima_acao !== 'responder_e_encerrar') cruz('recusa_exige_encerrar', 'Servico fora do escopo ou segmento nao aceito exige proxima_acao=responder_e_encerrar.')
  }

  // acoes
  if (s.proxima_acao === 'encaminhar_vendas') {
    if (!s.qualificado) cruz('vendas_exige_qualificado', 'encaminhar_vendas exige qualificado=true. Mude a acao ou qualifique o lead.')
    if (s.confianca < limiar) cruz('confianca_baixa_sem_vendas', `confianca abaixo do limiar (${limiar}) proibe encaminhar_vendas.`)
  }
  if (s.proxima_acao === 'encaminhar_humano' && !temTelefone) {
    cruz('humano_exige_telefone', 'encaminhar_humano exige telefone preenchido. Sem telefone, use responder_e_encerrar citando o contato da empresa.')
  }
  if (s.proxima_acao === 'perguntar') {
    const n = contarInterrogacoes(s.resposta)
    if (n !== 1) cruz('perguntar_exige_uma_interrogacao', `proxima_acao=perguntar exige exatamente uma interrogacao na resposta; encontradas ${n}. Faca uma unica pergunta.`)
  }

  // So perguntar pode terminar em interrogacao.
  if (s.proxima_acao !== 'perguntar' && contarInterrogacoes(s.resposta) > 0) {
    cruz('interrogacao_so_com_perguntar', 'Somente proxima_acao=perguntar pode ter interrogacao na resposta. Reescreva sem pergunta ou mude a acao.')
  }

  // R4
  if (s.urgencia === 'alta' && s.qualificado && s.proxima_acao !== 'encaminhar_vendas') {
    cruz('urgencia_alta_exige_vendas', 'urgencia alta com lead qualificado exige proxima_acao=encaminhar_vendas.')
  }

  // R5: duvida que pergunta nao resolve
  // O cliente controla o historico: conta turnos, nao o '?' que ele escreve.
  const turnosAssistant = historico.filter((m) => m.role === 'assistant').length
  const turnosUser = historico.filter((m) => m.role === 'user').length
  const perguntasFeitas = Math.max(turnosAssistant, turnosUser - 1)
  const tetoAtingido = perguntasFeitas >= cfg.conversa.teto_perguntas
  if (tetoAtingido && s.proxima_acao === 'perguntar') {
    cruz('teto_perguntas_atingido', `O teto de ${cfg.conversa.teto_perguntas} perguntas foi atingido: nao pergunte mais. Encaminhe a um humano (com telefone) ou encerre citando o contato.`)
  }
  const faltaDado = s.dados_faltantes.length > 0 || s.tipo_servico === null || s.segmento === null || s.cidade === null || !temTelefone
  // Cidade parecida com a lista ainda nao e fora da regiao: abaixo do teto, perguntar para confirmar e valido.
  const cidadeEmDuvida = cidadeFora && !tetoAtingido && s.proxima_acao === 'perguntar' && cidade !== null && cidadeParecida(cidade, cfg)
  const precisaRotear = !recusa && ((cidadeFora && !cidadeEmDuvida) || (tetoAtingido && faltaDado))
  if (precisaRotear) {
    const motivo = cidadeFora && !cidadeEmDuvida ? 'cidade fora da regiao atendida' : 'teto de perguntas atingido com dados obrigatorios faltando'
    if (cidadeFora && s.qualificado) cruz('cidade_fora_exige_nao_qualificado', 'Cidade fora da regiao atendida exige qualificado=false.')
    if (temTelefone) {
      if (s.proxima_acao !== 'encaminhar_humano') cruz('duvida_com_telefone_exige_humano', `Motivo: ${motivo}. Com telefone, use proxima_acao=encaminhar_humano.`)
    } else {
      if (s.proxima_acao !== 'responder_e_encerrar') cruz('duvida_sem_telefone_exige_encerrar', `Motivo: ${motivo}. Sem telefone, use proxima_acao=responder_e_encerrar.`)
      else if (!citaContato) cruz('duvida_sem_telefone_exige_contato', `Motivo: ${motivo}. A resposta deve citar o contato da empresa: ${contato}.`)
    }
  }

  // R5: lead dentro do escopo nunca e dispensado com um simples encerramento.
  if (!recusa && !precisaRotear && s.proxima_acao === 'responder_e_encerrar') {
    if (temTelefone) {
      cruz('encerrar_com_telefone_exige_humano', 'Lead nao recusado com telefone nao pode ser encerrado: use proxima_acao=encaminhar_humano.')
    } else if ((servido || aceito || cidadeOk) && !citaContato) {
      cruz('encerrar_sem_telefone_exige_contato', `Lead dentro do escopo sem telefone: a resposta deve citar o contato da empresa: ${contato}.`)
    }
  }

  return { saida: s, violacoes: v }
}
