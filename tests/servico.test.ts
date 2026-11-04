import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createServer as createHttpServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { criarServidor, criarServidorInterno } from '../src/servico/app'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const prompt = readFileSync('prompts/agente.md', 'utf8')
let server: Server
let base = ''

beforeAll(async () => {
  server = criarServidorInterno(cfg, prompt)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const post = (rota: string, corpo: unknown) =>
  fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
const corpo = { historico: [{ role: 'user', content: 'Preciso de um PMOC para um prédio comercial em Florianópolis' }] }
const api = (texto = 'isto nao e json') => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] })
const resp = (status: number, texto?: string) => ({ status, corpo: api(texto) })

describe('servico HTTP (porta interna)', () => {
  it('porta interna nao serve o chat', async () => {
    expect((await post('/api/chat', corpo)).status).toBe(404)
    expect((await fetch(base + '/')).status).toBe(404)
    expect((await fetch(base + '/tela.json')).status).toBe(404)
  })

  it('GET /saude', async () => {
    const r = await fetch(base + '/saude')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('/preparar monta a requisicao com o modelo da config', async () => {
    const r = await post('/preparar', corpo)
    expect(r.status).toBe(200)
    const j: any = await r.json()
    expect(j.fim).toBe(false)
    expect(j.requisicao.model).toBe(cfg.ia.modelo)
    expect(j.estado.tentativa).toBe(1)
  })

  it('/preparar com corpo invalido encerra em falha', async () => {
    const j: any = await (await post('/preparar', { x: 1 })).json()
    expect(j.fim).toBe(true)
    expect(j.resultado.origem).toBe('falha')
  })

  it('/preparar devolve timeout_ms e esperar_ms 0', async () => {
    const j: any = await (await post('/preparar', corpo)).json()
    expect(j.timeout_ms).toBe(cfg.ia.timeout_ms)
    expect(j.esperar_ms).toBe(0)
    expect(Object.keys(j.estado).sort()).toEqual(
      ['chamadas', 'correcao', 'historico', 'modelo_atual', 'promptMontado', 'registros', 'tentativa', 'tentativa_http', 'tentativa_modelo'],
    )
  })

  it('/preparar une user,user (T24)', async () => {
    const j: any = await (await post('/preparar', { historico: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] })).json()
    expect(j.fim).toBe(false)
    expect(j.requisicao.messages).toEqual([{ role: 'user', content: 'a\nb' }])
  })

  it('/preparar com entrada invalida devolve silencio sem roteamento', async () => {
    const j: any = await (await post('/preparar', { historico: [{ role: 'assistant', content: 'a' }] })).json()
    expect(j.fim).toBe(true)
    expect(j.resultado.resposta).toBeNull()
  })

  it('503 repete com espera, depois reserva, depois silencio (T12)', async () => {
    let atual: any = await (await post('/preparar', corpo)).json()
    const esperas: number[] = []
    const modelos: string[] = []
    for (let i = 0; i < 6; i++) {
      atual = await (await post('/validar', { estado: atual.estado, resposta: { status: 503 } })).json()
      if (atual.fim) break
      esperas.push(atual.esperar_ms)
      modelos.push(atual.requisicao.model)
    }
    expect(esperas).toEqual([1000, 3000, 0, 1000, 3000])
    expect(modelos.slice(-1)).toEqual([cfg.ia.modelo_reserva])
    expect(atual.fim).toBe(true)
    expect(atual.resultado).toMatchObject({ resposta: null, estado_conversa: 'aguardando_humano', origem: 'falha', tipo: '5xx', camada: 3 })
    expect(atual.resultado.registros).toHaveLength(6)
  })

  it('3 saidas invalidas no primario seguem para a reserva (T11 antigo)', async () => {
    let atual: any = await (await post('/preparar', corpo)).json()
    for (let i = 0; i < 3; i++) {
      atual = await (await post('/validar', { estado: atual.estado, resposta: resp(200) })).json()
      expect(atual.fim).toBe(false)
    }
    expect(atual.requisicao.model).toBe(cfg.ia.modelo_reserva)
  })

  it('erro do n8n como texto e corpo cru da API sao aceitos', async () => {
    const t: any = await (await post('/preparar', corpo)).json()
    const a: any = await (await post('/validar', { estado: t.estado, resposta: { erro: 'getaddrinfo ENOTFOUND x' } })).json()
    expect(a.fim).toBe(false)
    expect(a.estado.registros[0].tipo).toBe('dns')
    const b: any = await (await post('/validar', { estado: t.estado, resposta: api('lixo') })).json()
    expect(b.estado.registros[0].tipo).toBe('schema')
  })

  it('saida valida do modelo encerra com origem modelo', async () => {
    const t: any = await (await post('/preparar', corpo)).json()
    const saida = {
      tipo_servico: null, segmento: null, cidade: null, nome: null, telefone: null, urgencia: null,
      dados_faltantes: ['tipo_servico', 'segmento', 'cidade', 'telefone'],
      qualificado: false, confianca: 0.5, proxima_acao: 'perguntar', resposta: 'Qual servico voce precisa?',
    }
    const r: any = await (await post('/validar', { estado: t.estado, resposta: resp(200, JSON.stringify(saida)) })).json()
    expect(r.fim).toBe(true)
    expect(r.resultado).toMatchObject({ origem: 'modelo', modelo_respondeu: 'primario', camada: 1 })
  })

  it('estado adulterado da 400 e contadores absurdos sao limitados', async () => {
    const t: any = await (await post('/preparar', corpo)).json()
    expect((await post('/validar', { estado: { ...t.estado, historico: [{ role: 'assistant', content: 'x' }] }, resposta: {} })).status).toBe(400)
    expect((await post('/validar', { estado: { ...t.estado, modelo_atual: 'outro' }, resposta: {} })).status).toBe(400)
    const r: any = await (await post('/validar', { estado: { ...t.estado, tentativa_http: 99999 }, resposta: { status: 503 } })).json()
    // 99999 vira 100 (>= tentativas_http): esgota o primario em vez de repetir sem fim.
    expect(r.fim).toBe(false)
    expect(r.estado.modelo_atual).toBe('reserva')
  })

  it('JSON invalido da 400, rota desconhecida 404, e o servidor segue de pe', async () => {
    const ruim = await fetch(base + '/preparar', { method: 'POST', body: '{nao json' })
    expect(ruim.status).toBe(400)
    expect(((await ruim.json()) as any).erro).toBeTruthy()
    expect((await fetch(base + '/nada')).status).toBe(404)
    expect((await post('/validar', { estado: 'lixo', resposta: {} })).status).toBe(400)
    expect((await post('/validar', {})).status).toBe(400)
    expect((await fetch(base + '/saude')).status).toBe(200)
  })

  it('corpo acima de 1 MB da 400', async () => {
    const r = await fetch(base + '/preparar', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(1_100_000) }) })
    expect(r.status).toBe(400)
    expect((await fetch(base + '/saude')).status).toBe(200)
  })
})

