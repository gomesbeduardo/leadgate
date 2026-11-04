import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carregarConfig, type Config } from '../src/config/schema'
import type { Mensagem } from '../src/validacao/contrato'
import {
  classificar,
  iniciarTurno,
  montarRequisicao,
  processarResposta,
  schemaSaida,
  type Passo,
  type Resultado,
  type Estado,
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
  const esperas: number[] = []
  while (!passo.fim) {
    requisicoes.push(montarRequisicao(passo.estado, c))
    passo = processarResposta(passo.estado, respostas[i++], c)
    if (!passo.fim) esperas.push(passo.esperar_ms)
  }
  return { resultado: passo.resultado as Resultado, requisicoes, chamadas: i, esperas }
}

const semReserva: Config = { ...cfg, ia: { ...cfg.ia, modelo_reserva: '' } }
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
    ['historico que nao alterna', { historico: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }] }],
    ['comeca pelo assistant', { historico: [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }] }],
    ['mais de 40 mensagens', { historico: Array.from({ length: 41 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x' })) }],
    ['ultima mensagem do assistant', { historico: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }],
    ['content vazio', { historico: [{ role: 'user', content: '' }] }],
    ['content longo demais', { historico: [{ role: 'user', content: 'x'.repeat(4001) }] }],
    ['nao e objeto', 'oi'],
    ['ultima do assistant com telefone', { historico: [{ role: 'user', content: '48 99999-0001' }, { role: 'assistant', content: 'x' }] }],
    ['41 mensagens alternadas mesmo apos unir', { historico: Array.from({ length: 41 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x' })) }],
    ['total de caracteres acima de 8000', { historico: Array.from({ length: 5 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(2000) })) }],
  ])('entrada invalida (%s) nao chama o modelo', (_n, entrada) => {
    const p = iniciarTurno(entrada, modelo, cfg)
    expect(p.fim).toBe(true)
    if (p.fim) {
      expect(p.resultado.tentativas).toBe(0)
      expect(p.resultado.origem).toBe('falha')
      expect(p.resultado.erro).toBe(true)
      expect(p.resultado.resposta).toBeNull()
      expect(p.resultado.conversa).toEqual([])
      expect(p.resultado.proxima_acao).toBe('responder_e_encerrar')
    }
  })
  it('T22: marcador sem valor falha a montagem e nao chama o modelo', () => {
    const p = iniciarTurno({ historico: oi }, modelo + '\n{{empresa.inexistente}}', cfg)
    expect(p.fim).toBe(true)
    if (p.fim) {
      expect(p.resultado.tentativas).toBe(0)
      expect(p.resultado.resposta).toBeNull()
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
    expect(r.max_tokens).toBe(1500)
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
    const { resultado, chamadas } = rodar(oi, [corpo('x'), corpo('y'), corpo('z')], semReserva)
    expect(chamadas).toBe(3)
    expect(resultado.tentativas).toBe(3)
    expect(resultado.resposta).toBeNull()
    expect(resultado.estado_conversa).toBe('aguardando_humano')
    expect(resultado.proxima_acao).toBe('encaminhar_humano')
    expect(resultado.origem).toBe('falha')
    expect(resultado.erro).toBe(true)
    expect(resultado.saida).toBeNull()
    expect(resultado.violacoes.length).toBeGreaterThan(0)
  })

  it('esgotado com so o telefone da empresa no texto: silencio e humano assume (camada 3 nao depende de telefone)', () => {
    const hist: Mensagem[] = [{ role: 'user', content: 'liguei no (48) 3364-9840 e ninguém atendeu' }]
    const { resultado } = rodar(hist, [corpo('x'), corpo('y'), corpo('z')])
    expect(resultado.resposta).toBeNull()
    expect(resultado.proxima_acao).toBe('encaminhar_humano')
  })

  it('T12: esgotado com telefone vai para encaminhar_humano', () => {
    const hist: Mensagem[] = [{ role: 'user', content: 'PMOC para nossa clínica em Santa Maria, 55 99999-0003' }]
    const ruim = saidaBase({
      tipo_servico: 'pmoc', segmento: 'comercial', cidade: 'Santa Maria', telefone: '55 99999-0003',
      dados_faltantes: [], qualificado: false, confianca: 0.9, proxima_acao: 'responder_e_encerrar',
      resposta: 'Obrigado pelo contato.',
    })
    const { resultado } = rodar(hist, [corpo(ruim), corpo(ruim), corpo(ruim)], semReserva)
    expect(resultado.proxima_acao).toBe('encaminhar_humano')
    expect(resultado.erro).toBe(true)
    expect(resultado.resposta).toBeNull()
    expect(resultado.conversa).toEqual(hist)
  })
})

describe('classificar', () => {
  const ok = corpo(saidaBase())
  const est = (): Estado => {
    const p = iniciarTurno({ historico: oi }, modelo, cfg)
    if (p.fim) throw new Error('x')
    return p.estado
  }
  it.each([
    [{ erro: 'connect ECONNREFUSED 1.2.3.4:443' }, 'rede'],
    [{ erro: 'read ECONNRESET' }, 'rede'],
    [{}, 'rede'],
    [{ erro: 'getaddrinfo ENOTFOUND api.anthropic.com' }, 'dns'],
    [{ erro: 'getaddrinfo EAI_AGAIN api.anthropic.com' }, 'dns'],
    [{ erro: 'connect ETIMEDOUT' }, 'timeout'],
    [{ erro: 'ECONNABORTED' }, 'timeout'],
    [{ erro: 'The connection timeout was reached' }, 'timeout'],
    [{ status: 429, corpo: {} }, '429'],
    [{ status: 500 }, '5xx'],
    [{ status: 529 }, '5xx'],
    [{ status: 599 }, '5xx'],
    ...[400, 401, 402, 403, 404, 413].map((status) => [{ status }, 'cliente']),
    [{ status: 200, corpo: corpo('x', 'refusal') }, 'refusal'],
    [{ status: 200, corpo: corpo(saidaBase(), 'max_tokens') }, 'max_tokens'],
    [{ status: 200, corpo: corpo('isto nao e json') }, 'schema'],
    [{ status: 200, corpo: corpo(invalida) }, 'schema'],
    [{ status: 200, corpo: { stop_reason: 'end_turn', content: [] } }, 'schema'],
    [{ status: 200, corpo: ok }, null],
    [ok, null],
    [{ stop_reason: 'refusal', content: [] }, 'refusal'],
  ] as [unknown, string | null][])('%j -> %s', (resposta, tipo) => {
    expect(classificar(est(), resposta, cfg).tipo).toBe(tipo)
  })
  it('stop_reason e checado antes do parse do JSON', () => {
    expect(classificar(est(), { status: 200, corpo: { stop_reason: 'refusal', content: [{ type: 'text', text: '{' }] } }, cfg).tipo).toBe('refusal')
  })
})

describe('motor de falhas', () => {
  const r5xx = { status: 503 }
  const valida = { status: 200, corpo: corpo(saidaBase()) }

  it('repete rede, dns, timeout, 429 e 5xx com a espera configurada e responde na 2a', () => {
    for (const falhou of [{ erro: 'ECONNRESET' }, { erro: 'ENOTFOUND x' }, { erro: 'ETIMEDOUT' }, { status: 429 }, { status: 529 }]) {
      const { resultado, esperas, requisicoes } = rodar(oi, [falhou, valida])
      expect(esperas).toEqual([1000])
      expect(resultado.origem).toBe('modelo')
      expect(resultado.camada).toBe(1)
      expect(resultado.modelo_respondeu).toBe('primario')
      expect(resultado.registros).toHaveLength(1)
      expect(requisicoes[1]).toEqual(requisicoes[0])
    }
  })

  it('a segunda repeticao espera espera_ms[1]', () => {
    const { esperas } = rodar(oi, [r5xx, r5xx, valida])
    expect(esperas).toEqual([1000, 3000])
  })

  it('retry-after numerico vence a espera da config, com teto de 30000', () => {
    expect(rodar(oi, [{ status: 429, cabecalhos: { 'retry-after': '7' } }, valida]).esperas).toEqual([7000])
    expect(rodar(oi, [{ status: 429, cabecalhos: { 'Retry-After': '120' } }, valida]).esperas).toEqual([30000])
    expect(rodar(oi, [{ status: 429, cabecalhos: { 'retry-after': 'amanha' } }, valida]).esperas).toEqual([1000])
  })

  it('teto de gasto: sem repeticao, vai direto a reserva', () => {
    const gasto = { status: 429, corpo: { error: { details: { error_code: 'enforced_spend_limit_reached' } } } }
    const { resultado, requisicoes, esperas } = rodar(oi, [gasto, valida])
    expect(requisicoes).toHaveLength(2)
    expect(requisicoes[0].model).toBe(cfg.ia.modelo)
    expect(requisicoes[1].model).toBe('claude-haiku-5-5')
    expect(esperas).toEqual([0])
    expect(resultado.camada).toBe(2)
  })

  it('erro de cliente nao repete e vai a reserva', () => {
    const { resultado, requisicoes } = rodar(oi, [{ status: 401 }, valida])
    expect(requisicoes).toHaveLength(2)
    expect(resultado.modelo_respondeu).toBe('reserva')
    expect(resultado.registros[0]?.tipo).toBe('cliente')
  })

  it('T11: 3 repeticoes 503 e a reserva responde (camada 2), mesmo historico e prompt', () => {
    const { resultado, requisicoes } = rodar(oi, [r5xx, r5xx, r5xx, valida])
    expect(resultado.origem).toBe('modelo')
    expect(resultado.camada).toBe(2)
    expect(resultado.modelo_respondeu).toBe('reserva')
    expect(resultado.registros.map((r) => [r.tipo, r.modelo, r.camada])).toEqual([
      ['5xx', 'primario', 1], ['5xx', 'primario', 1], ['5xx', 'primario', 1],
    ])
    expect(requisicoes[3].model).toBe('claude-haiku-5-5')
    expect(requisicoes[3].system).toBe(requisicoes[0].system)
    expect(requisicoes[3].messages).toEqual(requisicoes[0].messages)
  })

  it('T12: primario e reserva esgotados dao silencio, sem telefone', () => {
    const { resultado, chamadas } = rodar(oi, Array(6).fill(r5xx))
    expect(chamadas).toBe(6)
    expect(resultado).toMatchObject({
      resposta: null, estado_conversa: 'aguardando_humano', proxima_acao: 'encaminhar_humano',
      origem: 'falha', tipo: '5xx', erro: true, saida: null, modelo_respondeu: null, camada: 3,
    })
    expect(resultado.registros).toHaveLength(6)
    expect(resultado.registros.filter((r) => r.modelo === 'reserva')).toHaveLength(3)
  })

  it('T12: com telefone tambem e silencio', () => {
    const h: Mensagem[] = [{ role: 'user', content: 'ligue 48 99999-0001' }]
    const { resultado } = rodar(h, Array(6).fill({ erro: 'ECONNRESET' }))
    expect(resultado.resposta).toBeNull()
    expect(resultado.proxima_acao).toBe('encaminhar_humano')
    expect(resultado.tipo).toBe('rede')
  })

  it('rede esgotada sem reserva: 3 chamadas e silencio', () => {
    const { resultado, chamadas } = rodar(oi, Array(3).fill({ erro: 'ETIMEDOUT' }), semReserva)
    expect(chamadas).toBe(3)
    expect(resultado.tipo).toBe('timeout')
    expect(resultado.resposta).toBeNull()
  })

  it('T13: refusal e depois valido, com correcao', () => {
    const { resultado, requisicoes } = rodar(oi, [{ status: 200, corpo: corpo('x', 'refusal') }, valida])
    expect(resultado.origem).toBe('modelo')
    expect(resultado.tentativas).toBe(2)
    expect(resultado.registros.map((r) => r.tipo)).toEqual(['refusal'])
    expect(requisicoes[1].messages.at(-1).role).toBe('system')
  })

  it('T14: max_tokens e depois valido', () => {
    const { resultado } = rodar(oi, [{ status: 200, corpo: corpo(saidaBase(), 'max_tokens') }, valida])
    expect(resultado.origem).toBe('modelo')
    expect(resultado.registros.map((r) => r.tipo)).toEqual(['max_tokens'])
  })

  it('T15: schema x3 com reserva desligada da silencio e 3 registros schema', () => {
    const { resultado } = rodar(oi, Array(3).fill({ status: 200, corpo: corpo('desculpe, nao consigo') }), semReserva)
    expect(resultado.registros.map((r) => r.tipo)).toEqual(['schema', 'schema', 'schema'])
    expect(resultado.origem).toBe('falha')
    expect(resultado.tipo).toBe('schema')
    expect(resultado.resposta).toBeNull()
  })

  it('conteudo esgotado no primario vai a reserva com a ultima correcao e 2 regeneracoes', () => {
    const ruim = { status: 200, corpo: corpo('nao json') }
    const { resultado, requisicoes } = rodar(oi, [ruim, ruim, ruim, ruim, ruim])
    expect(requisicoes).toHaveLength(5)
    expect(requisicoes[3].model).toBe('claude-haiku-5-5')
    expect(requisicoes[3].messages.at(-1).role).toBe('system')
    expect(resultado.origem).toBe('falha')
    expect(resultado.registros.map((r) => r.modelo)).toEqual(['primario', 'primario', 'primario', 'reserva', 'reserva'])
  })

  it('reserva responde a um conteudo ruim do primario', () => {
    const ruim = { status: 200, corpo: corpo('nao json') }
    const { resultado } = rodar(oi, [ruim, ruim, ruim, valida])
    expect(resultado.modelo_respondeu).toBe('reserva')
    expect(resultado.camada).toBe(2)
  })

  it('registros nao carregam texto de mensagem nem telefone', () => {
    const h: Mensagem[] = [{ role: 'user', content: 'meu zap 48 99999-0001, Silva' }]
    const ruim = { status: 200, corpo: corpo('resposta com 48 99999-0001') }
    const { resultado } = rodar(h, [ruim, ruim, ruim, r5xx, r5xx, r5xx])
    const txt = JSON.stringify(resultado.registros)
    expect(txt).not.toMatch(/99999|Silva|zap|resposta com/)
    for (const r of resultado.registros) {
      expect(Object.keys(r).sort()).toEqual(['camada', 'modelo', 'tentativa', 'tipo', 'ts'])
    }
  })

  it('montarRequisicao usa o modelo atual', () => {
    const p = iniciarTurno({ historico: oi }, modelo, cfg)
    if (p.fim) throw new Error('x')
    expect((montarRequisicao(p.estado, cfg) as any).model).toBe(cfg.ia.modelo)
    expect((montarRequisicao({ ...p.estado, modelo_atual: 'reserva' }, cfg) as any).model).toBe('claude-haiku-5-5')
  })

  it('T24: user,user e unido por quebra de linha e o bot responde ao conjunto', () => {
    const h: Mensagem[] = [
      { role: 'user', content: 'Oi' },
      { role: 'user', content: 'alguem ai?' },
    ]
    const { resultado, requisicoes } = rodar(h, [valida])
    expect(requisicoes[0].messages).toEqual([{ role: 'user', content: 'Oi\nalguem ai?' }])
    expect(resultado.origem).toBe('modelo')
    expect(resultado.conversa).toEqual([{ role: 'user', content: 'Oi\nalguem ai?' }])
  })

  it('une user,user no meio do historico mantendo a alternancia', () => {
    const h: Mensagem[] = [
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }, { role: 'user', content: 'd' },
    ]
    const p = iniciarTurno({ historico: h }, modelo, cfg)
    expect(p.fim).toBe(false)
    if (!p.fim) expect(p.estado.historico).toHaveLength(3)
  })
})
