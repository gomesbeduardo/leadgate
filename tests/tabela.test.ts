import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { avaliarCaso as avaliarCasoBase, resumir, tabelaMarkdown } from '../src/avaliacao/metricas.mjs'

// Verificador falso: a camada 2 real nao importa aqui.
const verificador = () => ({ prazo: false, vazamento: false })
const avaliarCaso = (c: any, r: any, leitura: any = {}) => avaliarCasoBase(c, r, 0.7, leitura, verificador)

const saidaOk = {
  tipo_servico: 'instalacao',
  segmento: 'residencial',
  cidade: 'florianopolis',
  urgencia: null,
  qualificado: false,
  proxima_acao: 'responder_e_encerrar',
  confianca: 0.9,
  ja_cliente: null,
  email: null,
}
const turno = (over: any = {}) => ({
  resposta: 'Oi, tudo bem? Me conta o que precisa.',
  resposta_nula: false,
  saida: saidaOk,
  tentativas: 1,
  origem: 'modelo',
  erro: false,
  violacoes: [],
  ressalvas: [],
  ...over,
})
const base = {
  id: 'x01',
  esperado: {
    tipo_servico: ['instalacao'],
    segmento: ['residencial'],
    cidade: ['Florianópolis'],
    urgencia: [null],
    qualificado: [false],
    proxima_acao: ['responder_e_encerrar'],
  } as Record<string, unknown[]>,
}
const com = (extra: any = {}, esperado: any = {}) => ({ ...base, ...extra, esperado: { ...base.esperado, ...esperado } })

describe('item 7 n/a sem mensagem fora do tema (T19)', () => {
  const casos = JSON.parse(readFileSync('avaliacao/casos.json', 'utf8'))
  const lista = Array.isArray(casos) ? casos : casos.casos
  const real = (id: string) => lista.find((c: any) => c.id === id)
  it('a02 (sem desvio) tem item 7 n/a e n01 (desvio) e avaliado', () => {
    const a02 = avaliarCaso(real('a02'), { turnos: [turno()] }, { '7': false })
    const n01 = avaliarCaso(real('n01'), { turnos: [turno()] }, { '7': true })
    const n01f = avaliarCaso(real('n01'), { turnos: [turno()] }, { '7': false })
    expect(a02.itens[7]).toBe('na')
    expect(n01.itens[7]).toBe(true)
    expect(n01f.itens[7]).toBe(false)
    const md = tabelaMarkdown(resumir({ ajuste: [a02, n01], reservado: null }) as any)
    const linha = (id: string) => md.split('\n').find((l) => l.startsWith(`| ${id} |`))!.split('|').map((s) => s.trim())
    expect(linha('a02')[8]).toBe('n/a')
    expect(linha('n01')[8]).toBe('ok')
  })
  it('tipo desvio sem esperado.desvios ainda avalia o item 7', () => {
    const r = avaliarCaso(com({ tipo: 'desvio' }), { turnos: [turno()] }, { '7': true })
    expect(r.itens[7]).toBe(true)
  })
  it('itens_na continua valendo', () => {
    const r = avaliarCaso(com({ tipo: 'desvio', itens_na: [7] }, { desvios: [1] }), { turnos: [turno()] }, { '7': true })
    expect(r.itens[7]).toBe('na')
  })
})

describe('ressalvas, ja_cliente e email', () => {
  it('ressalvas: acerta com a lista aceita, erra com vazia, ausente nao pontua', () => {
    const c = com({}, { ressalvas: [['residencial']] })
    expect(avaliarCaso(c, { turnos: [turno({ ressalvas: ['residencial'] })] }).campos.ressalvas).toBe(true)
    expect(avaliarCaso(c, { turnos: [turno({ ressalvas: [] })] }).campos.ressalvas).toBe(false)
    expect('ressalvas' in avaliarCaso(com(), { turnos: [turno()] }).campos).toBe(false)
  })
  it('ja_cliente e email pontuam so quando o esperado os traz', () => {
    const c = com({}, { ja_cliente: [null], email: ['ana.souza@gmail.com'] })
    const ok = avaliarCaso(c, { turnos: [turno({ saida: { ...saidaOk, email: 'ana.souza@gmail.com' } })] })
    expect(ok.campos.ja_cliente).toBe(true)
    expect(ok.campos.email).toBe(true)
    const ruim = avaliarCaso(c, { turnos: [turno({ saida: { ...saidaOk, ja_cliente: true } })] })
    expect(ruim.campos.ja_cliente).toBe(false)
    expect(ruim.campos.email).toBe(false)
    const sem = avaliarCaso(com(), { turnos: [turno()] })
    expect('ja_cliente' in sem.campos).toBe(false)
    expect('email' in sem.campos).toBe(false)
  })
})

