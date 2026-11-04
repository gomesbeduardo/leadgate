// Achados da revisao da spec 002: um bloco por achado.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { falhasMarkdown, blocoFalhas } from '../src/avaliacao/metricas.mjs'
import { iniciarTurno, processarResposta, type Estado, type Passo } from '../src/fluxo/turno'
import { AlertasStore, criarCanais, criarNotificador } from '../src/servico/alertas'
import { criarServidor } from '../src/servico/app'
import { FalhasStore } from '../src/servico/falhas'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const prompt = readFileSync('prompts/agente.md', 'utf8')
const t = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00.000Z`)

const abertos: Server[] = []
const subir = async (s: Server) => {
  abertos.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}
afterEach(async () => {
  for (const s of abertos.splice(0)) {
    s.closeAllConnections?.()
    await new Promise<void>((r) => s.close(() => r()))
  }
})
const webhook = (corpo: unknown) =>
  subir(createHttpServer((req, res) => { req.resume(); req.on('end', () => res.writeHead(200).end(JSON.stringify(corpo))) }))
const chatar = (url: string) =>
  fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: [{ role: 'user', content: 'Oi' }] }) })

describe('achado 1: taxa de falha medida pelo proxy', () => {
  it('avaliar.mjs usa o proxy /api/chat como padrao', () => {
    expect(readFileSync('scripts/avaliar.mjs', 'utf8')).toContain("'http://127.0.0.1:8080/api/chat'")
  })

  it('compose repassa LIMITE_POR_MINUTO com padrao 20', () => {
    expect(readFileSync('docker-compose.yml', 'utf8')).toContain('LIMITE_POR_MINUTO: ${LIMITE_POR_MINUTO:-20}')
  })

  it('README documenta o comando da avaliacao', () => {
    expect(readFileSync('README.md', 'utf8')).toContain('DEMO_PAINEL=1 LIMITE_POR_MINUTO=600 docker compose up')
  })

  it('README aponta para o guia de autonomia no fim da secao da esteira', () => {
    const readme = readFileSync('README.md', 'utf8')
    const secao = readme.slice(readme.indexOf('## A esteira de desenvolvimento'))
    expect(secao).toContain('docs/esteira/autonomia.md')
  })

  it('turnos = 0 imprime "nao medida", nunca 0,0 %', () => {
    const vazio = falhasMarkdown('ajuste', { turnos_totais: 0, turnos_falha: 0, taxa_falha: '0,0 %', tentativas_falhas_por_tipo: {} })
    expect(vazio).toContain('não medida')
    expect(vazio).not.toContain('0,0 %')
    const cheio = falhasMarkdown('ajuste', { turnos_totais: 20, turnos_falha: 1, taxa_falha: '5,0 %', tentativas_falhas_por_tipo: {} })
    expect(cheio).toContain('taxa_falha = 1/20 = 5,0 %')
  })

  it('o bloco da tabela lista cada falhas-<conjunto>.md encontrado', () => {
    const ajuste = falhasMarkdown('ajuste', { turnos_totais: 20, turnos_falha: 1, taxa_falha: '5,0 %', tentativas_falhas_por_tipo: {} })
    const reservado = falhasMarkdown('reservado', { turnos_totais: 0, turnos_falha: 0, taxa_falha: '0,0 %', tentativas_falhas_por_tipo: {} })
    const bloco = blocoFalhas([{ conjunto: 'ajuste', md: ajuste }, { conjunto: 'reservado', md: reservado }])
    expect(bloco).toContain('falhas-ajuste.md')
    expect(bloco).toContain('falhas-reservado.md')
    expect(bloco).toContain('5,0 %')
    expect(bloco).toContain('não medida')
    expect(bloco).not.toContain('0,0 %')
    expect(blocoFalhas([])).toContain('não medida')
  })

  it('avaliar.mjs grava falhas-<conjunto>.md, nao falhas.md', async () => {
    const script = fileURLToPath(new URL('../scripts/avaliar.mjs', import.meta.url))
    const saida = mkdtempSync(join(tmpdir(), 'aval-f-'))
    const srv = createHttpServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        if (req.url === '/falhas') {
          return res.end(JSON.stringify({ turnos_totais: 9, turnos_falha: 0, taxa_falha: '0,0 %', tentativas_falhas_por_tipo: {}, recuperados_por_camada: { '1': 0, '2': 0 }, modelo_respondeu: { primario: 9, reserva: 0 }, entradas_invalidas: 0 }))
        }
        res.end(JSON.stringify({ resposta: 'ok', origem: 'modelo', proxima_acao: 'responder_e_encerrar', tentativas: 1, saida: { cidade: 'X', confianca: 0.9 } }))
      })
    })
    const base = await subir(srv)
    const env = { ...process.env, DEMO_PAINEL: '1', AVALIACAO_URL: base + '/api/chat', AVALIACAO_FALHAS_URL: base + '/falhas', AVALIACAO_SAIDA_DIR: saida, AVALIACAO_ESPERA_MS: '1500' }
    const code = await new Promise<number>((resolve) =>
      execFile('node', [script, '--conjunto', 'regressao'], { env }, (e) => resolve(e ? ((e as any).code ?? 1) : 0)))
    expect(code).toBe(0)
    expect(existsSync(join(saida, 'falhas-regressao.md'))).toBe(true)
    expect(existsSync(join(saida, 'falhas.md'))).toBe(false)
    expect(readFileSync(join(saida, 'falhas-regressao.md'), 'utf8')).toContain('turnos = 9')
  }, 30_000)

  it('painel desligado: resposta publica igual a de hoje; ligado: traz erro e violacoes', async () => {
    const w = await webhook({
      resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar', saida: { cidade: 'X' }, tentativas: 2, erro: false,
      estado_conversa: 'em_andamento', tipo: null, violacoes: [{ regra: 'segredo' }], conversa: [{ role: 'user', content: 'Oi' }],
    })
    const sem = await subir(criarServidor(cfg, prompt, { webhookUrl: w }))
    const com = await subir(criarServidor(cfg, prompt, { webhookUrl: w, painel: true }))
    const a: any = await (await chatar(sem)).json()
    const b: any = await (await chatar(com)).json()
    expect(Object.keys(a).sort()).toEqual(['estado', 'origem', 'proxima_acao', 'resposta', 'tipo'])
    expect(b.erro).toBe(false)
    expect(b.violacoes).toEqual([{ regra: 'segredo' }])
    expect(b.conversa).toBeUndefined()
  })
})

describe('achado 2: orcamento do turno', () => {
  it('seis tentativas mais as esperas cabem em ia.timeout_turno_ms', () => {
    const { tentativas_http: n, espera_ms: esperas, timeout_ms, timeout_turno_ms } = cfg.ia
    const esperasPorModelo = esperas.slice(0, n - 1).reduce((a, b) => a + b, 0)
    const pior = 2 * n * timeout_ms + 2 * esperasPorModelo
    expect(2 * n).toBe(6)
    expect(pior).toBeLessThan(timeout_turno_ms)
    expect(timeout_ms).toBe(25000)
  })

  it('o timeout do n8n no compose fica acima do orcamento do turno', () => {
    const m = /EXECUTIONS_TIMEOUT: "(\d+)"/.exec(readFileSync('docker-compose.yml', 'utf8'))
    // o proxy aborta em timeout_turno_ms + 10 s; o n8n so corta depois disso
    expect(Number(m![1]) * 1000).toBeGreaterThan(cfg.ia.timeout_turno_ms + 10_000)
  })

  const historico = [{ role: 'user' as const, content: 'Oi, preciso de um orcamento' }]
  const inicio = (agora: () => number): Estado => {
    const p: Passo = iniciarTurno({ historico }, prompt, cfg, agora)
    if (p.fim) throw new Error('inesperado')
    return p.estado
  }

  it('iniciarTurno grava inicio_ms com o relogio injetado', () => {
    expect(inicio(() => 1234).inicio_ms).toBe(1234)
  })

  it('prazo estourado encerra em silencio camada 3 com o tipo da ultima falha (timeout, nao n8n)', () => {
    const estado = inicio(() => 0)
    // sobra menos que um timeout_ms para o proxy abortar em timeout_turno_ms
    const agora = () => cfg.ia.timeout_turno_ms - cfg.ia.timeout_ms + 1
    const p = processarResposta(estado, { erro: 'timeout' }, cfg, agora)
    expect(p.fim).toBe(true)
    if (!p.fim) return
    expect(p.resultado).toMatchObject({ origem: 'falha', tipo: 'timeout', camada: 3, estado_conversa: 'aguardando_humano' })
  })

  it('com folga, o turno segue (repete a chamada)', () => {
    const estado = inicio(() => 0)
    const p = processarResposta(estado, { erro: 'timeout' }, cfg, () => 30_000)
    expect(p.fim).toBe(false)
  })

  it('prazo estourado antes da troca para a reserva tambem encerra', () => {
    let estado = inicio(() => 0)
    estado = { ...estado, tentativa_http: cfg.ia.tentativas_http }
    const p = processarResposta(estado, { erro: 'timeout' }, cfg, () => cfg.ia.timeout_turno_ms - 1000)
    expect(p.fim).toBe(true)
  })
})

describe('achado 3: alerta nao se perde quando o disco falha', () => {
  const dirQuebrado = () => {
    const arq = join(mkdtempSync(join(tmpdir(), 'disco-')), 'arquivo')
    writeFileSync(arq, 'x')
    return join(arq, 'dados') // pai e arquivo: mkdir falha
  }

  it('notificador: store sem disco ainda guarda em memoria, envia aos canais e registra uma linha', async () => {
    const logs: string[] = []
    const store = new AlertasStore({ dir: dirQuebrado(), agora: () => t('10:00'), retencaoDias: 30 })
    const n = criarNotificador({
      empresa: 'CentralEng', turnosParaQueda: 2, intervaloMin: 30, agora: () => t('10:00'), store,
      canais: criarCanais({}, (l) => logs.push(l)), log: (l) => logs.push(l),
      textos: { alerta_queda: 'parou {{hora}} {{tipo}}', alerta_recuperado: 'voltou' },
    })
    n.tratar({ origem: 'falha', tipo: 'n8n' })
    await n.aguardar()
    expect(store.json().eventos).toHaveLength(1)
    expect(logs.filter((l) => l.startsWith('ALERTA'))).toHaveLength(1)
    expect(logs.filter((l) => !l.startsWith('ALERTA'))).toHaveLength(1)
  })

  it('proxy: disco ilegivel e n8n fora do ar, o vendedor ainda recebe ALERTA e a lista em memoria', async () => {
    const logs: string[] = []
    const dir = dirQuebrado()
    const falhas = new FalhasStore({ dir, retencaoDias: 30 })
    const alertas = new AlertasStore({ dir, retencaoDias: 30 })
    const url = await subir(criarServidor(cfg, prompt, { webhookUrl: 'http://127.0.0.1:1/webhook', falhas, alertas, log: (l) => logs.push(l) }))
    const r = await chatar(url)
    expect(r.status).toBe(200)
    expect(logs.some((l) => l.startsWith('ALERTA queda'))).toBe(true)
    expect(alertas.json().eventos).toHaveLength(1)
    expect(falhas.resumo().turnos_falha).toBe(1)
  })
})

describe('achado 4: turno que some', () => {
  const silencio = { resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'n8n' }
  for (const corpo of [{ message: 'Workflow was started' }, { origem: 'outra', resposta: 'x' }, {}]) {
    it(`webhook 200 com ${JSON.stringify(corpo)} vira falha n8n contada`, async () => {
      const falhas = new FalhasStore({ retencaoDias: 30 })
      const url = await subir(criarServidor(cfg, prompt, { webhookUrl: await webhook(corpo), falhas, log: () => {} }))
      expect(await (await chatar(url)).json()).toEqual(silencio)
      expect(falhas.resumo()).toMatchObject({ turnos_totais: 1, turnos_falha: 1, tentativas_falhas_por_tipo: { n8n: 1 } })
    })
  }
})

describe('achado 5: mensagem longa e sobrecarga', () => {
  it('unir duas mensagens do lead mantem os 4000 caracteres mais recentes', () => {
    const a = 'a'.repeat(2500)
    const b = 'b'.repeat(2500)
    const p = iniciarTurno({ historico: [{ role: 'user', content: a }, { role: 'user', content: b }] }, prompt, cfg)
    expect(p.fim).toBe(false)
    if (p.fim) return
    const c = p.estado.historico[0]!.content
    expect(c).toHaveLength(4000)
    expect(c.endsWith(b)).toBe(true)
  })

  it('o campo do chat limita a 2000 caracteres', () => {
    expect(/<textarea[^>]*maxlength="2000"/.test(readFileSync('chat/index.html', 'utf8'))).toBe(true)
  })

  it('503 por concorrencia conta como turno falho sobrecarga; 429 e 413 ficam de fora', async () => {
    const soltar: Array<() => void> = []
    const lento = await subir(createHttpServer((req, res) => {
      req.resume()
      soltar.push(() => res.writeHead(200).end(JSON.stringify({ resposta: 'ola', origem: 'modelo', proxima_acao: 'perguntar' })))
    }))
    const falhas = new FalhasStore({ retencaoDias: 30 })
    const url = await subir(criarServidor(cfg, prompt, { webhookUrl: lento, falhas, maxConcorrentes: 1, limitePorMinuto: 2, limiteCorpo: 200, log: () => {} }))
    const primeiro = chatar(url)
    while (soltar.length < 1) await new Promise((r) => setTimeout(r, 10))
    expect((await chatar(url)).status).toBe(503)
    expect(falhas.resumo()).toMatchObject({ turnos_totais: 1, turnos_falha: 1, tentativas_falhas_por_tipo: { sobrecarga: 1 } })
    expect((await chatar(url)).status).toBe(429)
    const grande = await fetch(url + '/api/chat', { method: 'POST', body: JSON.stringify({ historico: [], x: 'y'.repeat(500) }) })
    expect([413, 429]).toContain(grande.status)
    expect(falhas.resumo().turnos_totais).toBe(1)
    soltar.forEach((f) => f())
    expect((await primeiro).status).toBe(200)
  })
})

describe('achado 6: recuperacao apos reinicio', () => {
  const montar = (store: AlertasStore, logs: string[] = []) =>
    criarNotificador({
      empresa: 'CentralEng', turnosParaQueda: 2, intervaloMin: 30, agora: () => t('11:00'), store,
      canais: criarCanais({}, (l) => logs.push(l)),
      textos: { alerta_queda: 'parou', alerta_recuperado: 'voltou {{n}}' },
    })

  it('ultimo evento persistido queda: turno bom depois do reinicio emite recuperado uma vez', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reinicio-'))
    const a = new AlertasStore({ dir, agora: () => t('10:00'), retencaoDias: 30 })
    a.adicionar({ ts: new Date(t('10:00')).toISOString(), tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 3 })
    const store = new AlertasStore({ dir, agora: () => t('11:00'), retencaoDias: 30 })
    const n = montar(store)
    n.tratar({ origem: 'modelo' })
    n.tratar({ origem: 'modelo' })
    await n.aguardar()
    const ev = store.json().eventos
    expect(ev.map((e) => e.tipo_evento)).toEqual(['queda', 'recuperado'])
    expect(ev[1]).toMatchObject({ tipo_falha: 'n8n', turnos_afetados: 3 })
  })

  it('ultimo evento persistido recuperado (ou nenhum): turno bom nao emite nada', async () => {
    const store = new AlertasStore({ agora: () => t('11:00'), retencaoDias: 30 })
    store.adicionar({ ts: new Date(t('10:00')).toISOString(), tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 1 })
    store.adicionar({ ts: new Date(t('10:05')).toISOString(), tipo_evento: 'recuperado', tipo_falha: 'n8n', turnos_afetados: 1 })
    const n = montar(store)
    n.tratar({ origem: 'modelo' })
    await n.aguardar()
    expect(store.json().eventos).toHaveLength(2)
  })

  it('retomada respeita o intervalo a partir do ts do evento persistido', async () => {
    const store = new AlertasStore({ agora: () => t('10:10'), retencaoDias: 30 })
    store.adicionar({ ts: new Date(t('10:00')).toISOString(), tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 1 })
    const n = criarNotificador({
      empresa: 'CentralEng', turnosParaQueda: 2, intervaloMin: 30, agora: () => t('10:10'), store,
      canais: [], textos: { alerta_queda: 'parou', alerta_recuperado: 'voltou' },
    })
    n.tratar({ origem: 'falha', tipo: 'n8n' })
    await n.aguardar()
    expect(store.json().eventos).toHaveLength(1)
  })
})

describe('itens menores', () => {
  const readme = readFileSync('README.md', 'utf8')
  it('README lista n8n entre os tipos de falha e avisa que down -v apaga os contadores', () => {
    expect(/Cada tentativa que falha[^\n]*`n8n`/.test(readme)).toBe(true)
    expect(readme).toMatch(/docker compose down -v[^\n]*(contador|apaga)/)
  })
})

describe('avaliar.mjs: espera o fluxo responder antes da rodada', () => {
  const script = fileURLToPath(new URL('../scripts/avaliar.mjs', import.meta.url))
  const falhaN8n = { resposta: null, estado: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'n8n' }
  const valido = { resposta: 'ok', origem: 'modelo', proxima_acao: 'responder_e_encerrar', tentativas: 1, saida: { cidade: 'X', confianca: 0.9 } }

  async function rodar(prontoApos: number) {
    const saida = mkdtempSync(join(tmpdir(), 'aval-p-'))
    let sondas = 0
    const srv = createHttpServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        const h = b ? JSON.parse(b).historico : []
        if (Array.isArray(h) && h.length === 0 && sondas++ < prontoApos) return res.end(JSON.stringify(falhaN8n))
        res.end(JSON.stringify(valido))
      })
    })
    const base = await subir(srv)
    const env = { ...process.env, AVALIACAO_URL: base + '/api/chat', AVALIACAO_SAIDA_DIR: saida, AVALIACAO_ESPERA_MS: '3000' }
    const code = await new Promise<number>((resolve) =>
      execFile('node', [script, '--conjunto', 'regressao'], { env }, (e) => resolve(e ? ((e as any).code ?? 1) : 0)))
    return { code, saida, sondas }
  }

  it('resposta 200 com tipo n8n duas vezes e depois valida: espera e roda', async () => {
    const r = await rodar(2)
    expect(r.code).toBe(0)
    expect(r.sondas).toBeGreaterThanOrEqual(3)
    expect(existsSync(join(r.saida, 'resultado-regressao.json'))).toBe(true)
  }, 30_000)

  it('nunca se recupera: sai 1 e nao grava resultado', async () => {
    const r = await rodar(Infinity)
    expect(r.code).toBe(1)
    expect(existsSync(join(r.saida, 'resultado-regressao.json'))).toBe(false)
  }, 30_000)
})
