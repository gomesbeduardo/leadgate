import { z } from 'zod'
import type { Config } from '../config/schema'
import { digitosTelefone, extrairTelefones } from './telefone'

export type Mensagem = { role: 'user' | 'assistant'; content: string }
// Para novos tipos de verificacao (ex.: 'resposta'), basta ampliar esta uniao.
export type TipoViolacao = 'schema' | 'cruzada' | 'resposta'
export type Violacao = { tipo: TipoViolacao; regra: string; detalhe: string }

export type Acao = 'perguntar' | 'encaminhar_vendas' | 'responder_e_encerrar' | 'encaminhar_humano' | 'ignorar'
export type Saida = {
  tipo_servico: string | null
  segmento: string | null
  cidade: string | null
  uf: string | null
  nome: string | null
  telefone: string | null
  ja_cliente: boolean | null
  email: string | null
  urgencia: 'alta' | 'media' | 'baixa' | null
  dados_faltantes: ('tipo_servico' | 'segmento' | 'cidade' | 'telefone')[]
  qualificado: boolean
  confianca: number
  desvios: number
  vagos: number
  proxima_acao: Acao
  resposta: string
}
export type Ressalva = 'residencial' | 'fora_regiao' | 'so_email'
export type ResultadoValidacao = { ok: true; saida: Saida; ressalvas: Ressalva[] } | { ok: false; violacoes: Violacao[] }

const enumDe = (valores: string[]) => z.enum(valores as [string, ...string[]])

function montarSchema(cfg: Config) {
  const texto = z.string().nullable()
  return z.object({
    tipo_servico: enumDe([...cfg.servicos, 'fora_escopo']).nullable(),
    segmento: enumDe(cfg.segmentos).nullable(),
    cidade: texto,
    uf: texto,
    nome: texto,
    telefone: texto,
    ja_cliente: z.boolean().nullable(),
    email: texto,
    urgencia: z.enum(['alta', 'media', 'baixa']).nullable(),
    dados_faltantes: z.array(z.enum(['tipo_servico', 'segmento', 'cidade', 'telefone'])),
    qualificado: z.boolean(),
    confianca: z.number(),
    desvios: z.number().int().min(0).max(3),
    vagos: z.number().int().min(0).max(3),
    proxima_acao: z.enum(['perguntar', 'encaminhar_vendas', 'responder_e_encerrar', 'encaminhar_humano', 'ignorar']),
    resposta: z.string(),
  })
}

