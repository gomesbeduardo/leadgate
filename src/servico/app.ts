import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from '../config/schema'
import { AlertasStore, criarCanais, criarNotificador } from './alertas'
import { FalhasStore } from './falhas'
import { EstadoSchema, iniciarTurno, montarRequisicao, processarResposta, type Passo } from '../fluxo/turno'

const LIMITE_INTERNO = 1024 * 1024

class ErroHttp extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem)
  }
}

function lerCorpo(req: IncomingMessage, limite: number, statusExcesso: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = []
    let total = 0
    let estourou = false
    req.on('data', (c: Buffer) => {
      if (estourou) return
      total += c.length
      if (total > limite) {
        estourou = true
        reject(new ErroHttp(statusExcesso, `corpo acima de ${limite} bytes`))
        return
      }
      partes.push(c)
    })
    req.on('end', () => {
      if (estourou) return
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8')))
      } catch {
        reject(new ErroHttp(400, 'JSON invalido'))
      }
    })
    req.on('error', () => reject(new ErroHttp(400, 'erro ao ler o corpo')))
  })
}

function responder(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(corpo))
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export type OpcoesChat = {
  chatHtml?: string
  webhookUrl?: string
  painel?: boolean
  /** Limite do corpo de /api/chat, em bytes (padrao 16 KB). */
  limiteCorpo?: number
  /** Requisicoes por minuto por endereco de socket em /api/chat (padrao 20). */
  limitePorMinuto?: number
  /** Turnos simultaneos em /api/chat (padrao 4). */
  /** Folga do abort do proxy sobre ia.timeout_turno_ms (padrao 10 s); so os testes mexem. */
  folgaProxyMs?: number
  maxConcorrentes?: number
  /** Relogio injetavel, em ms. */
  agora?: () => number
  /** Contagem de falhas (R17) e historico de alertas (R18); sem eles, ficam so em memoria. */
  falhas?: FalhasStore
  alertas?: AlertasStore
  /** Variaveis de ambiente dos canais de alerta (ALERTA_CANAL, RESEND_*). */
  env?: Record<string, string | undefined>
  log?: (linha: string) => void
}

type Perfil = 'publico' | 'interno'
const JANELA_MS = 60_000
// O prazo do turno conta a partir de /preparar, depois do inicio da chamada do proxy: o proxy espera a folga a mais
// para nao cortar uma ultima tentativa que o servico ainda ia encerrar sozinho (tem de ficar abaixo do EXECUTIONS_TIMEOUT do n8n).
const FOLGA_PROXY_MS = 10_000