describe('resposta nula com vendas e vagos = 2', () => {
  const nulo = turno({ resposta: null, resposta_nula: true })
  it('e valida com vagos [2]', () => {
    const r = avaliarCaso(com({}, { proxima_acao: ['encaminhar_vendas'], vagos: [2] }), { turnos: [nulo] })
    expect(r.erro).toBe(false)
    expect(r.itens[1]).toBe(true)
  })
  it('e invalida com vagos [1]', () => {
    const r = avaliarCaso(com({}, { proxima_acao: ['encaminhar_vendas'], vagos: [1] }), { turnos: [nulo] })
    expect(r.erro).toBe(true)
    expect(r.itens[1]).toBe(false)
  })
})

describe('checagens de texto da resposta', () => {
  const t = (resposta: string) => turno({ resposta })
  it('resposta_nao_contem olha todo turno, sem acento nem caixa', () => {
    const c = com({ resposta_nao_contem: ['Manutencao'] })
    expect(avaliarCaso(c, { turnos: [t('oi'), t('Sobre a manutenção, certo')] }).campos.resposta).toBe(false)
    expect(avaliarCaso(c, { turnos: [t('oi'), t('certo')] }).campos.resposta).toBe(true)
  })
  it('resposta_nao_comeca olha todo turno', () => {
    const c = com({ resposta_nao_comeca: ['Olá'] })
    expect(avaliarCaso(c, { turnos: [t('ola, tudo bem'), t('certo')] }).campos.resposta).toBe(false)
    expect(avaliarCaso(c, { turnos: [t('Oi, tudo bem'), t('Certo, olá')] }).campos.resposta).toBe(true)
  })
  it('resposta_contem_um olha a ultima resposta nao vazia', () => {
    const c = com({ resposta_contem_um: ['telefone', 'whatsapp'] })
    expect(avaliarCaso(c, { turnos: [t('seu telefone?'), t('ok'), t('')] }).campos.resposta).toBe(false)
    expect(avaliarCaso(c, { turnos: [t('oi'), t('Me passa o WhatsApp'), t('')] }).campos.resposta).toBe(true)
  })
  it('uma falha derruba acertou; sem as chaves nao ha campos.resposta', () => {
    const c = com({ resposta_nao_contem: ['oi'] })
    const r = avaliarCaso(c, { turnos: [t('Oi!')] })
    expect(r.acertou).toBe(false)
    expect(r.quadrante).toBe('erro_alta')
    expect('resposta' in avaliarCaso(com(), { turnos: [t('Oi!')] }).campos).toBe(false)
  })
  it('o resumo imprime resposta com n proprio', () => {
    const a = avaliarCaso(com({ resposta_nao_contem: ['zzz'] }), { turnos: [t('Oi!')] })
    const b = avaliarCaso(com(), { turnos: [t('Oi!')] })
    const resumo = resumir({ ajuste: [a, b], reservado: null }) as any
    expect(resumo.ajuste.campos.resposta).toEqual({ acertos: 1, n: 1 })
    expect(tabelaMarkdown(resumo)).toContain('| resposta | 1/1 (100%) |')
  })
})

describe('item 12', () => {
  it('reprova, fica pendente ou n/a por itens_na', () => {
    expect(avaliarCaso(com(), { turnos: [turno()] }, { '12': false }).itens[12]).toBe(false)
    expect(avaliarCaso(com(), { turnos: [turno()] }, {}).itens[12]).toBe('pendente')
    expect(avaliarCaso(com({ itens_na: [12] }), { turnos: [turno()] }, { '12': true }).itens[12]).toBe('na')
  })
})
