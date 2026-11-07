import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, describe, expect, it } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { criarServidorInterno } from '../src/servico/app'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const prompt = readFileSync('prompts/agente.md', 'utf8')
const historico = [{ role: 'user', content: 'Oi, quero manutenção na loja' }]
const filhos: ChildProcess[] = []
let interno: Server

afterAll(async () => {
  filhos.forEach((f) => f.kill())
  if (interno) await new Promise<void>((r) => interno.close(() => r()))
})

async function stub(cenario: string, porta: number, extra: Record<string, string> = {}) {
  const f = spawn('node', ['scripts/stub-api.mjs'], { env: { ...process.env, PORT: String(porta), STUB_CENARIO: cenario, ...extra } })
  filhos.push(f)
  await new Promise<void>((r) => f.stdout!.once('data', () => r()))
  return `http://127.0.0.1:${porta}`
}
const chamar = async (base: string, requisicao: any) => {
  const r = await fetch(base + '/v1/messages', { method: 'POST', body: JSON.stringify(requisicao) })
  return { status: r.status, cabecalhos: Object.fromEntries(r.headers), corpo: await r.json() }
}
async function servico() {
  interno = criarServidorInterno(cfg, prompt)
  await new Promise<void>((r) => interno.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(interno.address() as AddressInfo).port}`
  const post = async (rota: string, c: unknown) =>
    (await fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) })).json() as Promise<any>
  return post
}

describe('stub da API: cenarios', () => {
  it('503_depois_ok: 503 na primeira chamada do turno e JSON valido na segunda, aceito pelo validador real', async () => {
    const base = await stub('503_depois_ok', 18791)
    const post = await servico()
    const p = await post('/preparar', { historico })
    const a = await chamar(base, p.requisicao)
    expect(a.status).toBe(503)
    const b = await chamar(base, p.requisicao)
    expect(b.status).toBe(200)
    const v = await post('/validar', { estado: p.estado, resposta: b })
    expect(v).toMatchObject({ fim: true, resultado: { origem: 'modelo', proxima_acao: 'perguntar' } })
  })

  it('sempre_503, 429_retry_after, reserva_ok e recusa_depois_ok', async () => {
    const req = { model: cfg.ia.modelo, messages: [{ role: 'user', content: 'x' }] }
    const s503 = await stub('sempre_503', 18792)
    expect((await chamar(s503, req)).status).toBe(503)
    expect((await chamar(s503, req)).status).toBe(503)

    const s429 = await stub('429_retry_after', 18793)
    const r1 = await chamar(s429, req)
    expect(r1.status).toBe(429)
    expect(r1.cabecalhos['retry-after']).toBe('1')
    expect((await chamar(s429, req)).status).toBe(200)

    const sRes = await stub('reserva_ok', 18794)
    expect((await chamar(sRes, req)).status).toBe(503)
    expect((await chamar(sRes, { ...req, model: 'claude-haiku-5-5' })).status).toBe(200)

    const sRec = await stub('recusa_depois_ok', 18795)
    expect((await chamar(sRec, req)).corpo.stop_reason).toBe('refusal')
    expect((await chamar(sRec, req)).corpo.stop_reason).toBe('end_turn')
  })

  it('fecha_socket: destroi a conexao sem responder', async () => {
    const base = await stub('fecha_socket', 18797)
    await expect(chamar(base, { model: 'x', messages: [] })).rejects.toThrow()
    await expect(chamar(base, { model: 'x', messages: [] })).rejects.toThrow()
  })

  it('lento: responde so depois de STUB_ATRASO_MS (padrao 30000)', async () => {
    const base = await stub('lento', 18798, { STUB_ATRASO_MS: '400' })
    const t0 = Date.now()
    const r = await chamar(base, { model: 'x', messages: [] })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(380)
    expect(r.status).toBe(200)
    expect(r.corpo.stop_reason).toBe('end_turn')
    // sem STUB_ATRASO_MS o atraso padrao e 30 s: a resposta nao chega em 300 ms
    const padrao = await stub('lento', 18799)
    await expect(fetch(padrao + '/v1/messages', { method: 'POST', body: '{}', signal: AbortSignal.timeout(300) })).rejects.toThrow()
  })

  it('sem STUB_CENARIO mantem o comportamento antigo', async () => {
    const base = await stub('padrao', 18796)
    const r = await chamar(base, { model: 'x', messages: [] })
    expect(r.status).toBe(200)
    expect(r.corpo.content[0].text).toBe('isto nao e json')
  })
})

describe('spec 006-6: stub com tipo orcamento', () => {
  it('T38: o cenario orcamento devolve uma saida com tipo_servico orcamento aceita pelo contrato', async () => {
    const { validarContrato } = await import('../src/validacao/contrato')
    const base = await stub('orcamento', 18810)
    const r = await chamar(base, { model: 'x', messages: [{ role: 'user', content: 'Quero orçamento pra minha loja em Santa Maria' }] })
    const texto = r.corpo.content[0].text
    expect(JSON.parse(texto).tipo_servico).toBe('orcamento')
    const v = validarContrato(texto, { historico: [{ role: 'user', content: 'Quero orçamento pra minha loja em Santa Maria' }], cfg })
    expect(v.ok || v.violacoes.every((x) => x.tipo !== 'schema')).toBe(true)
  })
})
