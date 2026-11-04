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

export function criarServidor(cfg: Config, modelo: string): Server {
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
