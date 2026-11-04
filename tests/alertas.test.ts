import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AlertasStore, canalResend, criarCanais, criarMaquinaQueda, criarNotificador, preencher, type EventoAlerta } from '../src/servico/alertas'

const t = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00-03:00`)
const F = { origem: 'falha', tipo: 'rede' } as const
const OK = { origem: 'modelo', tipo: 'nenhum' } as const

describe('maquina de queda (R18)', () => {
  const nova = (relogio: { v: number }, turnos = 2) => criarMaquinaQueda({ turnos_para_queda: turnos, intervalo_min: 30 }, () => relogio.v)

  it('um turno falho nao e queda; o segundo consecutivo e', () => {
    const r = { v: t('10:00') }
    const m = nova(r)
    expect(m.registrar(F)).toEqual([])
    const ev = m.registrar(F)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ tipo_evento: 'queda', tipo_falha: 'rede', turnos_afetados: 2 })
  })

  it('turno ok entre as falhas zera a contagem', () => {
    const m = nova({ v: t('10:00') })
    m.registrar(F)
    m.registrar(OK)
    expect(m.registrar(F)).toEqual([])
  })

  it('um unico turno n8n ou servico ja e queda', () => {
    expect(nova({ v: 0 }).registrar({ origem: 'falha', tipo: 'n8n' })).toHaveLength(1)
    expect(nova({ v: 0 }).registrar({ origem: 'falha', tipo: 'servico' })).toHaveLength(1)
  })

  it('T19: 5 turnos falhos ate 10:20 geram 1 queda; o 6o as 10:31 gera a 2a', () => {
    const r = { v: t('10:00') }
    const m = nova(r)
    const eventos: unknown[] = []
    for (const hhmm of ['10:00', '10:00', '10:05', '10:10', '10:20']) {
      r.v = t(hhmm)
      eventos.push(...m.registrar(F))
    }
    expect(eventos).toHaveLength(1)
    r.v = t('10:31')
    const ev = m.registrar(F)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ tipo_evento: 'queda', turnos_afetados: 6 })
  })

  it('recuperacao uma vez, com o total de turnos afetados; depois nada', () => {
    const m = nova({ v: t('10:00') })
    m.registrar(F)
    m.registrar(F)
    m.registrar(F)
    const ev = m.registrar(OK)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ tipo_evento: 'recuperado', turnos_afetados: 3 })
    expect(m.registrar(OK)).toEqual([])
  })

  it('turnos_para_queda vem da config', () => {
    const m = nova({ v: 0 }, 3)
    m.registrar(F)
    expect(m.registrar(F)).toEqual([])
    expect(m.registrar(F)).toHaveLength(1)
  })
})

describe('preencher', () => {
  it('troca os marcadores', () => {
    expect(preencher('{{empresa.nome}} {{hora}} {{tipo}} {{n}} {{efeito_no_lead}}', { 'empresa.nome': 'A', hora: '10:00', tipo: 'n8n', n: '2', efeito_no_lead: 'x' })).toBe('A 10:00 n8n 2 x')
  })
})

describe('AlertasStore', () => {
  it('persiste eventos e o contador, e recarrega', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alertas-'))
    const mk = () => new AlertasStore({ dir, agora: () => t('10:00'), retencaoDias: 30 })
    const a = mk()
    a.adicionar({ ts: '2026-11-04T13:00:00.000Z', tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 1 })
    a.incNaoEntregue()
    expect(mk().json()).toEqual(a.json())
    expect(mk().json().alerta_nao_entregue).toBe(1)
    expect(readFileSync(join(dir, 'alertas.json'), 'utf8')).not.toContain('texto')
  })
})

describe('canais', () => {
  let srv: Server | undefined
  afterEach(async () => {
    if (srv) await new Promise<void>((r) => srv!.close(() => r()))
    srv = undefined
  })
  const receptor = async (status: number) => {
    const recebidos: Array<{ url?: string; auth?: string; corpo: any }> = []
    srv = createServer((req, res) => {
      const p: Buffer[] = []
      req.on('data', (c) => p.push(c))
      req.on('end', () => {
        recebidos.push({ url: req.url, auth: req.headers.authorization, corpo: JSON.parse(Buffer.concat(p).toString()) })
        res.writeHead(status).end('{}')
      })
    })
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r))
    return { recebidos, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }
  }
  const ev: EventoAlerta = { ts: '2026-11-04T13:00:00.000Z', tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 1, assunto: 'Atendimento parou', texto: 'texto do aviso' }

  it('T20: resend faz POST em /emails com Bearer e o JSON de R18', async () => {
    const { recebidos, url } = await receptor(200)
    await canalResend({ RESEND_API_KEY: 'chave-x', RESEND_BASE_URL: url, ALERTA_EMAIL_DE: 'de@x.com', ALERTA_EMAIL_PARA: 'para@x.com' }).enviar(ev)
    expect(recebidos).toHaveLength(1)
    expect(recebidos[0]!.url).toBe('/emails')
    expect(recebidos[0]!.auth).toBe('Bearer chave-x')
    expect(recebidos[0]!.corpo).toEqual({ from: 'de@x.com', to: ['para@x.com'], subject: 'Atendimento parou', text: 'texto do aviso' })
  })

  it('resend rejeita quando o receptor devolve 500', async () => {
    const { url } = await receptor(500)
    await expect(canalResend({ RESEND_API_KEY: 'k', RESEND_BASE_URL: url }).enviar(ev)).rejects.toThrow()
  })

  it('sem chave, ALERTA_CANAL=resend volta ao simulado com um aviso, sem a chave no log', () => {
    const logs: string[] = []
    const canais = criarCanais({ ALERTA_CANAL: 'resend' }, (l) => logs.push(l))
    expect(canais.map((c) => c.nome)).toEqual(['simulado'])
    expect(logs.filter((l) => l.includes('RESEND_API_KEY'))).toHaveLength(1)
  })

  it('com chave, simulado e resend; padrao so simulado', () => {
    expect(criarCanais({ ALERTA_CANAL: 'resend', RESEND_API_KEY: 'segredo-123' }, () => {}).map((c) => c.nome)).toEqual(['simulado', 'resend'])
    expect(criarCanais({}, () => {}).map((c) => c.nome)).toEqual(['simulado'])
  })

  it('T21: falha do resend vira alerta_nao_entregue e nao quebra o notificador; simulado loga ALERTA e nunca a chave', async () => {
    const { url } = await receptor(500)
    const logs: string[] = []
    const store = new AlertasStore({ agora: () => t('10:00'), retencaoDias: 30 })
    const canais = criarCanais({ ALERTA_CANAL: 'resend', RESEND_API_KEY: 'segredo-123', RESEND_BASE_URL: url }, (l) => logs.push(l))
    const n = criarNotificador({
      empresa: 'CentralEng', turnosParaQueda: 2, intervaloMin: 30, agora: () => t('10:00'), store, canais,
      textos: { alerta_queda: 'parou {{hora}} {{tipo}} {{efeito_no_lead}}', alerta_recuperado: 'voltou {{hora}} {{n}}' },
    })
    n.tratar({ origem: 'falha', tipo: 'n8n' })
    await n.aguardar()
    expect(store.json().alerta_nao_entregue).toBe(1)
    expect(store.json().eventos).toHaveLength(1)
    expect(store.json().eventos[0]).toMatchObject({ tipo_evento: 'queda', tipo_falha: 'n8n', turnos_afetados: 1 })
    const alerta = logs.find((l) => l.startsWith('ALERTA'))
    expect(alerta).toContain('parou 10:00 n8n Os leads estão sem resposta.')
    expect(logs.join('\n')).not.toContain('segredo-123')
  })
})
