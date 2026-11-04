import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from '../config/schema'
import { falhaDeApi, iniciarTurno, montarRequisicao, processarResposta, type Estado, type Passo } from '../fluxo/turno'

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
  maxConcorrentes?: number
  /** Relogio injetavel, em ms. */
  agora?: () => number
}

type Perfil = 'publico' | 'interno'
const JANELA_MS = 60_000

const TIMEOUT_WEBHOOK_MS = 60_000

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

  const falhaChat = { resposta: cfg.textos.falha_tecnica, origem: 'falha' }

  // O navegador so recebe o necessario; violacoes e conversa nunca saem daqui.
  const publico = (j: Record<string, unknown>) => ({
    resposta: j.resposta,
    proxima_acao: j.proxima_acao,
    origem: j.origem,
    ...(opcoes.painel ? { saida: j.saida, tentativas: j.tentativas } : {}),
  })

  const chat = async (corpo: unknown): Promise<unknown> => {
    if (!opcoes.webhookUrl || !ehObjeto(corpo) || !Array.isArray(corpo.historico)) return falhaChat
    try {
      const r = await fetch(opcoes.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ historico: corpo.historico }),
        signal: AbortSignal.timeout(TIMEOUT_WEBHOOK_MS),
      })
      if (!r.ok) return falhaChat
      const j: unknown = await r.json()
      return ehObjeto(j) ? publico(j) : falhaChat
    } catch {
      return falhaChat
    }
  }

  const saida = (p: Passo) =>
    p.fim ? { fim: true, resultado: p.resultado } : { fim: false, estado: p.estado, requisicao: montarRequisicao(p.estado, cfg) }

  const preparar = (corpo: unknown) => saida(iniciarTurno(corpo, modelo, cfg))

  const validar = (corpo: unknown) => {
    if (!ehObjeto(corpo) || !ehObjeto(corpo.tentativa) || !ehObjeto(corpo.tentativa.estado)) {
      throw new ErroHttp(400, 'tentativa.estado ausente ou invalido')
    }
    const estado = corpo.tentativa.estado as unknown as Estado
    const h = ehObjeto(corpo.http) ? corpo.http : {}
    const ok = typeof h.statusCode === 'number' && h.statusCode >= 200 && h.statusCode < 300
    if (!ok) return { fim: true, resultado: falhaDeApi(estado, cfg) }
    return saida(processarResposta(estado, h.body, cfg))
  }

  return createServer(async (req, res) => {
    try {
      const rota = (req.url ?? '').split('?')[0]
      if (req.method === 'GET' && rota === '/saude') return responder(res, 200, { ok: true })
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

/** Porta interna (PORT_INTERNA, so na rede do compose): /preparar, /validar e /saude. */
export const criarServidorInterno = (cfg: Config, modelo: string): Server => criar('interno', cfg, modelo, {})