describe('chat', () => {
  let web: Server
  let comChat: Server
  let semWebhook: Server
  let comPainel: Server
  let urlPainel = ''
  let urlChat = ''
  let urlSem = ''
  let recebido: any

  const subir = async (s: Server) => {
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
  }

  beforeAll(async () => {
    web = createHttpServer((req, res) => {
      const partes: Buffer[] = []
      req.on('data', (c) => partes.push(c))
      req.on('end', () => {
        recebido = JSON.parse(Buffer.concat(partes).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          resposta: 'ola', origem: 'ia', proxima_acao: 'perguntar', saida: { cidade: 'X' }, tentativas: 2,
          estado_conversa: 'em_andamento', tipo: 'nenhum', registros: [{ tipo: '5xx' }],
          violacoes: [{ regra: 'segredo' }], conversa: [{ role: 'user', content: 'Oi' }],
        }))
      })
    })
    const urlWeb = await subir(web)
    comChat = criarServidor(cfg, prompt, { chatHtml: '<!doctype html><title>x</title>', webhookUrl: urlWeb + '/webhook' })
    urlChat = await subir(comChat)
    semWebhook = criarServidor(cfg, prompt, { webhookUrl: 'http://127.0.0.1:1/webhook' })
    urlSem = await subir(semWebhook)
    comPainel = criarServidor(cfg, prompt, { webhookUrl: urlWeb + '/webhook', painel: true })
    urlPainel = await subir(comPainel)
  })
  afterAll(async () => {
    for (const s of [web, comChat, semWebhook, comPainel]) await new Promise<void>((r) => s.close(() => r()))
  })

  it('T23: /tela.json traz o aviso LGPD com "automatizado" e "provedor de IA"', async () => {
    const j: any = await (await fetch(urlChat + '/tela.json')).json()
    expect(j.aviso_lgpd).toBe(cfg.textos.aviso_lgpd)
    expect(j.aviso_lgpd).toContain('automatizado')
    expect(j.aviso_lgpd).toContain('provedor de IA')
  })

  it('/tela.json expoe exatamente 4 chaves', async () => {
    const j: any = await (await fetch(urlChat + '/tela.json')).json()
    expect(Object.keys(j).sort()).toEqual(['aviso_lgpd', 'cor_destaque', 'cor_primaria', 'titulo'])
  })

  it('POST /api/chat repassa o historico e devolve o JSON do webhook', async () => {
    const h = [{ role: 'user', content: 'Oi' }]
    const r = await fetch(urlChat + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: h }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ resposta: 'ola', origem: 'ia', proxima_acao: 'perguntar', estado: 'em_andamento', tipo: 'nenhum' })
    expect(recebido).toEqual({ historico: h })
  })

  it('com painel liga, /api/chat inclui saida e tentativas, nunca violacoes nem conversa', async () => {
    const h = [{ role: 'user', content: 'Oi' }]
    const r = await fetch(urlPainel + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: h }) })
    expect(await r.json()).toEqual({
      resposta: 'ola', origem: 'ia', proxima_acao: 'perguntar', estado: 'em_andamento', tipo: 'nenhum', saida: { cidade: 'X' }, tentativas: 2,
    })
  })

  it('webhook fora do ar devolve 200 com silencio e aguardando_humano', async () => {
    const r = await fetch(urlSem + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: [] }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'n8n',
    })
  })

  it('T24: n8n com status nao 200, corpo nao JSON ou timeout devolve 200 em silencio', async () => {
    const silencio = { resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'n8n' }
    const falsos: Array<[string, (res: import('node:http').ServerResponse) => void]> = [
      ['500', (res) => { res.writeHead(500).end('{"resposta":"vaza"}') }],
      ['nao json', (res) => { res.writeHead(200).end('<html>') }],
      ['lento', () => {}],
    ]
    for (const [nome, h] of falsos) {
      const fake = createHttpServer((req, res) => { req.resume(); req.on('end', () => h(res)) })
      const urlFake = await subir(fake)
      const cfgRapido = { ...cfg, ia: { ...cfg.ia, timeout_turno_ms: 300 } }
      const s = criarServidor(cfgRapido, prompt, { webhookUrl: urlFake })
      const url = await subir(s)
      try {
        const r = await fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: [] }) })
        expect(r.status, nome).toBe(200)
        expect(await r.json(), nome).toEqual(silencio)
      } finally {
        fake.closeAllConnections()
        await new Promise<void>((r) => s.close(() => r()))
        await new Promise<void>((r) => fake.close(() => r()))
      }
    }
  })

  it('timeout do proxy vem de ia.timeout_turno_ms (180000 na config)', () => {
    expect(cfg.ia.timeout_turno_ms).toBe(180000)
  })

  it('GET / serve o HTML quando fornecido e 404 quando nao', async () => {
    const r = await fetch(urlChat + '/')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('<title>x</title>')
    expect((await fetch(urlSem + '/')).status).toBe(404)
  })
})