function criar(perfil: Perfil, cfg: Config, modelo: string, opcoes: OpcoesChat): Server {
  const agora = opcoes.agora ?? Date.now
  const limiteCorpo = opcoes.limiteCorpo ?? 16 * 1024
  const limitePorMinuto = opcoes.limitePorMinuto ?? 20
  const maxConcorrentes = opcoes.maxConcorrentes ?? 4
  const acessos = new Map<string, number[]>()
  let emVoo = 0

  // Janela deslizante por endereco do socket; x-forwarded-for e forjavel e nao entra.
  const excedeuTaxa = (ip: string) => {
    const t = agora()
    if (acessos.size > 10_000) for (const [k, v] of acessos) if (v.every((x) => t - x >= JANELA_MS)) acessos.delete(k)
    const recentes = (acessos.get(ip) ?? []).filter((x) => t - x < JANELA_MS)
    if (recentes.length >= limitePorMinuto) {
      acessos.set(ip, recentes)
      return true
    }
    recentes.push(t)
    acessos.set(ip, recentes)
    return false
  }

  const falhas = opcoes.falhas ?? new FalhasStore({ retencaoDias: cfg.lgpd.retencao_dias })
  const alertas = opcoes.alertas ?? new AlertasStore({ retencaoDias: cfg.lgpd.retencao_dias })
  const log = opcoes.log ?? console.log
  const notificador = criarNotificador({
    empresa: cfg.empresa.nome,
    turnosParaQueda: cfg.alerta.turnos_para_queda,
    intervaloMin: cfg.alerta.intervalo_min,
    agora,
    store: alertas,
    canais: criarCanais(opcoes.env ?? {}, log),
    textos: cfg.textos,
    log,
  })
  // Registra so campos de controle (R19): nunca resposta, conversa nem telefone.
  // Gravar em disco e avisar o vendedor sao passos separados: falha de disco nunca bloqueia o alerta.
  const registrar = (turno: Record<string, unknown>, avisar = true) => {
    try {
      falhas.registrarTurno(turno)
    } catch (e) {
      log(`falha ao gravar a contagem de falhas: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!avisar) return
    try {
      notificador.tratar(turno)
    } catch (e) {
      log(`falha ao tratar o alerta: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const falhaChat = { resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'n8n' }

  // O navegador so recebe o necessario; violacoes e conversa nunca saem daqui.
  const publico = (j: Record<string, unknown>) => ({
    resposta: j.resposta,
    proxima_acao: j.proxima_acao,
    origem: j.origem,
    estado: j.estado_conversa ?? j.estado,
    tipo: j.tipo,
    // A avaliacao le estes campos pelo proxy; so com DEMO_PAINEL=1. Conversa nunca sai.
    ...(opcoes.painel ? { saida: j.saida, tentativas: j.tentativas, erro: j.erro, violacoes: j.violacoes } : {}),
  })

  const chat = async (corpo: unknown): Promise<unknown> => {
    if (!ehObjeto(corpo) || !Array.isArray(corpo.historico)) return falhaChat
    if (!opcoes.webhookUrl) {
      registrar(falhaChat)
      return falhaChat
    }
    try {
      const r = await fetch(opcoes.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ historico: corpo.historico }),
        signal: AbortSignal.timeout(cfg.ia.timeout_turno_ms + (opcoes.folgaProxyMs ?? FOLGA_PROXY_MS)),
      })
      if (!r.ok) {
        registrar(falhaChat)
        return falhaChat
      }
      const j: unknown = await r.json()
      if (!ehObjeto(j)) {
        registrar(falhaChat)
        return falhaChat
      }
      // Sem origem conhecida (ex.: {"message":"Workflow was started"}) o turno nao pode sumir.
      if (j.origem !== 'modelo' && j.origem !== 'falha') {
        registrar(falhaChat)
        return falhaChat
      }
      registrar(j)
      return publico(j)
    } catch {
      registrar(falhaChat)
      return falhaChat
    }
  }

  const saida = (p: Passo) =>
    p.fim
      ? { fim: true, resultado: p.resultado }
      : { fim: false, estado: p.estado, esperar_ms: p.esperar_ms, requisicao: montarRequisicao(p.estado, cfg), timeout_ms: cfg.ia.timeout_ms }

  const preparar = (corpo: unknown) => saida(iniciarTurno(corpo, modelo, cfg, agora))

  const validar = (corpo: unknown) => {
    if (!ehObjeto(corpo)) throw new ErroHttp(400, 'estado ausente ou invalido')
    const estado = EstadoSchema.safeParse(corpo.estado)
    if (!estado.success) throw new ErroHttp(400, 'estado ausente ou invalido')
    return saida(processarResposta(estado.data, corpo.resposta, cfg, agora))
  }

  return createServer(async (req, res) => {
    try {
      const rota = (req.url ?? '').split('?')[0]
      if (req.method === 'GET' && rota === '/saude') return responder(res, 200, { ok: true })
      const painelFalhas = perfil === 'interno' || opcoes.painel
      if (painelFalhas) {
        if (req.method === 'GET' && rota === '/falhas') return responder(res, 200, falhas.resumo())
        if (req.method === 'DELETE' && rota === '/falhas') {
          falhas.reset()
          return responder(res, 200, { ok: true })
        }
        if (req.method === 'GET' && rota === '/alertas') return responder(res, 200, alertas.json())
      }
      if (perfil === 'publico') {
        if (req.method === 'GET' && rota === '/' && opcoes.chatHtml !== undefined) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          return res.end(opcoes.chatHtml)
        }
        if (req.method === 'GET' && rota === '/tela.json') {
          const { titulo, cor_primaria, cor_destaque } = cfg.tela
          return responder(res, 200, { titulo, aviso_lgpd: cfg.textos.aviso_lgpd, cor_primaria, cor_destaque })
        }
        if (req.method === 'POST' && rota === '/api/chat') {
          if (excedeuTaxa(req.socket.remoteAddress ?? 'desconhecido')) {
            req.resume()
            return responder(res, 429, { erro: 'muitas requisicoes' })
          }
          if (emVoo >= maxConcorrentes) {
            req.resume()
            // Sobrecarga e turno perdido do lead, mas nao e o n8n fora do ar: tipo proprio, sem alerta de queda.
            registrar({ origem: 'falha', tipo: 'sobrecarga' }, false)
            return responder(res, 503, { erro: 'servico ocupado' })
          }
          emVoo++
          try {
            let corpo: unknown
            try {
              corpo = await lerCorpo(req, limiteCorpo, 413)
            } catch (e) {
              req.resume()
              if (e instanceof ErroHttp && e.status === 413) return responder(res, 413, { erro: e.message })
              return responder(res, 200, falhaChat)
            }
            return responder(res, 200, await chat(corpo))
          } finally {
            emVoo--
          }
        }
      } else if (req.method === 'POST' && (rota === '/preparar' || rota === '/validar')) {
        const corpo = await lerCorpo(req, LIMITE_INTERNO, 400)
        return responder(res, 200, rota === '/preparar' ? preparar(corpo) : validar(corpo))
      }
      req.resume()
      responder(res, 404, { erro: 'rota nao encontrada' })
    } catch (e) {
      if (e instanceof ErroHttp) return responder(res, e.status, { erro: e.message })
      console.error(e)
      responder(res, 400, { erro: 'requisicao invalida' })
    }
  })
}

/** Porta publica (PORT): tela, /tela.json, /saude e /api/chat. */
export const criarServidor = (cfg: Config, modelo: string, opcoes: OpcoesChat = {}): Server => criar('publico', cfg, modelo, opcoes)

/** Porta interna (PORT_INTERNA, so na rede do compose): /preparar, /validar, /falhas, /alertas e /saude. */
export const criarServidorInterno = (cfg: Config, modelo: string, opcoes: Pick<OpcoesChat, 'falhas' | 'alertas'> = {}): Server =>
  criar('interno', cfg, modelo, opcoes)
