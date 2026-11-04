import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createServer as createHttpServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { AlertasStore } from '../src/servico/alertas'
import { criarServidor, criarServidorInterno } from '../src/servico/app'
import { FalhasStore } from '../src/servico/falhas'

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
      ['chamadas', 'correcao', 'historico', 'historico_bruto', 'inicio_ms', 'modelo_atual', 'promptMontado', 'registros', 'tentativa', 'tentativa_http', 'tentativa_modelo'],
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
      qualificado: false, confianca: 0.5, desvios: 0, vagos: 0, proxima_acao: 'perguntar', resposta: 'Qual servico voce precisa?',
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
          resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar', saida: { cidade: 'X' }, tentativas: 2,
          estado_conversa: 'em_andamento', tipo: 'nenhum', registros: [{ tipo: '5xx' }], erro: false,
          violacoes: [{ regra: 'segredo' }], conversa: [{ role: 'user', content: 'Oi' }],
        }))
      })
    })
    const urlWeb = await subir(web)
    comChat = criarServidor(cfg, prompt, { chatHtml: '<!doctype html><title>x</title>', lpHtml: '<!doctype html><title>lp</title><a href="/conversa">Entrar em contato</a>', logoSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>', webhookUrl: urlWeb + '/webhook' })
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
    expect(await r.json()).toEqual({ resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar', estado: 'em_andamento', tipo: 'nenhum' })
    expect(recebido).toEqual({ historico: h })
  })

  it('com painel ligado, /api/chat inclui tudo que a avaliacao le (saida, tentativas, erro, violacoes), nunca conversa', async () => {
    const h = [{ role: 'user', content: 'Oi' }]
    const r = await fetch(urlPainel + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: h }) })
    expect(await r.json()).toEqual({
      resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar', estado: 'em_andamento', tipo: 'nenhum', saida: { cidade: 'X' }, tentativas: 2,
      erro: false, violacoes: [{ regra: 'segredo' }],
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
      const s = criarServidor(cfgRapido, prompt, { webhookUrl: urlFake, folgaProxyMs: 0 })
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

  it('o proxy aborta so depois do prazo do turno: ia.timeout_turno_ms + 10000', async () => {
    // webhook responde depois de timeout_turno_ms (300) mas antes do abort do proxy (10300)
    const fake = createHttpServer((req, res) => {
      req.resume()
      req.on('end', () => setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar' }))
      }, 450))
    })
    const urlFake = await subir(fake)
    const s = criarServidor({ ...cfg, ia: { ...cfg.ia, timeout_turno_ms: 300 } }, prompt, { webhookUrl: urlFake })
    const url = await subir(s)
    try {
      const r = await fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: [] }) })
      expect(await r.json()).toMatchObject({ resposta: 'ola', origem: 'modelo' })
    } finally {
      fake.closeAllConnections()
      await new Promise<void>((r) => s.close(() => r()))
      await new Promise<void>((r) => fake.close(() => r()))
    }
  })

  it('config: ia.timeout_turno_ms e 180000', () => {
    expect(cfg.ia.timeout_turno_ms).toBe(180000)
  })

  it('T1: GET / serve a LP com link para /conversa', async () => {
    const r = await fetch(urlChat + '/')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    const t = await r.text()
    expect(t).toContain('<title>lp</title>')
    expect(t).toContain('href="/conversa"')
  })

  it('T2: GET /conversa serve o chat', async () => {
    const r = await fetch(urlChat + '/conversa')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('<title>x</title>')
  })

  it('T3: GET / sem LP configurada da 404', async () => {
    expect((await fetch(urlSem + '/')).status).toBe(404)
  })

  it('T4: GET /conversa sem chat configurado da 404', async () => {
    expect((await fetch(urlSem + '/conversa')).status).toBe(404)
  })

  it('GET /logo.svg serve o logo quando fornecido e 404 quando nao', async () => {
    const r = await fetch(urlChat + '/logo.svg')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('image/svg+xml')
    expect((await fetch(urlSem + '/logo.svg')).status).toBe(404)
  })

  it('T6: a LP real tem ao menos dois links para /conversa (topo e fim)', () => {
    const html = readFileSync('chat/lp.html', 'utf8')
    expect(html.split('href="/conversa"').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('T7: lp.html usa anel de foco claro nos botoes de secoes escuras', () => {
    const html = readFileSync('chat/lp.html', 'utf8')
    expect(html).toMatch(/--foco-claro:\s*#/)
    expect(html).toMatch(/\.btn\.claro:focus-visible\s*\{[^}]*var\(--foco-claro\)/)
  })

  it('T8: chat/index.html sem link voltar, titulo vindo da tela, form[hidden] e aviso pre-wrap', () => {
    const html = readFileSync('chat/index.html', 'utf8')
    expect(html).not.toContain('class="voltar"')
    expect(html).not.toContain('href="/"')
    expect(html).toContain('document.title = tela.titulo')
    expect(html).toMatch(/form\[hidden\]\s*\{\s*display:\s*none/)
    expect(html).toMatch(/\.msg\.aviso\s*\{[^}]*white-space:\s*pre-wrap/)
  })

  it('T13: abertura silenciada sai do historico enviado so se ignorar e sem assistant; meio da conversa fica', () => {
    const html = readFileSync('chat/index.html', 'utf8')
    expect(html).toMatch(/!resposta && acao === 'ignorar' && !historico\.slice\(0, -1\)\.some\(function \(m\) \{ return m\.role === 'assistant'; \}\)\) historico\.pop\(\)/)
    expect(html.match(/historico\.pop\(\)/g)).toHaveLength(1)
  })

  it('T5: chat/index.html nao cita WhatsApp e traz aviso_lgpd', () => {
    const html = readFileSync('chat/index.html', 'utf8')
    expect(/whatsapp/i.test(html)).toBe(false)
    expect(html).toContain('aviso_lgpd')
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
        res.end(JSON.stringify({ resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar' }))
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

  it('503 de concorrencia registra o tipo sobrecarga (nao servico) e nao dispara alerta', async () => {
    const lento = createHttpServer((req, res) => {
      req.resume()
      soltar.push(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar' }))
      })
    })
    const urlLento = await subir(lento)
    const falhas = new FalhasStore({ retencaoDias: 30 })
    const alertas = new AlertasStore({ retencaoDias: 30 })
    const s = criarServidor(cfg, prompt, { webhookUrl: urlLento, limitePorMinuto: 100, falhas, alertas, log: () => {} })
    const url = await subir(s)
    soltar = []
    try {
      const em_voo = [1, 2, 3, 4].map(() => chat(url))
      while (soltar.length < 4) await new Promise((r) => setTimeout(r, 10))
      expect((await chat(url)).status).toBe(503)
      expect(falhas.resumo().tentativas_falhas_por_tipo).toEqual({ sobrecarga: 1 })
      expect(alertas.json().eventos).toHaveLength(0)
      soltar.forEach((f) => f())
      await Promise.all(em_voo)
    } finally {
      for (const f of soltar) try { f() } catch { /* ja respondido */ }
      await new Promise<void>((r) => s.close(() => r()))
      await new Promise<void>((r) => lento.close(() => r()))
    }
  })

  it('5o turno simultaneo da 503 e libera quando um termina', async () => {
    const lento = createHttpServer((req, res) => {
      req.resume()
      soltar.push(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar' }))
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

describe('falhas e alertas nas rotas', () => {
  const abertos: Server[] = []
  const subir = async (s: Server) => {
    abertos.push(s)
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
  }
  afterAll(async () => {
    for (const s of abertos) {
      s.closeAllConnections?.()
      await new Promise<void>((r) => s.close(() => r()))
    }
  })
  const lojas = () => {
    const falhas = new FalhasStore({ retencaoDias: 30 })
    const alertas = new AlertasStore({ retencaoDias: 30 })
    return { falhas, alertas }
  }
  const webhook = async (corpo: unknown) =>
    subir(createHttpServer((req, res) => { req.resume(); req.on('end', () => res.writeHead(200).end(JSON.stringify(corpo))) }))
  const chatar = (url: string) => fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: [{ role: 'user', content: 'Oi 99999' }] }) })

  it('o proxy registra o resultado do workflow e /falhas (interno) devolve o resumo', async () => {
    const { falhas, alertas } = lojas()
    const wh = await webhook({
      resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar', estado_conversa: 'em_andamento', tipo: 'nenhum',
      modelo_respondeu: 'primario', camada: 1, registros: [{ ts: '2026-11-04T10:00:00Z', tipo: '429', modelo: cfg.ia.modelo, tentativa: 1, camada: 1 }],
    })
    const pub = await subir(criarServidor(cfg, prompt, { webhookUrl: wh + '/w', falhas, alertas }))
    const int = await subir(criarServidorInterno(cfg, prompt, { falhas, alertas }))
    await chatar(pub)
    const j: any = await (await fetch(int + '/falhas')).json()
    expect(j.turnos_totais).toBe(1)
    expect(j.taxa_falha).toBe('0,0 %')
    expect(j.tentativas_falhas_por_tipo['429']).toBe(1)
    expect(j.recuperados_por_camada['1']).toBe(1)
    expect(j.modelo_respondeu).toEqual({ primario: 1, reserva: 0 })
    expect(JSON.stringify(falhas.tentativas())).not.toContain('99999')
    expect((await fetch(int + '/falhas', { method: 'DELETE' })).status).toBe(200)
    expect(((await (await fetch(int + '/falhas')).json()) as any).turnos_totais).toBe(0)
    expect(((await (await fetch(int + '/alertas')).json()) as any)).toEqual({ eventos: [], alerta_nao_entregue: 0 })
  })

  it('n8n fora do ar registra tipo n8n e abre a queda em /alertas', async () => {
    const { falhas, alertas } = lojas()
    const pub = await subir(criarServidor(cfg, prompt, { webhookUrl: 'http://127.0.0.1:1/w', falhas, alertas }))
    await chatar(pub)
    expect(falhas.resumo().tentativas_falhas_por_tipo).toEqual({ n8n: 1 })
    expect(alertas.json().eventos[0]).toMatchObject({ tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 1 })
  })

  it('entrada invalida (falha sem tipo) nao conta como falha nem queda', async () => {
    const { falhas, alertas } = lojas()
    const wh = await webhook({ resposta: null, origem: 'falha', tipo: null, estado_conversa: 'aguardando_humano', proxima_acao: 'encaminhar_humano' })
    const pub = await subir(criarServidor(cfg, prompt, { webhookUrl: wh + '/w', falhas, alertas }))
    await chatar(pub)
    await chatar(pub)
    expect(falhas.resumo().turnos_falha).toBe(0)
    expect(alertas.json().eventos).toEqual([])
  })

  it('T3: tres silencios deliberados seguidos nao abrem alerta de queda', async () => {
    const { falhas, alertas } = lojas()
    const wh = await webhook({ resposta: null, origem: 'modelo', proxima_acao: 'ignorar', estado_conversa: null, tipo: null })
    const pub = await subir(criarServidor(cfg, prompt, { webhookUrl: wh + '/w', falhas, alertas }))
    for (let i = 0; i < 3; i++) {
      const j: any = await (await chatar(pub)).json()
      expect(j).toMatchObject({ resposta: null, proxima_acao: 'ignorar', origem: 'modelo' })
      expect(j.estado).not.toBe('aguardando_humano')
    }
    expect(alertas.json().eventos).toEqual([])
    expect(falhas.resumo().turnos_falha).toBe(0)
  })

  it('porta publica sem DEMO_PAINEL: /falhas e /alertas dao 404', async () => {
    const { falhas, alertas } = lojas()
    const pub = await subir(criarServidor(cfg, prompt, { falhas, alertas }))
    expect((await fetch(pub + '/falhas')).status).toBe(404)
    expect((await fetch(pub + '/alertas')).status).toBe(404)
    expect((await fetch(pub + '/falhas', { method: 'DELETE' })).status).toBe(404)
  })

  it('porta publica com DEMO_PAINEL=1: GET /falhas, GET /alertas e DELETE /falhas', async () => {
    const { falhas, alertas } = lojas()
    falhas.registrarTurno({ origem: 'falha', tipo: 'n8n' })
    const pub = await subir(criarServidor(cfg, prompt, { falhas, alertas, painel: true }))
    expect(((await (await fetch(pub + '/falhas')).json()) as any).turnos_falha).toBe(1)
    expect((await fetch(pub + '/alertas')).status).toBe(200)
    expect((await fetch(pub + '/falhas', { method: 'DELETE' })).status).toBe(200)
    expect(falhas.resumo().turnos_totais).toBe(0)
  })

  it('porta interna nao aceita POST em /falhas', async () => {
    const int = await subir(criarServidorInterno(cfg, prompt, lojas()))
    expect((await fetch(int + '/falhas', { method: 'POST', body: '{}' })).status).toBe(404)
  })

  it('T20/T21: resend recebe o POST na queda; receptor 500 vira alerta_nao_entregue e o turno e igual', async () => {
    for (const status of [200, 500]) {
      const recebidos: any[] = []
      const rec = await subir(createHttpServer((req, res) => {
        const p: Buffer[] = []
        req.on('data', (c) => p.push(c))
        req.on('end', () => { recebidos.push({ url: req.url, auth: req.headers.authorization, corpo: JSON.parse(Buffer.concat(p).toString()) }); res.writeHead(status).end('{}') })
      }))
      const { falhas, alertas } = lojas()
      const env = { ALERTA_CANAL: 'resend', RESEND_API_KEY: 'k', RESEND_BASE_URL: rec, ALERTA_EMAIL_DE: 'a@x.com', ALERTA_EMAIL_PARA: 'b@x.com' }
      const pub = await subir(criarServidor(cfg, prompt, { webhookUrl: 'http://127.0.0.1:1/w', falhas, alertas, env, log: () => {} }))
      const r = await chatar(pub)
      expect(await r.json()).toEqual({ resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'n8n' })
      await vi.waitFor(() => expect(recebidos).toHaveLength(1))
      expect(recebidos[0].url).toBe('/emails')
      expect(recebidos[0].corpo.text).toContain('CentralEng')
      expect(recebidos[0].corpo.text).toContain('Os leads estão sem resposta.')
      if (status === 500) await vi.waitFor(() => expect(alertas.json().alerta_nao_entregue).toBe(1))
      else expect(alertas.json().alerta_nao_entregue).toBe(0)
    }
  })
})
