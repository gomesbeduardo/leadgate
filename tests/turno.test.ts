import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carregarConfig, type Config } from '../src/config/schema'
import type { Mensagem } from '../src/validacao/contrato'
import {
  falhaDeApi,
  iniciarTurno,
  montarRequisicao,
  processarResposta,
  schemaSaida,
  type Passo,
  type Resultado,
} from '../src/fluxo/turno'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const modelo = readFileSync('prompts/agente.md', 'utf8')

const corpo = (texto: string, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'text', text: texto }],
})

const saidaBase = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    tipo_servico: null,
    segmento: null,
    cidade: null,
    nome: null,
    telefone: null,
    urgencia: null,
    dados_faltantes: ['tipo_servico', 'segmento', 'cidade', 'telefone'],
    qualificado: false,
    confianca: 0.5,
    proxima_acao: 'perguntar',
    resposta: 'Qual servico voce precisa?',
    ...extra,
  })

const invalida = saidaBase({ qualificado: true })

function rodar(historico: Mensagem[], respostas: unknown[], c: Config = cfg) {
  const requisicoes: any[] = []
  let passo: Passo = iniciarTurno({ historico }, modelo, c)
  let i = 0
  while (!passo.fim) {
    requisicoes.push(montarRequisicao(passo.estado, c))
    passo = processarResposta(passo.estado, respostas[i++], c)
  }
  return { resultado: passo.resultado as Resultado, requisicoes, chamadas: i }
}

const oi: Mensagem[] = [{ role: 'user', content: 'Oi, preciso de um orcamento' }]

describe('iniciarTurno', () => {
  it('entrada valida comeca na tentativa 1', () => {
    const p = iniciarTurno({ historico: oi }, modelo, cfg)
    expect(p.fim).toBe(false)
    if (!p.fim) {
      expect(p.estado.tentativa).toBe(1)
      expect(p.estado.correcao).toBeNull()
      expect(p.estado.historico).toEqual(oi)
    }
  })
  it.each([
    ['historico vazio', { historico: [] }],
    ['ultima mensagem do assistant', { historico: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }],
    ['content vazio', { historico: [{ role: 'user', content: '' }] }],
    ['content longo demais', { historico: [{ role: 'user', content: 'x'.repeat(4001) }] }],
    ['nao e objeto', 'oi'],
  ])('entrada invalida (%s) nao chama o modelo', (_n, entrada) => {
    const p = iniciarTurno(entrada, modelo, cfg)
    expect(p.fim).toBe(true)
    if (p.fim) {
      expect(p.resultado.tentativas).toBe(0)
      expect(p.resultado.origem).toBe('falha')
      expect(p.resultado.erro).toBe(true)
      expect(p.resultado.resposta).toBe(cfg.textos.falha_tecnica)
    }
  })
  it('T22: marcador sem valor falha a montagem e nao chama o modelo', () => {
    const p = iniciarTurno({ historico: oi }, modelo + '\n{{empresa.inexistente}}', cfg)
    expect(p.fim).toBe(true)
    if (p.fim) {
      expect(p.resultado.tentativas).toBe(0)
      expect(p.resultado.resposta).toBe(cfg.textos.falha_tecnica)
      expect(p.resultado.erro).toBe(true)
    }
  })
})

describe('montarRequisicao', () => {
  it('monta o corpo da API', () => {
    const p = iniciarTurno({ historico: oi }, modelo, cfg)
    if (p.fim) throw new Error('esperava estado')
    const r: any = montarRequisicao(p.estado, cfg)
    expect(r.model).toBe(cfg.ia.modelo)
    expect(r.max_tokens).toBe(4000)
    expect(r.system).toBe(p.estado.promptMontado)
    expect(r.messages).toEqual(oi)
    expect(r.output_config.effort).toBe(cfg.ia.effort)
    expect(r.output_config.format).toEqual({ type: 'json_schema', schema: schemaSaida(cfg) })
    expect(r).not.toHaveProperty('temperature')
    expect(r).not.toHaveProperty('thinking')
  })
})

describe('schemaSaida', () => {
  const s: any = schemaSaida(cfg)
  it('fecha o objeto e exige os 11 campos', () => {
    expect(s.type).toBe('object')
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toHaveLength(11)
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort())
  })
  it('enums vem da config e nulaveis usam anyOf', () => {
    expect(s.properties.tipo_servico.anyOf[0].enum).toEqual([...cfg.servicos, 'fora_escopo'])
    expect(s.properties.segmento.anyOf[0].enum).toEqual(cfg.segmentos)
    expect(s.properties.cidade.anyOf).toEqual([{ type: 'string' }, { type: 'null' }])
    expect(s.properties.confianca).toEqual({ type: 'number' })
  })
  it('sem restricoes que a API rejeita', () => {
    const txt = JSON.stringify(s)
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength']) expect(txt).not.toContain(`"${k}"`)
  })
})

