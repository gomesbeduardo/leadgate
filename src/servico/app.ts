import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from '../config/schema'
import { falhaDeApi, iniciarTurno, montarRequisicao, processarResposta, type Estado, type Passo } from '../fluxo/turno'

const LIMITE = 1024 * 1024

class ErroHttp extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem)
  }
}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = []
    let total = 0
    let estourou = false
    req.on('data', (c: Buffer) => {
      if (estourou) return
      total += c.length
      if (total > LIMITE) {
        estourou = true
        reject(new ErroHttp(400, 'corpo acima de 1 MB'))
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

export type OpcoesChat = { chatHtml?: string; webhookUrl?: string }

const TIMEOUT_WEBHOOK_MS = 60_000

export function criarServidor(cfg: Config, modelo: string, opcoes: OpcoesChat = {}): Server {
  const falhaChat = { resposta: cfg.textos.falha_tecnica, origem: 'falha' }

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
      return ehObjeto(j) ? j : falhaChat
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
      if (req.method === 'GET' && rota === '/' && opcoes.chatHtml !== undefined) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(opcoes.chatHtml)
      }
      if (req.method === 'GET' && rota === '/tela.json') {
        const { titulo, cor_primaria, cor_destaque } = cfg.tela
        return responder(res, 200, { titulo, aviso_lgpd: cfg.textos.aviso_lgpd, cor_primaria, cor_destaque })
      }
      if (req.method === 'POST' && rota === '/api/chat') {
        let corpo: unknown
        try {
          corpo = await lerCorpo(req)
        } catch {
          return responder(res, 200, falhaChat)
        }
        return responder(res, 200, await chat(corpo))
      }
      if (req.method === 'POST' && (rota === '/preparar' || rota === '/validar')) {
        const corpo = await lerCorpo(req)
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
