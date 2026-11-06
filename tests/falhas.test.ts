import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FalhasStore } from '../src/servico/falhas'

const PRIMARIO = 'claude-haiku-5-5'
const reg = (tipo: string, tentativa = 1, camada = 1) => ({ ts: '2026-11-04T10:00:00Z', tipo, modelo: PRIMARIO, tentativa, camada })
const ok = (registros: unknown[] = [], camada = 1, modelo: string | null = 'primario') => ({ origem: 'modelo', tipo: 'nenhum', modelo_respondeu: modelo, camada, registros })
const falha = (tipo: string, registros: unknown[] = []) => ({ origem: 'falha', tipo, resposta: null, registros })
const novo = (dir?: string, agora = () => Date.parse('2026-11-04T10:00:00Z')) =>
  new FalhasStore({ dir, agora, retencaoDias: 30 })

describe('FalhasStore', () => {
  it('R17: 20 turnos, 3 com 429 recuperados e 1 esgotado = 5,0 %', () => {
    const s = novo()
    for (let i = 0; i < 16; i++) s.registrarTurno(ok())
    for (let i = 0; i < 3; i++) s.registrarTurno(ok([reg('429')]))
    s.registrarTurno(falha('schema', [reg('schema'), reg('schema', 2)]))
    const r = s.resumo()
    expect(r.turnos_totais).toBe(20)
    expect(r.turnos_falha).toBe(1)
    expect(r.taxa_falha).toBe('5,0 %')
    expect(r.tentativas_falhas_por_tipo['429']).toBe(3)
    expect(r.tentativas_falhas_por_tipo.schema).toBe(2)
    expect(r.recuperados_por_camada).toEqual({ '1': 3, '2': 0 })
    expect(r.modelo_respondeu).toEqual({ primario: 19, reserva: 0 })
  })

  it('turno recuperado na camada 2 conta por camada e pelo modelo reserva, e marca recuperado', () => {
    const s = novo()
    s.registrarTurno(ok([reg('5xx'), reg('5xx', 2)], 2, 'reserva'))
    const r = s.resumo()
    expect(r.recuperados_por_camada).toEqual({ '1': 0, '2': 1 })
    expect(r.modelo_respondeu).toEqual({ primario: 0, reserva: 1 })
    expect(r.taxa_falha).toBe('0,0 %')
    expect(s.tentativas().every((t) => t.recuperado === true)).toBe(true)
  })

  it('turno falho (modelo_respondeu null) nao conta em primario nem em reserva', () => {
    const s = novo()
    s.registrarTurno({ ...falha('429', [reg('429')]), modelo_respondeu: null })
    s.registrarTurno(ok())
    expect(s.resumo().modelo_respondeu).toEqual({ primario: 1, reserva: 0 })
  })

  it('1/60 = 1,7 %', () => {
    const s = novo()
    for (let i = 0; i < 59; i++) s.registrarTurno(ok())
    s.registrarTurno(falha('429', [reg('429')]))
    expect(s.resumo().taxa_falha).toBe('1,7 %')
  })

  it('sem turnos a taxa e 0,0 %', () => {
    expect(novo().resumo().taxa_falha).toBe('0,0 %')
  })

  it('entrada invalida (origem falha sem tipo) nao e falha nem entra nos totais', () => {
    const s = novo()
    s.registrarTurno({ origem: 'falha', resposta: null, tipo: null })
    s.registrarTurno(ok())
    const r = s.resumo()
    expect(r.turnos_totais).toBe(1)
    expect(r.turnos_falha).toBe(0)
    expect(r.entradas_invalidas).toBe(1)
  })

  it('n8n e servico viram um registro de tentativa sintetico', () => {
    const s = novo()
    s.registrarTurno({ origem: 'falha', tipo: 'n8n' }, 'n8n')
    s.registrarTurno({ origem: 'falha', tipo: 'servico' })
    expect(s.resumo().tentativas_falhas_por_tipo).toEqual({ n8n: 1, servico: 1 })
    expect(s.tentativas().map((t) => t.origem_componente)).toEqual(['n8n', 'servico'])
  })

  it('sobrecarga vira registro sintetico do componente servico', () => {
    const s = novo()
    s.registrarTurno({ origem: 'falha', tipo: 'sobrecarga' })
    expect(s.resumo().tentativas_falhas_por_tipo).toEqual({ sobrecarga: 1 })
    expect(s.tentativas().map((t) => t.origem_componente)).toEqual(['servico'])
  })

  it('reset zera tudo', () => {
    const s = novo()
    s.registrarTurno(falha('429', [reg('429')]))
    s.reset()
    expect(s.resumo().turnos_totais).toBe(0)
    expect(s.tentativas()).toEqual([])
  })

  it('persiste e recarrega apos reinicio, escrevendo sem arquivo temporario sobrando', () => {
    const dir = mkdtempSync(join(tmpdir(), 'falhas-'))
    const a = novo(dir)
    a.registrarTurno(ok([reg('429')]))
    a.registrarTurno(falha('n8n'))
    const b = novo(dir)
    expect(b.resumo()).toEqual(a.resumo())
    expect(readdirSync(dir)).toEqual(['falhas.json'])
  })

  it('retencao: ao carregar descarta registros mais velhos que lgpd.retencao_dias', () => {
    const dir = mkdtempSync(join(tmpdir(), 'falhas-'))
    const velho = novo(dir, () => Date.parse('2026-09-01T10:00:00Z'))
    velho.registrarTurno(falha('429', [{ ...reg('429'), ts: '2026-09-01T10:00:00Z' }]))
    const atual = novo(dir)
    expect(atual.resumo().turnos_totais).toBe(0)
    expect(atual.tentativas()).toEqual([])
  })

  it('guarda no maximo 5000 registros', () => {
    const s = novo()
    for (let i = 0; i < 5100; i++) s.registrarTurno(ok())
    expect(s.resumo().turnos_totais).toBe(5000)
  })

  it('T23/C14: o JSON gravado nao tem texto de mensagem nem telefone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'falhas-'))
    const s = novo(dir)
    s.registrarTurno({
      ...falha('429', [reg('429')]), resposta: 'ligue 99999-0000', conversa: [{ role: 'user', content: 'meu fone 99999' }],
      historico: [{ content: 'oi 99999' }], telefone: '99999',
    })
    s.registrarTurno({ ...ok([{ ...reg('429'), mensagem: 'texto 99999' }]), resposta: 'ola 99999' })
    const bruto = readFileSync(join(dir, 'falhas.json'), 'utf8')
    expect(bruto).not.toContain('99999')
    expect(bruto).not.toContain('resposta')
  })
})
