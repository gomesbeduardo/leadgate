import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { validarContrato, type Mensagem, type ResultadoValidacao } from '../src/validacao/contrato'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))

const base = (): Record<string, unknown> => ({
  tipo_servico: 'instalacao',
  segmento: 'comercial',
  cidade: 'São José',
  nome: 'Carlos',
  telefone: '48 99999-0001',
  urgencia: null,
  dados_faltantes: [],
  qualificado: true,
  confianca: 0.9,
  proxima_acao: 'perguntar',
  resposta: 'Perfeito, qual o tamanho do local?',
})

const validar = (over: Record<string, unknown>, historico: Mensagem[] = []) =>
  validarContrato(JSON.stringify({ ...base(), ...over }), { historico, cfg })

const regras = (r: ResultadoValidacao) => (r.ok ? [] : r.violacoes.map((v) => v.regra))
const historicoComPerguntas = (n: number): Mensagem[] =>
  Array.from({ length: n }, () => ({ role: 'assistant' as const, content: 'Qual o prazo?' }))

describe('aceite', () => {
  it('T2: segmento nao aceito com qualificado=true e invalido (cruzada)', () => {
    const r = validar({ segmento: 'residencial' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violacoes.some((v) => v.tipo === 'cruzada')).toBe(true)
  })

  it('T4: JSON do T3 e valido', () => {
    const r = validar({})
    expect(r.ok).toBe(true)
  })

  it('T9: texto que nao e JSON e invalido (schema), sem lancar', () => {
    const r = validarContrato('oi, tudo bem?', { historico: [], cfg })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violacoes[0]?.tipo).toBe('schema')
  })

  it('T10: encaminhar_vendas com qualificado=false e invalido (cruzada)', () => {
    const r = validar({ qualificado: false, proxima_acao: 'encaminhar_vendas', resposta: 'Vou passar para vendas.' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.violacoes.some((v) => v.tipo === 'cruzada')).toBe(true)
  })

  it('T12: dados completos com confianca alta mas qualificado=false diverge: invalido', () => {
    const r = validar({
      tipo_servico: 'pmoc',
      cidade: 'Santa Maria',
      telefone: '55 99999-0003',
      qualificado: false,
      proxima_acao: 'responder_e_encerrar',
      resposta: 'Obrigado pelo contato.',
    })
    expect(r.ok).toBe(false)
  })
})

describe('regras extras', () => {
  const humano = { qualificado: false, proxima_acao: 'encaminhar_humano', resposta: 'Um colega vai ligar.' }

  it('cidade fora da lista com telefone e encaminhar_humano e valida', () => {
    expect(validar({ cidade: 'Joinville', ...humano }).ok).toBe(true)
  })

  it('cidade fora da lista sem telefone citando o contato e valida', () => {
    const r = validar({
      cidade: 'Joinville', telefone: null, dados_faltantes: ['telefone'],
      qualificado: false, proxima_acao: 'responder_e_encerrar', resposta: `Fale com a gente: ${cfg.empresa.contato}.`,
    })
    expect(r.ok).toBe(true)
  })

  it('cidade fora da lista sem telefone sem citar o contato e invalida', () => {
    const r = validar({
      cidade: 'Joinville', telefone: null, dados_faltantes: ['telefone'],
      qualificado: false, proxima_acao: 'responder_e_encerrar', resposta: 'Nao atendemos essa regiao.',
    })
    expect(r.ok).toBe(false)
  })

  it('cidade fora da lista com telefone e perguntar e invalida', () => {
    const r = validar({ cidade: 'Joinville', qualificado: false })
    expect(r.ok).toBe(false)
  })

  it('cidade casa ignorando acento e caixa', () => {
    expect(validar({ cidade: ' sao jose ' }).ok).toBe(true)
  })

  it('teto de perguntas: perguntar vira invalido', () => {
    const r = validar({}, historicoComPerguntas(cfg.conversa.teto_perguntas))
    expect(r.ok).toBe(false)
    expect(regras(r)).toContain('teto_perguntas_atingido')
  })

  it('abaixo do teto perguntar segue valido', () => {
    expect(validar({}, historicoComPerguntas(cfg.conversa.teto_perguntas - 1)).ok).toBe(true)
  })

  it('teto atingido com dado faltante e telefone: encaminhar_humano valido', () => {
    const r = validar(
      { segmento: null, dados_faltantes: ['segmento'], qualificado: false, ...{ proxima_acao: 'encaminhar_humano', resposta: 'Um colega vai ligar.' } },
      historicoComPerguntas(cfg.conversa.teto_perguntas),
    )
    expect(r.ok).toBe(true)
  })

  it('teto atingido com dado faltante sem telefone: encerrar citando contato valido, sem contato invalido', () => {
    const over = { segmento: null, telefone: null, dados_faltantes: ['segmento', 'telefone'], qualificado: false, proxima_acao: 'responder_e_encerrar' }
    const h = historicoComPerguntas(cfg.conversa.teto_perguntas)
    expect(validar({ ...over, resposta: `Ligue: ${cfg.empresa.contato}` }, h).ok).toBe(true)
    expect(validar({ ...over, resposta: 'Obrigado.' }, h).ok).toBe(false)
  })

  it('R4: urgencia alta, qualificado e perguntar e invalido; encaminhar_vendas valido', () => {
    expect(validar({ urgencia: 'alta' }).ok).toBe(false)
    expect(validar({ urgencia: 'alta', proxima_acao: 'encaminhar_vendas', resposta: 'Vou passar para vendas.' }).ok).toBe(true)
  })

  it('perguntar com zero ou duas interrogacoes e invalido', () => {
    expect(validar({ resposta: 'Qual o tamanho.' }).ok).toBe(false)
    expect(validar({ resposta: 'Qual o tamanho? E o prazo?' }).ok).toBe(false)
  })

  it('confianca fora de [0,1] e invalida', () => {
    expect(validar({ confianca: 1.5 }).ok).toBe(false)
  })

  it('confianca abaixo do limiar proibe encaminhar_vendas', () => {
    const r = validar({ confianca: cfg.ia.limiar_confianca - 0.1, proxima_acao: 'encaminhar_vendas', resposta: 'Vendas.' })
    expect(regras(r)).toContain('confianca_baixa_sem_vendas')
  })

  it('dados completos com confianca >= limiar exigem qualificado=true', () => {
    const r = validar({ qualificado: false })
    expect(regras(r)).toContain('dados_completos_exigem_qualificado')
  })

  it('segmento recusado exige qualificado=false e responder_e_encerrar', () => {
    const r = validar({ segmento: 'residencial', qualificado: false, proxima_acao: 'responder_e_encerrar', resposta: 'Nao atendemos.' })
    expect(r.ok).toBe(true)
    const r2 = validar({ tipo_servico: 'fora_escopo', qualificado: false })
    expect(regras(r2)).toContain('recusa_exige_encerrar')
  })

  it('encaminhar_humano sem telefone e invalido', () => {
    const r = validar({ telefone: null, dados_faltantes: ['telefone'], qualificado: false, proxima_acao: 'encaminhar_humano', resposta: 'ok' })
    expect(regras(r)).toContain('humano_exige_telefone')
  })

  it('violacoes sao todas devolvidas', () => {
    const r = validar({ segmento: 'residencial', confianca: 2, resposta: 'sem pergunta' })
    expect(regras(r).length).toBeGreaterThanOrEqual(3)
  })
})