const NOMES_UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
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
export function cidadeParecida(cidade: string, cfg: Config): boolean {
  const n = normalizar(cidade)
  const m = SUFIXO_UF.exec(n)
  if (m) {
    // Com sufixo, so conta a cidade da lista cuja UF e a do sufixo.
    return cfg.regiao.cidades.some((c) => normalizar(cfg.regiao.ufs[c] ?? '') === m[2] && distancia(m[1]!, normalizar(c)) <= 2)
  }
  return cfg.regiao.cidades.some((c) => distancia(n, normalizar(c)) <= 2)
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

/** O e-mail so conta se aparece literalmente (sem maiusculas, sem espacos nas pontas) numa fala do lead. */
function emailReal(email: string | null, historico: Mensagem[]): boolean {
  const alvo = email === null ? '' : email.trim().toLowerCase()
  if (alvo === '') return false
  return historico.some((m) => m.role === 'user' && m.content.toLowerCase().includes(alvo))
}

/** Ressalvas calculadas pelo servico, na ordem fixa residencial, fora_regiao, so_email. */
export function calcularRessalvas(s: Saida, ctx: { historico: Mensagem[]; cfg: Config }): Ressalva[] {
  const { cfg, historico } = ctx
  const r: Ressalva[] = []
  const servido = s.tipo_servico !== null && cfg.servicos.includes(s.tipo_servico)
  const aceito = s.segmento !== null && cfg.segmentos_aceitos.includes(s.segmento)
  const cidade = s.cidade !== null && s.cidade.trim() !== '' ? s.cidade : null
  const cidadeOk = cidade !== null && cidadeAtendida(cidade, cfg) !== null
  if (s.segmento !== null && !aceito) r.push('residencial')
  if (cidade !== null && !cidadeOk && !cidadeParecida(cidade, cfg)) r.push('fora_regiao')
  if (emailReal(s.email, historico) && !telefoneReal(s.telefone, historico, cfg.empresa.contato) && servido && aceito && cidadeOk) r.push('so_email')
  return r
}

function schemaViol(regra: string, detalhe: string): Violacao {
  return { tipo: 'schema', regra, detalhe }
}

export function validarContrato(
  textoModelo: string,
  ctx: { historico: Mensagem[]; cfg: Config; silencioOcorrido?: boolean },
): ResultadoValidacao {
  const { saida, violacoes, ressalvas } = analisarContrato(textoModelo, ctx)
  return violacoes.length > 0 || !saida ? { ok: false, violacoes } : { ok: true, saida, ressalvas: ressalvas ?? [] }
}

/** Schema + regras cruzadas; `saida` vem preenchida sempre que o JSON passou no schema. */
export function analisarContrato(
  textoModelo: string,
  ctx: { historico: Mensagem[]; cfg: Config; silencioOcorrido?: boolean },
): { saida?: Saida; violacoes: Violacao[]; ressalvas?: Ressalva[] } {
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
  const temEmail = emailReal(s.email, historico)
  const emailInventado = s.email !== null && s.email.trim() !== '' && !temEmail
  // Contato real: telefone ou e-mail que o lead de fato escreveu.
  const temContato = temTelefone || temEmail
  const ressalvas = calcularRessalvas(s, ctx)
  const foraEscopo = s.tipo_servico === 'fora_escopo'
  // recusa so vale para a regra de qualificado; encerrar e rotear usam foraEscopo.
  const recusa = foraEscopo || (s.segmento !== null && !aceito)
  const cidadeFora = cidade !== null && !cidadeOk
  const citaContato = normalizar(s.resposta).includes(normalizar(contato))
  const ufDita = s.uf !== null && s.uf.trim() !== '' ? s.uf.trim().toUpperCase() : null
  const foraUf = ufDita !== null && !cfg.regiao.ufs_atendidas.includes(ufDita)

  if (foraUf && (s.proxima_acao !== 'responder_e_encerrar' || s.qualificado || citaContato)) {
    cruz('fora_uf_exige_encerrar', 'Estado fora da area atendida (RS e SC) exige proxima_acao=responder_e_encerrar, qualificado=false e resposta de uma frase que avisa e nao cita o contato da empresa.')
  }

  // Anti-invencao: cidade da lista (sem sufixo) com uf diferente da lista exige a sigla ou o nome do estado numa fala do lead.
  if (cidade !== null && ufDita !== null) {
    const nc = normalizar(cidade)
    const daLista = cfg.regiao.cidades.find((c) => normalizar(c) === nc)
    const ufLista = daLista !== undefined ? cfg.regiao.ufs[daLista] : undefined
    if (ufLista !== undefined && ufLista.toUpperCase() !== ufDita) {
      const nome = normalizar(NOMES_UF[ufDita] ?? '')
      const sigla = new RegExp(`(^|[^a-z])${ufDita.toLowerCase()}($|[^a-z])`)
      const dito = historico.some((m) => {
        if (m.role !== 'user') return false
        const t = normalizar(m.content)
        return sigla.test(t) || (nome !== '' && t.includes(nome))
      })
      if (!dito) cruz('uf_contradiz_lista', 'uf difere da UF da cidade da lista e o lead nao disse o estado. Use a UF da lista, ou null se nao souber.')
    }
  }

  // Fidelidade ao lead: cidade da lista (sem sufixo) escrita pelo lead com outro estado ("Santa Maria-DF") exige essa UF na saida.
  if (cidade !== null) {
    const nc = normalizar(cidade)
    const daLista = cfg.regiao.cidades.find((c) => normalizar(c) === nc)
    const ufLista = daLista !== undefined ? cfg.regiao.ufs[daLista]?.toUpperCase() : undefined
    if (ufLista !== undefined) {
      const nomes = Object.entries(NOMES_UF).map(([uf, n]) => [normalizar(n), uf] as const).sort((x, y) => y[0].length - x[0].length)
      const alt = [...nomes.map(([n]) => n), '[a-z]{2}'].join('|')
      const re = new RegExp(`${nc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-/,]\\s*(${alt})(?![a-z])`, 'g')
      const escritas = new Set<string>()
      for (const m of historico) {
        if (m.role !== 'user') continue
        for (const x of normalizar(m.content).matchAll(re)) {
          const uf = nomes.find(([n]) => n === x[1])?.[1] ?? x[1]!.toUpperCase()
          if (uf in NOMES_UF && uf !== ufLista) escritas.add(uf)
        }
      }
      const ignorada = [...escritas].find((uf) => uf !== ufDita)
      if (ignorada !== undefined) {
        cruz('uf_do_lead_ignorada', `O lead escreveu o estado ${ignorada} junto da cidade (${cidade}-${ignorada}). Preencha uf com ${ignorada} e siga a regra do estado: fora da area atendida, qualificado=false e responder_e_encerrar.`)
      }
    }
  }

  if (cidadeFora && s.qualificado && !cidadeParecida(cidade, cfg)) {
    cruz('cidade_fora_exige_nao_qualificado', 'Cidade fora da regiao atendida exige qualificado=false.')
  }

  // telefone preenchido tem de ser um unico numero dito pelo lead
  if (telefoneInventado) {
    cruz('telefone_nao_confere', 'telefone deve ser exatamente um numero que o lead informou. Use null se ele nao informou.')
  }

  if (emailInventado) {
    cruz('email_nao_confere', 'email deve ser exatamente o que o lead escreveu numa mensagem. Use null se ele nao informou.')
  }

  // confianca no intervalo
  if (s.confianca < 0 || s.confianca > 1) {
    cruz('confianca_fora_intervalo', `confianca=${s.confianca} fora de [0, 1]. Use um valor entre 0 e 1.`)
  }

  // qualificado = true
  // silencio_ocorrido: sinal explicito do chat (ja houve silencio nesta conversa), nao inferencia sobre o historico. So permite ignorar para lead qualificado; nao forca desvios=3.
  const silencioJaOcorreu = ctx.silencioOcorrido === true
  if (s.qualificado) {
    if (!servido) cruz('qualificado_exige_servico', 'qualificado=true exige tipo_servico atendido pela empresa. Marque qualificado=false.')
    if (!aceito) cruz('qualificado_exige_segmento_aceito', 'qualificado=true exige segmento aceito. Marque qualificado=false.')
    if (!cidadeOk) cruz('qualificado_exige_cidade', 'qualificado=true exige cidade dentro da regiao atendida. Marque qualificado=false.')
    else if (!cidadeDita) cruz('qualificado_exige_cidade_dita', 'qualificado=true exige que o lead tenha dito a cidade. Pergunte a cidade e marque qualificado=false.')
    if (!temTelefone) cruz('qualificado_exige_telefone', 'qualificado=true exige telefone preenchido. Marque qualificado=false e pergunte o telefone.')
    if (s.dados_faltantes.length > 0) cruz('qualificado_exige_sem_faltantes', 'qualificado=true exige dados_faltantes vazio. Ajuste qualificado ou dados_faltantes.')
    if (s.proxima_acao !== 'perguntar' && s.proxima_acao !== 'encaminhar_vendas' && !(s.proxima_acao === 'ignorar' && (silencioJaOcorreu || s.desvios === 2 || s.vagos === 3))) {
      cruz('qualificado_exige_acao', 'qualificado=true exige proxima_acao perguntar ou encaminhar_vendas (ignorar so em silencio: desvios=2, vagos=3 ou silencio ja ocorrido).')
    }
  }

  // dados completos com confianca suficiente exigem qualificado
  if (servido && aceito && cidadeOk && cidadeDita && temTelefone && s.confianca >= limiar && !s.qualificado) {
    cruz('dados_completos_exigem_qualificado', 'Servico, segmento, cidade e telefone estao completos com confianca suficiente: marque qualificado=true.')
  }

  // recusa
  if (recusa) {
    if (s.qualificado) cruz('recusa_exige_nao_qualificado', 'Servico fora do escopo ou segmento nao aceito exige qualificado=false.')
  }
  if (foraEscopo && s.proxima_acao !== 'responder_e_encerrar') {
    cruz('recusa_exige_encerrar', 'Servico fora do escopo exige proxima_acao=responder_e_encerrar.')
  }

  // acoes
  if (s.proxima_acao === 'encaminhar_vendas') {
    if (!s.qualificado && !(ressalvas.length > 0 && temContato)) {
      cruz('vendas_exige_qualificado', 'encaminhar_vendas exige qualificado=true, ou ressalva (segmento nao aceito, cidade fora da regiao ou so e-mail) com telefone ou e-mail do lead. Mude a acao ou qualifique o lead.')
    }
    if (s.confianca < limiar) cruz('confianca_baixa_sem_vendas', `confianca abaixo do limiar (${limiar}) proibe encaminhar_vendas.`)
  }
  if (s.proxima_acao === 'encaminhar_humano' && !temContato) {
    cruz('humano_exige_contato', 'encaminhar_humano exige telefone ou e-mail do lead. Sem contato, use responder_e_encerrar citando o contato da empresa.')
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
  if (s.urgencia === 'alta' && s.ja_cliente === true && s.qualificado && s.desvios === 0 && s.vagos === 0 && s.proxima_acao !== 'encaminhar_vendas') {
    cruz('urgencia_alta_exige_vendas', 'urgencia alta de cliente existente qualificado exige proxima_acao=encaminhar_vendas.')
  }

  // R5: duvida que pergunta nao resolve
  // O cliente controla o historico: conta turnos, nao o '?' que ele escreve.
  const turnosAssistant = historico.filter((m) => m.role === 'assistant').length
  const turnosUser = historico.filter((m) => m.role === 'user').length
  const perguntasFeitas = Math.max(turnosAssistant, turnosUser - 1)
  const tetoAtingido = perguntasFeitas >= cfg.conversa.teto_perguntas
  if (tetoAtingido && s.proxima_acao === 'perguntar') {
    cruz('teto_perguntas_atingido', `O teto de ${cfg.conversa.teto_perguntas} perguntas foi atingido: nao pergunte mais. Encaminhe a um humano (com telefone ou e-mail) ou encerre citando o contato.`)
  }
  const faltaDado = s.dados_faltantes.length > 0 || s.tipo_servico === null || s.segmento === null || s.cidade === null || !temTelefone
  // semDado: nenhum campo de dado preenchido (urgencia e ja_cliente nao contam).
  const semDado = [s.tipo_servico, s.segmento, s.cidade, s.nome, s.telefone, s.email].every((c) => c === null || c.trim() === '')
  // Quando uma regra de silencio governa o turno, o roteamento do teto nao se aplica.
  const limiteGoverna = s.desvios >= 2 || s.vagos === 3 || (s.vagos === 2 && !semDado)
  const precisaRotear = !foraEscopo && !foraUf && !limiteGoverna && tetoAtingido && faltaDado
  if (precisaRotear) {
    const motivo = 'teto de perguntas atingido com dados obrigatorios faltando'
    if (temContato) {
      const vendasOk = s.proxima_acao === 'encaminhar_vendas' && ressalvas.length > 0
      if (s.proxima_acao !== 'encaminhar_humano' && !vendasOk) {
        cruz('duvida_com_telefone_exige_humano', `Motivo: ${motivo}. Com telefone ou e-mail, use proxima_acao=encaminhar_humano (ou encaminhar_vendas se houver ressalva).`)
      }
    } else {
      if (s.proxima_acao !== 'responder_e_encerrar') cruz('duvida_sem_telefone_exige_encerrar', `Motivo: ${motivo}. Sem telefone nem e-mail, use proxima_acao=responder_e_encerrar.`)
      else if (!citaContato) cruz('duvida_sem_telefone_exige_contato', `Motivo: ${motivo}. A resposta deve citar o contato da empresa: ${contato}.`)
    }
  }

  const contadorNoLimite = s.desvios === 3 || s.vagos === 3

  // R5: lead dentro do escopo nunca e dispensado com um simples encerramento.
  if (!foraEscopo && !foraUf && !precisaRotear && s.proxima_acao === 'responder_e_encerrar') {
    if (temContato && s.desvios !== 3) {
      cruz('encerrar_com_telefone_exige_humano', 'Lead dentro do escopo com telefone ou e-mail nao pode ser encerrado: use proxima_acao=encaminhar_vendas ou encaminhar_humano.')
    } else if ((servido || aceito || cidadeOk || contadorNoLimite) && !citaContato) {
      cruz('encerrar_sem_telefone_exige_contato', `Lead dentro do escopo sem telefone: a resposta deve citar o contato da empresa: ${contato}.`)
    }
  }

  // Falas e interacao (spec 006): ignorar, desvios e vagos.
  if (s.desvios > 0 && s.vagos > 0) {
    cruz('contadores_exclusivos', 'desvios e vagos nao podem ser maiores que zero no mesmo turno. Conte so um deles.')
  }
  if (s.proxima_acao === 'ignorar') {
    if (s.resposta.trim() !== '') cruz('ignorar_exige_resposta_vazia', 'proxima_acao=ignorar exige resposta vazia.')
    const abertura = !historico.some((m) => m.role === 'assistant') && s.desvios >= 1 && !s.qualificado && s.telefone === null
    const fimSilencioso = s.desvios === 3 && temTelefone
    const vagoSemDado = s.vagos === 1 && semDado
    const vagoComDado = s.vagos === 2 && !semDado && !s.qualificado
    const vagoNoLimite = s.vagos === 3 && s.qualificado
    if (!abertura && s.desvios !== 2 && !fimSilencioso && !vagoSemDado && !vagoComDado && !vagoNoLimite) {
      cruz('ignorar_fora_do_permitido', 'ignorar so vale em: abertura fora do assunto (sem resposta anterior, desvios>=1, sem telefone); desvios=2; desvios=3 com telefone; vagos=1 sem nenhum dado e sem contato; vagos=2 com dado e nao qualificado; vagos=3 com lead qualificado.')
    }
  } else if (!foraUf && (s.desvios === 1 || (s.vagos === 1 && !semDado) || (s.vagos === 2 && semDado)) && s.proxima_acao !== 'perguntar' && !tetoAtingido) {
    cruz('desvio_exige_pergunta', 'Com desvios=1, vagos=1 (com dado) ou vagos=2 (sem dado), a proxima_acao deve ser perguntar (reconduza o lead com uma pergunta).')
  }
  if (!foraUf && s.desvios === 2 && s.proxima_acao !== 'ignorar') {
    cruz('desvio_exige_silencio', 'desvios=2 exige silencio: use proxima_acao=ignorar com resposta vazia.')
  }
  if (!foraUf && s.vagos === 2 && !semDado) {
    const ok = s.qualificado
      ? s.proxima_acao === 'encaminhar_vendas' && s.resposta.trim() === ''
      : s.proxima_acao === 'ignorar'
    if (!ok) {
      cruz('desvio_exige_silencio', s.qualificado
        ? 'vagos=2 com lead qualificado encerra em silencio: use proxima_acao=encaminhar_vendas com resposta vazia.'
        : 'vagos=2 com dado e lead nao qualificado fica em silencio: use proxima_acao=ignorar com resposta vazia.')
    }
  }
  if (!foraUf && s.desvios === 3) {
    const esperada = !temTelefone
      ? s.proxima_acao === 'responder_e_encerrar'
      : !s.qualificado
        ? s.proxima_acao === 'ignorar'
        : (s.proxima_acao === 'encaminhar_vendas' && s.resposta.trim() === '') || (s.proxima_acao === 'ignorar' && silencioJaOcorreu)
    if (!esperada) {
      const detalhe = !temTelefone
        ? 'desvios=3 sem telefone encerra: use proxima_acao=responder_e_encerrar e cite o contato da empresa na resposta.'
        : !s.qualificado
          ? 'desvios=3 com telefone e lead nao qualificado encerra em silencio: use proxima_acao=ignorar com resposta vazia.'
          : 'desvios=3 com telefone e lead qualificado: a 3a mensagem seguida fora do assunto vai a vendas, uma vez so: use proxima_acao=encaminhar_vendas com resposta vazia. Da 4a em diante use proxima_acao=ignorar com resposta vazia e desvios=3.'
      cruz('limite_exige_encerrar', detalhe)
    }
  }
  if (!foraUf && s.vagos === 3) {
    const esperada = !temContato ? 'responder_e_encerrar' : s.qualificado ? 'ignorar' : 'encaminhar_humano'
    if (s.proxima_acao !== esperada) {
      const detalhe = !temContato
        ? 'vagos=3 sem contato encerra: use proxima_acao=responder_e_encerrar e cite o contato da empresa na resposta.'
        : s.qualificado
          ? 'vagos=3 com lead qualificado ja foi a vendas no turno anterior: use proxima_acao=ignorar com resposta vazia e vagos=3.'
          : 'vagos=3 com contato e lead nao qualificado: use proxima_acao=encaminhar_humano com uma frase de fechamento na resposta.'
      cruz('limite_exige_encerrar', detalhe)
    }
  }

  return { saida: s, violacoes: v, ressalvas }
}