describe('loop de regeneracao', () => {
  it('T9: texto que nao e JSON gera regeneracao 1 com instrucao de correcao', () => {
    const p = iniciarTurno({ historico: oi }, modelo, cfg)
    if (p.fim) throw new Error('x')
    const q = processarResposta(p.estado, corpo('isto nao e json'), cfg)
    expect(q.fim).toBe(false)
    if (!q.fim) {
      expect(q.estado.tentativa).toBe(2)
      expect(q.estado.correcao).toMatch(/JSON/)
    }
  })

  it('invalida e depois valida: 2 tentativas, correcao como ultima mensagem system', () => {
    const { resultado, requisicoes } = rodar(oi, [corpo(invalida), corpo(saidaBase())])
    expect(resultado.tentativas).toBe(2)
    expect(resultado.erro).toBe(false)
    expect(resultado.origem).toBe('modelo')
    expect(resultado.saida).not.toBeNull()
    expect(resultado.resposta).toBe('Qual servico voce precisa?')
    expect(resultado.conversa).toEqual(oi)
    expect(requisicoes[0].messages.some((m: any) => m.role === 'system')).toBe(false)
    const ult = requisicoes[1].messages.at(-1)
    expect(ult.role).toBe('system')
    expect(ult.content.length).toBeGreaterThan(10)
    expect(requisicoes[1].messages).toHaveLength(oi.length + 1)
    expect(JSON.stringify(requisicoes[1].messages)).not.toContain('"qualificado":true')
  })

  it('refusal e max_tokens contam como tentativa falha', () => {
    for (const sr of ['refusal', 'max_tokens']) {
      const { resultado, chamadas } = rodar(oi, [corpo(saidaBase(), sr), corpo(saidaBase())])
      expect(chamadas).toBe(2)
      expect(resultado.tentativas).toBe(2)
      expect(resultado.erro).toBe(false)
    }
  })

  it('corpo sem bloco de texto e tentativa falha', () => {
    const { resultado } = rodar(oi, [{ stop_reason: 'end_turn', content: [] }, corpo(saidaBase())])
    expect(resultado.tentativas).toBe(2)
  })

  it('T11: 3 saidas invalidas seguidas, sem telefone: falha tecnica', () => {
    const { resultado, chamadas } = rodar(oi, [corpo('x'), corpo('y'), corpo('z')])
    expect(chamadas).toBe(3)
    expect(resultado.tentativas).toBe(3)
    expect(resultado.resposta).toBe(cfg.textos.falha_tecnica)
    expect(resultado.proxima_acao).toBe('responder_e_encerrar')
    expect(resultado.origem).toBe('falha')
    expect(resultado.erro).toBe(true)
    expect(resultado.saida).toBeNull()
    expect(resultado.violacoes.length).toBeGreaterThan(0)
  })

  it('T12: esgotado com telefone vai para encaminhar_humano', () => {
    const hist: Mensagem[] = [{ role: 'user', content: 'PMOC para nossa clínica em Santa Maria, 55 99999-0003' }]
    const ruim = saidaBase({
      tipo_servico: 'pmoc', segmento: 'comercial', cidade: 'Santa Maria', telefone: '55 99999-0003',
      dados_faltantes: [], qualificado: false, confianca: 0.9, proxima_acao: 'responder_e_encerrar',
      resposta: 'Obrigado pelo contato.',
    })
    const { resultado } = rodar(hist, [corpo(ruim), corpo(ruim), corpo(ruim)])
    expect(resultado.proxima_acao).toBe('encaminhar_humano')
    expect(resultado.erro).toBe(true)
    expect(resultado.resposta).toBe(cfg.textos.falha_tecnica)
    expect(resultado.conversa).toEqual(hist)
  })
})

describe('falhaDeApi', () => {
  const est = (historico: Mensagem[]) => {
    const p = iniciarTurno({ historico }, modelo, cfg)
    if (p.fim) throw new Error('x')
    return { ...p.estado, tentativa: 2 }
  }
  it('sem telefone encerra com a mensagem tecnica', () => {
    const r = falhaDeApi(est(oi), cfg)
    expect(r).toMatchObject({
      resposta: cfg.textos.falha_tecnica, proxima_acao: 'responder_e_encerrar', origem: 'falha',
      erro: true, saida: null, tentativas: 2, violacoes: [],
    })
  })
  it('com telefone encaminha para humano', () => {
    const r = falhaDeApi(est([{ role: 'user', content: 'meu zap (48) 99999-0001' }]), cfg)
    expect(r.proxima_acao).toBe('encaminhar_humano')
    expect(r.erro).toBe(true)
  })
  it('ignora numero de 4 digitos e so olha mensagens do user', () => {
    const h: Mensagem[] = [
      { role: 'user', content: 'sala 1234' },
      { role: 'assistant', content: 'ligue (48) 3364-9840' },
      { role: 'user', content: 'ok' },
    ]
    expect(falhaDeApi(est(h), cfg).proxima_acao).toBe('responder_e_encerrar')
  })
})