describe('rotas internas fora da porta publica', () => {
  it('POST /preparar e /validar na porta publica dao 404 e nao vazam o prompt', async () => {
    const pub = criarServidor(cfg, prompt, { webhookUrl: 'http://127.0.0.1:1/webhook' })
    await new Promise<void>((r) => pub.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(pub.address() as AddressInfo).port}`
    try {
      for (const rota of ['/preparar', '/validar']) {
        const r = await fetch(url + rota, { method: 'POST', body: JSON.stringify(corpo) })
        expect(r.status).toBe(404)
        expect(await r.text()).not.toContain('CFG-7Q2M')
      }
      expect((await fetch(url + '/saude')).status).toBe(200)
    } finally {
      await new Promise<void>((r) => pub.close(() => r()))
    }
  })
})

describe('limites publicas em /api/chat', () => {
  let web: Server
  let urlWeb = ''
  let soltar: (() => void)[] = []
  const subir = async (s: Server) => {
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
  }
  const h = { historico: [{ role: 'user', content: 'Oi' }] }
  const chat = (url: string, c: unknown = h) => fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify(c) })

  beforeAll(async () => {
    web = createHttpServer((req, res) => {
      req.resume()
      const responder = () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ resposta: 'ola', origem: 'ia', proxima_acao: 'perguntar' }))
      }
      responder()
    })
    urlWeb = await subir(web)
  })
  afterAll(() => new Promise<void>((r) => web.close(() => r())))

  it('corpo acima de 16 KB da 413', async () => {
    const s = criarServidor(cfg, prompt, { webhookUrl: urlWeb })
    const url = await subir(s)
    try {
      const r = await chat(url, { historico: [{ role: 'user', content: 'x'.repeat(17_000) }] })
      expect(r.status).toBe(413)
      expect((await chat(url)).status).toBe(200)
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('21a requisicao do mesmo IP no minuto da 429 e a janela reabre com o relogio', async () => {
    let agora = 1_000_000
    const s = criarServidor(cfg, prompt, { webhookUrl: urlWeb, agora: () => agora })
    const url = await subir(s)
    try {
      for (let i = 0; i < 20; i++) expect((await chat(url)).status).toBe(200)
      expect((await chat(url)).status).toBe(429)
      // x-forwarded-for nao muda a conta: a chave e o endereco do socket.
      const falso = await fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify(h), headers: { 'x-forwarded-for': '9.9.9.9' } })
      expect(falso.status).toBe(429)
      agora += 60_001
      expect((await chat(url)).status).toBe(200)
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('limite por minuto configuravel', async () => {
    const s = criarServidor(cfg, prompt, { webhookUrl: urlWeb, limitePorMinuto: 2 })
    const url = await subir(s)
    try {
      expect((await chat(url)).status).toBe(200)
      expect((await chat(url)).status).toBe(200)
      expect((await chat(url)).status).toBe(429)
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('5o turno simultaneo da 503 e libera quando um termina', async () => {
    const lento = createHttpServer((req, res) => {
      req.resume()
      soltar.push(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ resposta: 'ola', origem: 'ia', proxima_acao: 'perguntar' }))
      })
    })
    const urlLento = await subir(lento)
    const s = criarServidor(cfg, prompt, { webhookUrl: urlLento, limitePorMinuto: 100 })
    const url = await subir(s)
    soltar = []
    try {
      const em_voo = [1, 2, 3, 4].map(() => chat(url))
      while (soltar.length < 4) await new Promise((r) => setTimeout(r, 10))
      expect((await chat(url)).status).toBe(503)
      soltar.forEach((f) => f())
      expect((await Promise.all(em_voo)).map((r) => r.status)).toEqual([200, 200, 200, 200])
      const quinto = chat(url)
      while (soltar.length < 5) await new Promise((r) => setTimeout(r, 10))
      soltar[4]?.()
      expect((await quinto).status).toBe(200)
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
      await new Promise<void>((r) => lento.close(() => r()))
    }
  })
})
