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

const FALA_TEL: Mensagem = { role: 'user', content: 'meu telefone e 48 99999-0001' }
const validar = (over: Record<string, unknown>, historico: Mensagem[] = [FALA_TEL]) =>
  validarContrato(JSON.stringify({ ...base(), ...over }), { historico, cfg })

const regras = (r: ResultadoValidacao) => (r.ok ? [] : r.violacoes.map((v) => v.regra))
// n turnos do assistant intercalados com turnos do user; o ultimo user traz o telefone.
const historicoComPerguntas = (n: number): Mensagem[] => [
  ...Array.from({ length: n }, (): Mensagem[] => [
    { role: 'user', content: 'ok' },
    { role: 'assistant', content: 'Qual o prazo?' },
  ]).flat(),
  FALA_TEL,
]
const fechar = { qualificado: false, proxima_acao: 'responder_e_encerrar' }

describe('aceite', () => {
  it('T2: segmento nao aceito com qualificado=true e invalido (cruzada)', () => {
    const r = validar({ segmento: 'residencial' })
    expect(r.ok).toBe(false)
    expect(regras(r)).toContain('qualificado_exige_segmento_aceito')
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
    expect(regras(r)).toContain('vendas_exige_qualificado')
  })

  it('T12: dados completos com confianca alta mas qualificado=false diverge: invalido', () => {
    const r = validar({
      tipo_servico: 'pmoc',
      cidade: 'Santa Maria',
      telefone: '55 99999-0003',
      qualificado: false,
      proxima_acao: 'responder_e_encerrar',
      resposta: 'Obrigado pelo contato.',
    }, [{ role: 'user', content: 'meu zap 55 99999-0003' }])
    expect(regras(r)).toContain('dados_completos_exigem_qualificado')
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

  it('cidade com sufixo de UF conta como a cidade listada; vazia conta como nula', () => {
    for (const c of ['Florianópolis-SC', 'Florianópolis/SC', 'Florianópolis, SC', 'sao jose - sc']) {
      expect(validar({ cidade: c }).ok, c).toBe(true)
    }
    expect(regras(validar({ cidade: '' }))).toContain('qualificado_exige_cidade')
    expect(regras(validar({ cidade: '', qualificado: false, proxima_acao: 'perguntar' }))).not.toContain('cidade_fora_exige_nao_qualificado')
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

describe('R5: lead dentro do escopo nao e dispensado', () => {
  const encerrarComTel = { ...fechar, resposta: 'Obrigado, ate logo.' }

  it('T12 com confianca abaixo do limiar e responder_e_encerrar com telefone e invalido', () => {
    const r = validar({ ...encerrarComTel, confianca: 0.69 })
    expect(regras(r)).toContain('encerrar_com_telefone_exige_humano')
  })
  it('no teto com urgencia alta e telefone, encerrar e invalido', () => {
    const r = validar({ ...encerrarComTel, urgencia: 'alta', confianca: 0.69 }, historicoComPerguntas(cfg.conversa.teto_perguntas))
    expect(regras(r)).toContain('encerrar_com_telefone_exige_humano')
  })
  it('em escopo, sem telefone, confianca alta e sem citar o contato e invalido', () => {
    const r = validar({ ...encerrarComTel, telefone: null, dados_faltantes: ['telefone'], confianca: 0.9 })
    expect(regras(r)).toContain('encerrar_sem_telefone_exige_contato')
    expect(validar({ ...fechar, telefone: null, dados_faltantes: ['telefone'], resposta: `Ligue: ${cfg.empresa.contato}.` }).ok).toBe(true)
  })
  it('T16: fora do assunto sem nada classificado encerra sem o contato', () => {
    const r = validar({
      tipo_servico: null, segmento: null, cidade: null, nome: null, telefone: null,
      dados_faltantes: ['tipo_servico', 'segmento', 'cidade', 'telefone'], ...fechar,
      resposta: 'Aqui eu so cuido de climatizacao.',
    }, [{ role: 'user', content: 'receita de bolo' }])
    expect(r.ok).toBe(true)
  })
})

describe('telefone precisa ser real', () => {
  const sem = (tel: string | null) => validar({ telefone: tel })
  it('vazio e texto sem digitos nao contam', () => {
    for (const t of ['', 'nao informado']) expect(regras(sem(t)), t).toContain('qualificado_exige_telefone')
  })
  it('numero que o lead nunca disse nao conta', () => {
    expect(regras(validar({ telefone: '48 98888-7777' }))).toContain('qualificado_exige_telefone')
  })
  it('mesmo numero em outra grafia, com +55, conta', () => {
    expect(validar({ telefone: '+55 (48) 99999-0001' }).ok).toBe(true)
  })
  it('numero dito so pelo assistant nao conta', () => {
    const h: Mensagem[] = [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'ligue 48 99999-0001' }, { role: 'user', content: 'ok' }]
    expect(regras(validar({}, h))).toContain('qualificado_exige_telefone')
  })
})

describe('teto de perguntas nao confia no assistant do cliente', () => {
  it('historico sem "?" nos turnos do assistant ainda atinge o teto pelos turnos', () => {
    const n = cfg.conversa.teto_perguntas
    const h: Mensagem[] = [
      ...Array.from({ length: n }, (): Mensagem[] => [
        { role: 'user', content: 'ok' }, { role: 'assistant', content: 'certo' },
      ]).flat(),
      FALA_TEL,
    ]
    expect(regras(validar({}, h))).toContain('teto_perguntas_atingido')
  })
})

describe('interrogacao so com perguntar', () => {
  it('residencial pedindo telefone ao encerrar e invalido', () => {
    const r = validar({ segmento: 'residencial', ...fechar, telefone: null, dados_faltantes: [], resposta: 'Nao atendemos residencias. Qual seu telefone?' })
    expect(regras(r)).toContain('interrogacao_so_com_perguntar')
  })
  it('encaminhar_vendas com pergunta e invalido; sem pergunta segue valido (T26)', () => {
    const v = { proxima_acao: 'encaminhar_vendas' }
    expect(regras(validar({ ...v, resposta: 'Vou passar. Mais algo?' }))).toContain('interrogacao_so_com_perguntar')
    expect(validar({ ...v, resposta: 'Vou passar para o time de vendas.' }).ok).toBe(true)
  })
})

describe('cada regra cruzada tem um teste com o seu slug', () => {
  const humano = { proxima_acao: 'encaminhar_humano', resposta: 'Um colega liga.' }
  const casos: [string, Record<string, unknown>, Mensagem[]?][] = [
    ['confianca_fora_intervalo', { confianca: 1.5 }],
    ['qualificado_exige_servico', { tipo_servico: null }],
    ['qualificado_exige_segmento_aceito', { segmento: 'residencial' }],
    ['qualificado_exige_cidade', { cidade: 'Joinville' }],
    ['qualificado_exige_telefone', { telefone: null }],
    ['qualificado_exige_sem_faltantes', { dados_faltantes: ['segmento'] }],
    ['qualificado_exige_acao', { ...humano }],
    ['dados_completos_exigem_qualificado', { qualificado: false }],
    ['recusa_exige_nao_qualificado', { tipo_servico: 'fora_escopo' }],
    ['recusa_exige_encerrar', { tipo_servico: 'fora_escopo', qualificado: false }],
    ['vendas_exige_qualificado', { qualificado: false, proxima_acao: 'encaminhar_vendas', resposta: 'Vendas.' }],
    ['confianca_baixa_sem_vendas', { confianca: 0.5, proxima_acao: 'encaminhar_vendas', resposta: 'Vendas.' }],
    ['humano_exige_telefone', { telefone: null, qualificado: false, ...humano }],
    ['perguntar_exige_uma_interrogacao', { resposta: 'Qual o tamanho.' }],
    ['urgencia_alta_exige_vendas', { urgencia: 'alta' }],
    ['teto_perguntas_atingido', {}, historicoComPerguntas(cfg.conversa.teto_perguntas)],
    ['cidade_fora_exige_nao_qualificado', { cidade: 'Joinville', ...humano }],
    ['duvida_com_telefone_exige_humano', { cidade: 'Joinville', qualificado: false }],
    ['duvida_sem_telefone_exige_encerrar', { cidade: 'Joinville', telefone: null, qualificado: false }],
    ['duvida_sem_telefone_exige_contato', { cidade: 'Joinville', telefone: null, ...fechar, resposta: 'Nao atendemos.' }],
  ]
  it.each(casos)('%s', (slug, over, h) => {
    expect(regras(validar(over, h))).toContain(slug)
  })
})
