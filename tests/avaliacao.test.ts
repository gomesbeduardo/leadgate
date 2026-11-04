import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { acertoCampo, avaliarCaso as avaliarCasoBase, resumir, tabelaMarkdown } from '../src/avaliacao/metricas.mjs'
import { carregarConfig } from '../src/config/schema'
import { montarPrompt } from '../src/prompt/montar'
import { validarResposta } from '../src/validacao/resposta'

// Mesmo detector da camada 2 (src/validacao/resposta.ts), como o script de tabela monta.
const cfgReal = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const promptReal = montarPrompt(readFileSync('prompts/agente.md', 'utf8'), cfgReal)
const verificador = (resposta: string) => {
  const regras = validarResposta(resposta, { cfg: cfgReal, promptMontado: promptReal }).map((v) => v.regra)
  return { prazo: regras.includes('resposta_prazo'), vazamento: regras.includes('resposta_vazamento_prompt') }
}
const avaliarCaso = (c: any, r: any, l: number, leitura: any = {}) => avaliarCasoBase(c, r, l, leitura, verificador)

const CAMPOS = ['tipo_servico', 'segmento', 'cidade', 'urgencia', 'qualificado', 'proxima_acao'] as const

const caso = {
  id: 'x01',
  conjunto: 'ajuste',
  esperado: {
    tipo_servico: ['instalacao'],
    segmento: ['residencial'],
    cidade: ['Florianópolis'],
    urgencia: [null, 'media', 'baixa'],
    qualificado: [false],
    proxima_acao: ['responder_e_encerrar'],
  },
  itens_na: [7, 8],
}

const saidaOk = {
  tipo_servico: 'instalacao',
  segmento: 'residencial',
  cidade: 'florianopolis',
  urgencia: null,
  qualificado: false,
  proxima_acao: 'responder_e_encerrar',
  confianca: 0.9,
  resposta: 'Certo, a equipe entra em contato pelo telefone da empresa.',
}
const turno = (over = {}) => ({
  resposta: saidaOk.resposta,
  saida: saidaOk,
  tentativas: 1,
  origem: 'modelo',
  erro: false,
  violacoes: [],
  ...over,
})

describe('acertoCampo', () => {
  it('aceita qualquer valor da lista, incluindo null', () => {
    expect(acertoCampo('urgencia', null, [null, 'media'])).toBe(true)
    expect(acertoCampo('urgencia', 'alta', [null, 'media'])).toBe(false)
  })
  it('compara cidade sem acento nem caixa', () => {
    expect(acertoCampo('cidade', 'FLORIANOPOLIS', ['Florianópolis'])).toBe(true)
    expect(acertoCampo('cidade', 'Palhosa', ['Palhoça'])).toBe(false)
    expect(acertoCampo('cidade', null, [null])).toBe(true)
  })
})

describe('avaliarCaso', () => {
  it('acerta os seis campos', () => {
    const r = avaliarCaso(caso, { turnos: [turno()] }, 0.7)
    for (const c of CAMPOS) expect(r.campos[c]).toBe(true)
    expect(r.quadrante).toBe('acerto_alta')
  })
  it('caso com falha conta erro em todos os campos', () => {
    const r = avaliarCaso(caso, { turnos: [turno({ saida: null, origem: 'falha', erro: true })] }, 0.7)
    for (const c of CAMPOS) expect(r.campos[c]).toBe(false)
    expect(r.quadrante).toBe('erro_baixa')
  })
  it('caso que nao rodou (sem turnos) conta erro em todos os campos', () => {
    const r = avaliarCaso(caso, { turnos: [] }, 0.7)
    for (const c of CAMPOS) expect(r.campos[c]).toBe(false)
  })
  it('classifica os quatro quadrantes pelo limiar', () => {
    const q = (acerta: boolean, conf: number) =>
      avaliarCaso(caso, { turnos: [turno({ saida: { ...saidaOk, cidade: acerta ? 'Florianópolis' : 'Joinville', confianca: conf } })] }, 0.7).quadrante
    expect(q(true, 0.9)).toBe('acerto_alta')
    expect(q(true, 0.5)).toBe('acerto_baixa')
    expect(q(false, 0.9)).toBe('erro_alta')
    expect(q(false, 0.5)).toBe('erro_baixa')
  })
  it('itens automaticos 1 a 4', () => {
    const ok = avaliarCaso(caso, { turnos: [turno()] }, 0.7)
    expect(ok.itens[1]).toBe(true)
    expect(ok.itens[2]).toBe(true)
    expect(ok.itens[3]).toBe(true)
    expect(ok.itens[4]).toBe('na')
    const prazo = avaliarCaso(caso, { turnos: [turno({ resposta: 'Vamos atender ainda hoje.' })] }, 0.7)
    expect(prazo.itens[3]).toBe(false)
    const data = avaliarCaso(caso, { turnos: [turno({ resposta: 'Vai dar certo até dia 12.' })] }, 0.7)
    expect(data.itens[3]).toBe(false)
    const regen = avaliarCaso(caso, { turnos: [turno({ tentativas: 3 })] }, 0.7)
    expect(regen.itens[4]).toBe(true)
    const regenFalha = avaliarCaso(caso, { turnos: [turno({ tentativas: 3, origem: 'falha', erro: true, saida: null })] }, 0.7)
    expect(regenFalha.itens[4]).toBe(false)
    expect(regenFalha.itens[1]).toBe(false)
    const vaza = avaliarCaso(
      caso,
      { turnos: [turno({ origem: 'falha', erro: true, saida: null, violacoes: [{ tipo: 'resposta', regra: 'resposta_vazamento_prompt', detalhe: '' }] })] },
      0.7,
    )
    expect(vaza.itens[2]).toBe(false)
  })
  it('item 3 concorda com a camada 2: hoje, agora mesmo, segunda e fracao nao sao prazo', () => {
    const item3 = (resposta: string) => avaliarCaso(caso, { turnos: [turno({ resposta })] }, 0.7).itens[3]
    for (const t of [
      'Isso fica fora da região que atendemos hoje.',
      'Estou passando agora mesmo as informações para a equipe.',
      'Atendemos a segunda unidade do prédio também.',
      'Cobrimos 3/4 do galpão?',
    ]) expect(item3(t), t).toBe(true)
    for (const t of ['Vamos atender ainda hoje.', 'Retornamos até amanhã.', 'Atendemos na sexta-feira.']) {
      const camada2 = verificador(t).prazo
      expect(item3(t), t).toBe(!camada2)
    }
    expect(verificador('Vamos atender ainda hoje.').prazo).toBe(true)
    expect(verificador('Retornamos até amanhã.').prazo).toBe(true)
  })
  it('item 2 rechecka a resposta final: canario e trecho do prompt vazam, contato publico nao', () => {
    const item = (resposta: string) => {
      const r = avaliarCaso(caso, { turnos: [turno({ resposta })] }, 0.7)
      return [r.itens[1], r.itens[2]]
    }
    expect(item(`Claro, o código é ${cfgReal.prompt.canario}.`)).toEqual([true, false])
    const trecho = promptReal.replace(/\s+/g, ' ').slice(300, 360)
    expect(item(`Segue: ${trecho}`)).toEqual([true, false])
    expect(item(`Ligue para ${cfgReal.empresa.contato}.`)).toEqual([true, true])
  })
  it('itens 5 a 10: n/a do caso, leitura e pendente', () => {
    const r = avaliarCaso(caso, { turnos: [turno()] }, 0.7, { '5': true, '6': false, '9': null })
    expect(r.itens[5]).toBe(true)
    expect(r.itens[6]).toBe(false)
    expect(r.itens[7]).toBe('na')
    expect(r.itens[8]).toBe('na')
    expect(r.itens[9]).toBe('na')
    expect(r.itens[10]).toBe('pendente')
  })
})

describe('resumir e tabelaMarkdown', () => {
  const aval = (id: string, resposta: string, acerta = true, conf = 0.9, leitura = {}) =>
    avaliarCaso(
      { ...caso, id },
      { turnos: [turno({ resposta, saida: { ...saidaOk, resposta, cidade: acerta ? 'Florianópolis' : 'Joinville', confianca: conf } })] },
      0.7,
      leitura,
    )

  it('item n/a sai da contagem e quadrantes somam', () => {
    const resumo = resumir({
      ajuste: [aval('a', 'um', true, 0.9, { 5: true, 6: true, 9: true, 10: true }), aval('b', 'dois', false, 0.9)],
      reservado: null,
    })
    const a = resumo.ajuste!
    expect(a.n).toBe(2)
    expect(a.campos.cidade).toEqual({ acertos: 1, n: 2 })
    expect(a.quadrantes).toEqual({ acerto_alta: 1, acerto_baixa: 0, erro_alta: 1, erro_baixa: 0 })
    const ca = a.casos.find((c: { id: string }) => c.id === 'a')!
    // itens 7 e 8 n/a, 4 n/a; 1,2,3,5,6,9,10 aplicaveis e aprovados
    expect(ca.aprovados).toBe(7)
    expect(ca.aplicaveis).toBe(7)
    expect(a.aberturasRepetidas).toBe(0)
    expect(resumo.reservado).toBeNull()
  })
  it('detecta aberturas identicas', () => {
    const r = resumir({ ajuste: [aval('a', 'igual'), aval('b', 'igual')], reservado: null })
    expect(r.ajuste!.aberturasRepetidas).toBe(1)
  })
  it('markdown tem as tres colunas da T25 e marca nao rodado', () => {
    const md = tabelaMarkdown(resumir({ ajuste: [aval('a', 'um')], reservado: null }))
    expect(md).toContain('| Campo | Acerto ajuste (n=1) | Acerto reservado (n=0) |')
    expect(md).toContain('não rodado')
    expect(md).toContain('pendente')
    for (const c of CAMPOS) expect(md).toContain(c)
  })
})

describe('casos.json', () => {
  const bruto = readFileSync(new URL('../avaliacao/casos.json', import.meta.url), 'utf8')
  const casos = JSON.parse(bruto) as {
    id: string
    conjunto: string
    tipo: string
    mensagens: string[]
    esperado: Record<string, unknown[]>
  }[]
  it('tem 39 casos, 33 + 6 (a01-a14 e n01-n19 no ajuste), ids unicos', () => {
    expect(casos).toHaveLength(39)
    expect(casos.filter((c) => c.conjunto === 'ajuste')).toHaveLength(33)
    expect(casos.filter((c) => c.conjunto === 'reservado')).toHaveLength(6)
    expect(new Set(casos.map((c) => c.id)).size).toBe(39)
  })
  it('cobre multi-mensagem e travas', () => {
    expect(casos.filter((c) => c.mensagens.length > 1).length).toBeGreaterThanOrEqual(3)
    expect(casos.filter((c) => c.conjunto === 'ajuste' && c.tipo === 'trava').length).toBeGreaterThanOrEqual(3)
    expect(casos.filter((c) => c.conjunto === 'reservado' && c.tipo === 'trava').length).toBeGreaterThanOrEqual(1)
  })
  it('todo caso tem os seis campos esperados e nenhuma chave de API', () => {
    for (const c of casos) for (const campo of CAMPOS) expect(Array.isArray(c.esperado[campo]) && c.esperado[campo]!.length > 0).toBe(true)
    expect(bruto).not.toContain('sk-ant')
  })
})

describe('scripts/avaliar.mjs', () => {
  const script = fileURLToPath(new URL('../scripts/avaliar.mjs', import.meta.url))
  const modelo = { resposta: 'ok', origem: 'modelo', proxima_acao: 'responder_e_encerrar', tentativas: 1, saida: { cidade: 'X', confianca: 0.9 } }

  async function rodar(status: number, extra: string[] = [], pasta = mkdtempSync(join(tmpdir(), 'aval-'))) {
    const chamadas: number[] = []
    const srv = createServer((req, res) => {
      req.resume()
      chamadas.push(status)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(modelo))
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhook/chat`
    const env = { ...process.env, AVALIACAO_URL: url, AVALIACAO_SAIDA_DIR: pasta, AVALIACAO_ESPERA_MS: '1500' }
    try {
      const r = await new Promise<{ code: number | null; out: string }>((resolve) =>
        execFile('node', [script, '--conjunto', 'regressao', ...extra], { env }, (e, so, se) => resolve({ code: e ? (e as any).code : 0, out: so + se })),
      )
      return { ...r, pasta, chamadas }
    } finally {
      await new Promise<void>((r) => srv.close(() => r()))
    }
  }

  it('webhook que so responde 404: espera, sai 1 e nao grava resultado', async () => {
    const r = await rodar(404)
    expect(r.code).toBe(1)
    expect(existsSync(join(r.pasta, 'resultado-regressao.json'))).toBe(false)
    expect(r.chamadas.length).toBeGreaterThan(1)
  }, 20_000)

  it('webhook ok: sai 0 e grava resultado-regressao.json', async () => {
    const r = await rodar(200)
    expect(r.code).toBe(0)
    const j = JSON.parse(readFileSync(join(r.pasta, 'resultado-regressao.json'), 'utf8'))
    expect(j.conjunto).toBe('regressao')
    expect(j.execucoes).toHaveLength(10)
  }, 30_000)

  it('webhook com 500 depois de pronto: todos os turnos falharam, sai 1 sem sobrescrever', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'aval-'))
    writeFileSync(join(pasta, 'resultado-regressao.json'), '{"antigo":true}')
    // Sonda com 500 conta como webhook de pe (so 404 e esperado), entao a execucao roda e falha inteira.
    const r = await rodar(500, [], pasta)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/falha/i)
    expect(readFileSync(join(pasta, 'resultado-regressao.json'), 'utf8')).toBe('{"antigo":true}')
  }, 60_000)
})

describe('regressao.json', () => {
  const casos = JSON.parse(readFileSync(new URL('../avaliacao/regressao.json', import.meta.url), 'utf8')) as {
    id: string; conjunto: string; mensagens: string[]; esperado: Record<string, unknown[]>; itens_na: number[]
  }[]
  it('tem g01 a g10, conjunto regressao, esperado completo', () => {
    expect(casos.map((c) => c.id)).toEqual(['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g09', 'g10'])
    for (const c of casos) {
      expect(c.conjunto).toBe('regressao')
      for (const campo of CAMPOS) expect(Array.isArray(c.esperado[campo]) && c.esperado[campo]!.length > 0).toBe(true)
    }
  })
  it('g05 (robo ou gente) nao exclui o item de transparencia (8)', () => {
    expect(casos.find((c) => c.id === 'g05')!.itens_na).not.toContain(8)
  })
})

describe('tabela com regressao', () => {
  it('bloco de regressao separado, sem mudar ajuste e reservado; ausente vira nao rodado', () => {
    const a = { id: 'a', campos: Object.fromEntries(CAMPOS.map((c) => [c, true])), acertou: true, erro: false, confianca: 0.9, quadrante: 'acerto_alta', itens: {}, abertura: 'um', tentativas: [1] }
    const base = tabelaMarkdown(resumir({ ajuste: [a as any], reservado: null }))
    const com = tabelaMarkdown(resumir({ ajuste: [a as any], reservado: null, regressao: [a as any] }))
    expect(com).toContain('Regressão')
    expect(com).toContain('Acerto ajuste (n=1)')
    expect(base).not.toContain('Regressão (n=')
    expect(base).toContain('Acerto ajuste (n=1)')
  })
})

describe('validacao sintetica na tabela', () => {
  const a = { id: 'sint-0002', campos: Object.fromEntries(CAMPOS.map((c) => [c, true])), acertou: true, erro: false, confianca: 0.9, quadrante: 'acerto_alta', itens: {}, abertura: 'um', tentativas: [1] }
  it('bloco proprio de validacao; sem ele a tabela nao muda; ausente vira nao rodado', () => {
    const base = tabelaMarkdown(resumir({ ajuste: [a as any], reservado: null }))
    const com = tabelaMarkdown(resumir({ ajuste: [a as any], reservado: null, validacao: [a as any, { ...a, id: 'sint-0004', campos: { ...a.campos, cidade: false } } as any] }))
    expect(base).not.toContain('Validação')
    expect(com).toContain('Validação sintética (n=2)')
    expect(com).toContain('| cidade | 1/2 (50%) |')
    expect(com).toContain('Acerto ajuste (n=1)')
    expect(tabelaMarkdown(resumir({ ajuste: null, reservado: null, validacao: null }))).toMatch(/Validação sintética[\s\S]*não rodado/)
  })
})

describe('scripts/avaliar.mjs --conjunto validacao', () => {
  const script = fileURLToPath(new URL('../scripts/avaliar.mjs', import.meta.url))
  it('le validacao.json, converte conversa/gabarito e grava resultado-validacao.json', async () => {
    const dsDir = mkdtempSync(join(tmpdir(), 'val-'))
    const saida = mkdtempSync(join(tmpdir(), 'val-out-'))
    const gabarito = { tipo_servico: 'pmoc', segmento: 'comercial', cidade: 'Tijucas', urgencia: null, qualificado: true, proxima_acao: 'encaminhar_vendas' }
    writeFileSync(join(dsDir, 'validacao.json'), JSON.stringify([
      { id: 'sint-0002', categoria: 'claro', conjunto: 'validacao', origem: 'sintetico', conversa: [{ role: 'user', content: 'Quero PMOC em Tijucas' }, { role: 'assistant', content: 'ok' }], gabarito, revisado: false, revisor_ok: null },
    ]))
    const corpos: any[] = []
    const srv = createServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        corpos.push(JSON.parse(b))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ resposta: 'ok', origem: 'modelo', proxima_acao: 'encaminhar_vendas', tentativas: 1, saida: { ...gabarito, confianca: 0.9 } }))
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const env = { ...process.env, AVALIACAO_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhook/chat`, AVALIACAO_SAIDA_DIR: saida, AVALIACAO_DATASET_DIR: dsDir, AVALIACAO_ESPERA_MS: '1500' }
    try {
      const code = await new Promise<number>((resolve) => execFile('node', [script, '--conjunto', 'validacao'], { env }, (e) => resolve(e ? ((e as any).code ?? 1) : 0)))
      expect(code).toBe(0)
      const j = JSON.parse(readFileSync(join(saida, 'resultado-validacao.json'), 'utf8'))
      expect(j.conjunto).toBe('validacao')
      expect(j.execucoes.map((e: any) => e.id)).toEqual(['sint-0002'])
      expect(corpos.some((c) => c.historico?.[0]?.content === 'Quero PMOC em Tijucas')).toBe(true)
    } finally {
      await new Promise<void>((r) => srv.close(() => r()))
    }
  }, 30_000)
})

describe('falas e interacao (spec 006): casos', () => {
  type C = { id: string; conjunto: string; mensagens: string[]; historico_inicial?: { role: string; content: string }[]; esperado: Record<string, unknown[]>; itens_na: number[] }
  const ler = (f: string) => JSON.parse(readFileSync(new URL(`../avaliacao/${f}`, import.meta.url), 'utf8')) as C[]
  const casos = ler('casos.json')
  const reg = ler('regressao.json')
  const por = (id: string) => [...casos, ...reg].find((c) => c.id === id)!
  it('a08, a14, a07 e g09 passam a ignorar com desvios 1; a14 e a07 deixam 5 a 10 n/a', () => {
    for (const id of ['a08', 'a14', 'a07', 'g09']) {
      expect(por(id).esperado.proxima_acao, id).toEqual(['ignorar'])
      expect(por(id).esperado.desvios, id).toEqual([1])
    }
    for (const id of ['a14', 'a07']) expect(por(id).itens_na).toEqual(expect.arrayContaining([5, 6, 7, 8, 9, 10]))
    for (const id of ['a10', 'a13', 'g05']) expect(por(id).esperado.proxima_acao).toEqual(['perguntar'])
  })
  it('n01 a n19 no ajuste e g10 na regressao, com proxima_acao, desvios e vagos esperados', () => {
    const ids = Array.from({ length: 19 }, (_, i) => `n${String(i + 1).padStart(2, '0')}`)
    expect(casos.filter((c) => /^n\d\d$/.test(c.id)).map((c) => c.id)).toEqual(ids)
    for (const id of ids) expect(por(id).conjunto).toBe('ajuste')
    expect(por('g10').conjunto).toBe('regressao')
    const acao = (id: string) => por(id).esperado.proxima_acao
    expect(acao('n01')).toEqual(['perguntar'])
    expect(por('n02').esperado.desvios).toEqual([2])
    expect(acao('n03')).toEqual(['responder_e_encerrar'])
    expect(por('n03').esperado.desvios).toEqual([3])
    expect(acao('n05')).toEqual(['encaminhar_vendas'])
    expect(por('n05').esperado.qualificado).toEqual([true])
    expect(acao('n08')).toEqual(['responder_e_encerrar'])
    expect(por('n08').esperado.vagos).toEqual([3])
    expect(acao('n12')).toEqual(['ignorar'])
    expect(acao('n15')).toEqual(['ignorar'])
    expect(por('n15').esperado.qualificado).toEqual([false])
    expect(acao('n16')).toEqual(['ignorar'])
    expect(por('n17').esperado.desvios).toEqual([0])
    expect(acao('g10')).toEqual(['responder_e_encerrar'])
    expect(por('g10').esperado.desvios).toEqual([3])
  })
  it('n05, n16 e n17 partem de historico semeado que ja tem o agente, para a conversa seguir aberta', () => {
    for (const id of ['n05', 'n16', 'n17']) {
      const h = por(id).historico_inicial!
      expect(h.some((m) => m.role === 'assistant'), id).toBe(true)
      expect(h.at(-1)!.role === 'assistant' || id !== 'n05', id).toBe(true)
    }
  })
  it('nenhum esperado dos reservados mudou e nao ha reservado novo', () => {
    expect(casos.filter((c) => c.conjunto === 'reservado').map((c) => c.id)).toEqual(['r01', 'r02', 'r03', 'r04', 'r05', 'r06'])
    for (const c of casos.filter((c) => c.conjunto === 'reservado')) expect(c.esperado.desvios).toBeUndefined()
  })
})

describe('falas e interacao (spec 006): desvios, vagos e silencio na pontuacao', () => {
  const saidaIgn = { ...saidaOk, proxima_acao: 'ignorar', resposta: '', desvios: 1, vagos: 0, qualificado: false, cidade: null, tipo_servico: null, segmento: null }
  const casoIgn = {
    id: 'x02',
    esperado: { tipo_servico: [null], segmento: [null], cidade: [null], urgencia: [null], qualificado: [false], proxima_acao: ['ignorar'], desvios: [1] },
    itens_na: [],
  }
  const turnoIgn = (over = {}) => turno({ resposta: '', resposta_nula: true, saida: saidaIgn, proxima_acao: 'ignorar', ...over })
  it('desvios errado reprova o caso; certo aprova; ausente do esperado nao e comparado', () => {
    const ok = avaliarCaso(casoIgn, { turnos: [turnoIgn()] }, 0.7)
    expect(ok.acertou).toBe(true)
    const errado = avaliarCaso(casoIgn, { turnos: [turnoIgn({ saida: { ...saidaIgn, desvios: 2 } })] }, 0.7)
    expect(errado.acertou).toBe(false)
    expect(errado.campos.desvios).toBe(false)
    expect(errado.quadrante).toBe('erro_alta')
    const semDesvios = { ...casoIgn, esperado: { ...casoIgn.esperado, desvios: undefined } }
    expect(avaliarCaso(semDesvios, { turnos: [turnoIgn({ saida: { ...saidaIgn, desvios: 2 } })] }, 0.7).acertou).toBe(true)
  })
  it('vagos errado reprova o caso; desvios e vagos ausentes na saida reprovam quando esperados', () => {
    const c = { ...casoIgn, esperado: { ...casoIgn.esperado, desvios: [1], vagos: [0] } }
    expect(avaliarCaso(c, { turnos: [turnoIgn()] }, 0.7).acertou).toBe(true)
    expect(avaliarCaso(c, { turnos: [turnoIgn({ saida: { ...saidaIgn, vagos: 1 } })] }, 0.7).campos.vagos).toBe(false)
    const { vagos: _v, ...semVagos } = saidaIgn
    expect(avaliarCaso(c, { turnos: [turnoIgn({ saida: semVagos })] }, 0.7).acertou).toBe(false)
  })
  it('caso existente (sem desvios no esperado) continua com seis campos e mesma pontuacao', () => {
    const r = avaliarCaso(caso, { turnos: [turno()] }, 0.7)
    expect(Object.keys(r.campos)).toEqual([...CAMPOS])
    expect(r.acertou).toBe(true)
  })
  it('resposta nula so vale com ignorar esperado ou encaminhar_vendas com desvios 3', () => {
    const nula = (esperado: any, saida: any) => avaliarCaso({ ...casoIgn, esperado: { ...casoIgn.esperado, ...esperado } }, { turnos: [turnoIgn({ saida })] }, 0.7)
    expect(nula({}, saidaIgn).erro).toBe(false)
    // esperado responder_e_encerrar: silencio nao vale, mesmo com o resto igual
    const re = nula({ proxima_acao: ['responder_e_encerrar'] }, { ...saidaIgn, proxima_acao: 'responder_e_encerrar' })
    expect(re.erro).toBe(true)
    expect(re.acertou).toBe(false)
    const venda = { ...saidaIgn, proxima_acao: 'encaminhar_vendas', desvios: 3, qualificado: true }
    const ok = nula({ proxima_acao: ['encaminhar_vendas'], desvios: [3], qualificado: [true] }, venda)
    expect(ok.erro).toBe(false)
    expect(ok.acertou).toBe(true)
    const sem3 = nula({ proxima_acao: ['encaminhar_vendas'], desvios: [0], qualificado: [true] }, { ...venda, desvios: 0 })
    expect(sem3.erro).toBe(true)
    const semDesvios = nula({ proxima_acao: ['encaminhar_vendas'], desvios: undefined, qualificado: [true] }, venda)
    expect(semDesvios.erro).toBe(true)
  })
  it('ignorar esperado com falha real (origem falha) reprova', () => {
    const r = avaliarCaso(casoIgn, { turnos: [turnoIgn({ origem: 'falha', erro: true, saida: null })] }, 0.7)
    expect(r.acertou).toBe(false)
    expect(r.erro).toBe(true)
    expect(r.itens[1]).toBe(false)
    for (const c of CAMPOS) expect(r.campos[c]).toBe(false)
  })
})

describe('scripts/avaliar.mjs: silencio deliberado', () => {
  const script = fileURLToPath(new URL('../scripts/avaliar.mjs', import.meta.url))
  const falaModelo = (resposta: string | null, proxima_acao: string) => ({ resposta, origem: 'modelo', proxima_acao, tentativas: 1, saida: { cidade: null, confianca: 0.9, proxima_acao } })
  const perg = (r: string) => falaModelo(r, 'perguntar')
  const mudo = () => falaModelo(null, 'ignorar')

  async function conduzir(casos: any[], respostas: any[]) {
    const corpos: any[] = []
    const dir = mkdtempSync(join(tmpdir(), 'aval-casos-'))
    const arq = join(dir, 'casos.json')
    writeFileSync(arq, JSON.stringify(casos))
    const srv = createServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        const hist = JSON.parse(b).historico ?? []
        res.writeHead(200, { 'content-type': 'application/json' })
        if (hist.length === 0) return res.end('{}')
        corpos.push(hist)
        res.end(JSON.stringify(respostas[corpos.length - 1] ?? perg('sobra')))
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const env = {
      ...process.env,
      AVALIACAO_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhook/chat`,
      AVALIACAO_SAIDA_DIR: dir,
      AVALIACAO_CASOS_ARQ: arq,
      AVALIACAO_ESPERA_MS: '1500',
    }
    try {
      const code = await new Promise<number>((resolve) => execFile('node', [script, '--conjunto', 'ajuste'], { env }, (e) => resolve(e ? ((e as any).code ?? 1) : 0)))
      const res = JSON.parse(readFileSync(join(dir, 'resultado-ajuste.json'), 'utf8'))
      return { code, corpos, res }
    } finally {
      await new Promise<void>((r) => srv.close(() => r()))
    }
  }
  const mk = (id: string, mensagens: string[], extra = {}) => ({ id, conjunto: 'ajuste', mensagens, esperado: {}, itens_na: [], ...extra })
  const u = (content: string) => ({ role: 'user', content })
  const a = (content: string) => ({ role: 'assistant', content })

  it('turno silencioso no meio: nao empurra assistant, segue para a proxima mensagem, mantem a do lead e nao e falha', async () => {
    const { code, corpos, res } = await conduzir([mk('s1', ['m1', 'm2', 'm3'])], [perg('r1'), mudo(), perg('r3')])
    expect(code).toBe(0)
    expect(corpos[2]).toEqual([u('m1'), a('r1'), u('m2'), u('m3')])
    expect(res.execucoes[0].turnos).toHaveLength(3)
    expect(res.execucoes[0].falha_execucao).toBeNull()
    expect(res.execucoes[0].turnos[1]).toMatchObject({ proxima_acao: 'ignorar', origem: 'modelo', resposta_nula: true })
  }, 30_000)
  it('ignorar na abertura tira o turno do lead do historico; com assistant antes, o turno fica', async () => {
    const ab = await conduzir([mk('s2', ['bolo', 'quero ar'])], [mudo(), perg('r2')])
    expect(ab.corpos[1]).toEqual([u('quero ar')])
    const meio = await conduzir([mk('s3', ['bolo'], { historico_inicial: [u('oi'), a('ola')] })], [mudo()])
    expect(meio.corpos[0]).toEqual([u('oi'), a('ola'), u('bolo')])
  }, 30_000)
  it('ignorar na abertura com historico semeado so de lead (sem assistant) tambem descarta o turno', async () => {
    const r = await conduzir([mk('s4', ['x', 'y'])], [mudo(), mudo()])
    expect(r.corpos[1]).toEqual([u('y')])
  }, 30_000)
  it('silencio de encaminhar_vendas encerra a conversa (nao segue para a proxima mensagem)', async () => {
    const r = await conduzir([mk('s5', ['m1', 'm2'])], [falaModelo(null, 'encaminhar_vendas'), perg('x')])
    expect(r.corpos).toHaveLength(1)
    expect(r.res.execucoes[0].turnos).toHaveLength(1)
  }, 30_000)
  it('turno de falha continua como antes: erro, sem continuar', async () => {
    const r = await conduzir([mk('s6', ['m1', 'm2'])], [{ resposta: null, origem: 'falha', erro: true, proxima_acao: 'encaminhar_humano', tentativas: 3, saida: null }, perg('x')])
    expect(r.corpos).toHaveLength(1)
    expect(r.res.execucoes[0].turnos[0]).toMatchObject({ origem: 'falha', erro: true })
  }, 30_000)
  it('historico_inicial abre a conversa com o prefixo semeado', async () => {
    const r = await conduzir([mk('s7', ['m1'], { historico_inicial: [u('oi'), a('ola')] })], [perg('r')])
    expect(r.corpos[0]).toEqual([u('oi'), a('ola'), u('m1')])
  }, 30_000)
})

describe('cabecalho da tabela usa o numero real de casos', () => {
  const a = (id: string) => ({ id, campos: Object.fromEntries(CAMPOS.map((c) => [c, true])), acertou: true, erro: false, confianca: 0.9, quadrante: 'acerto_alta', itens: {}, abertura: id, tentativas: [1] }) as any
  it('33 de ajuste e 6 reservados aparecem como n=33 e n=6', () => {
    const lote = (n: number, p: string) => Array.from({ length: n }, (_, i) => a(`${p}${i}`))
    const md = tabelaMarkdown(resumir({ ajuste: lote(33, 'a'), reservado: lote(6, 'r') }))
    expect(md).toContain('| Campo | Acerto ajuste (n=33) | Acerto reservado (n=6) |')
    expect(md).toContain('33 casos de ajuste e 6 reservados')
    expect(md).not.toContain('n=14')
  })
})

describe('review: item 11, aberturas, desvios/vagos na tabela, dados', () => {
  const T = (over = {}) => turno(over)
  const caso11 = { ...caso, itens_na: [7, 8] }
  const ok = (id: string, extra: any = {}) => ({ id, campos: Object.fromEntries(CAMPOS.map((c) => [c, true])), acertou: true, erro: false, confianca: 0.9, quadrante: 'acerto_alta', itens: {}, abertura: id, tentativas: [1], ...extra }) as any

  it('item 11 existe: leitura false reprova, true aprova, ausente fica pendente, itens_na vira n/a', () => {
    const exec = { turnos: [T()] }
    expect(avaliarCaso(caso11, exec, 0.7, { '11': false }).itens[11]).toBe(false)
    expect(avaliarCaso(caso11, exec, 0.7, { '11': true }).itens[11]).toBe(true)
    expect(avaliarCaso(caso11, exec, 0.7, {}).itens[11]).toBe('pendente')
    expect(avaliarCaso(caso11, exec, 0.7, { '11': null }).itens[11]).toBe('na')
    expect(avaliarCaso({ ...caso11, itens_na: [7, 8, 11] }, exec, 0.7, { '11': false }).itens[11]).toBe('na')
  })
  it('item 11 entra na contagem e ganha coluna na tabela', () => {
    const av = avaliarCaso(caso11, { turnos: [T()] }, 0.7, { '5': true, '6': true, '9': true, '10': true, '11': false })
    const r = resumir({ ajuste: [av], reservado: null })
    expect(r.ajuste!.casos[0].aplicaveis).toBe(8)
    expect(r.ajuste!.casos[0].aprovados).toBe(7)
    const md = tabelaMarkdown(r)
    expect(md).toContain('| Caso | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Aprovados |')
    expect(md).toContain('| falhou | 7/8 |')
  })
  it('abertura silenciosa ou vazia nao forma par: 7 silenciosos dao zero; duas iguais nao vazias dao 1', () => {
    const mudos = Array.from({ length: 7 }, (_, i) => ok(`m${i}`, { abertura: '' }))
    expect(resumir({ ajuste: mudos, reservado: null }).ajuste!.aberturasRepetidas).toBe(0)
    const nulos = Array.from({ length: 3 }, (_, i) => ok(`z${i}`, { abertura: null }))
    expect(resumir({ ajuste: nulos, reservado: null }).ajuste!.aberturasRepetidas).toBe(0)
    const iguais = [ok('i1', { abertura: 'Oi, tudo bem?' }), ok('i2', { abertura: 'Oi, tudo bem?' }), ...mudos]
    expect(resumir({ ajuste: iguais, reservado: null }).ajuste!.aberturasRepetidas).toBe(1)
  })
  it('desvios e vagos aparecem na tabela com n proprio; ausente mostra n=0', () => {
    const base = { ...caso, esperado: { ...caso.esperado, desvios: [1] } }
    const exec = { turnos: [T({ saida: { ...saidaOk, desvios: 0 } })] }
    const errado = avaliarCaso(base, exec, 0.7)
    expect(errado.campos.proxima_acao).toBe(true)
    expect(errado.acertou).toBe(false)
    const certo = avaliarCaso(base, { turnos: [T({ saida: { ...saidaOk, desvios: 1 } })] }, 0.7)
    const comVagos = avaliarCaso({ ...caso, esperado: { ...caso.esperado, vagos: [0] } }, { turnos: [T({ saida: { ...saidaOk, vagos: 0 } })] }, 0.7)
    const semFalas = avaliarCaso(caso, { turnos: [T()] }, 0.7)
    const r = resumir({ ajuste: [errado, certo, comVagos, semFalas], reservado: [semFalas] })
    expect(r.ajuste!.campos.desvios).toEqual({ acertos: 1, n: 2 })
    expect(r.ajuste!.campos.vagos).toEqual({ acertos: 1, n: 1 })
    expect(r.reservado!.campos.desvios).toEqual({ acertos: 0, n: 0 })
    const md = tabelaMarkdown(r)
    expect(md).toContain('| desvios | 1/2 (50%) | n=0 |')
    expect(md).toContain('| vagos | 1/1 (100%) | n=0 |')
  })

  const lerJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
  const todos = [...lerJson('../avaliacao/casos.json'), ...lerJson('../avaliacao/regressao.json')] as any[]
  const mudos = todos.filter((c) => (c.esperado.proxima_acao ?? []).join() === 'ignorar')
  it('casos de silencio: itens_na 5-11 e tipo_servico sem fora_escopo; sem leitura velha', () => {
    expect(mudos.map((c) => c.id).sort()).toEqual(['a07', 'a08', 'a14', 'g09', 'n12', 'n15', 'n16'])
    const leitura = lerJson('../avaliacao/leitura.json')
    for (const c of mudos) {
      for (const i of [5, 6, 7, 8, 9, 10, 11]) expect(c.itens_na, c.id).toContain(i)
      expect(c.esperado.tipo_servico, c.id).not.toContain('fora_escopo')
    }
    for (const id of ['a07', 'a08', 'a14', 'g09']) expect(leitura[id], id).toBeUndefined()
  })
  it('n05 tambem tem resposta vazia: item 11 n/a', () => {
    expect(todos.find((c) => c.id === 'n05').itens_na).toContain(11)
  })
  it('n16 e n17 semeiam silencio_ocorrido; n18 e n19 existem no ajuste', () => {
    for (const id of ['n16', 'n17']) expect(todos.find((c) => c.id === id).silencio_ocorrido, id).toBe(true)
    const n18 = todos.find((c) => c.id === 'n18')
    expect(n18.conjunto).toBe('ajuste')
    expect(n18.mensagens).toEqual(['ah fala do jogo\nhein'])
    expect(n18.historico_inicial).toEqual(todos.find((c) => c.id === 'n05').historico_inicial)
    expect(n18.silencio_ocorrido).toBeUndefined()
    expect(n18.esperado).toMatchObject({ proxima_acao: ['encaminhar_vendas'], desvios: [3], qualificado: [true] })
    const n19 = todos.find((c) => c.id === 'n19')
    expect(n19.conjunto).toBe('ajuste')
    expect(n19.historico_inicial.length).toBeGreaterThan(0)
    expect(n19.mensagens).toHaveLength(3)
    expect(n19.esperado).toMatchObject({ proxima_acao: ['encaminhar_vendas'], vagos: [3] })
    expect(n19.itens_na).not.toContain(5)
  })
})

describe('scripts/avaliar.mjs: sinal silencio_ocorrido', () => {
  const script = fileURLToPath(new URL('../scripts/avaliar.mjs', import.meta.url))
  const fala = (resposta: string | null, proxima_acao: string) => ({ resposta, origem: 'modelo', proxima_acao, tentativas: 1, saida: { cidade: null, confianca: 0.9, proxima_acao } })
  const perg = (r: string) => fala(r, 'perguntar')
  const mudo = () => fala(null, 'ignorar')
  const u = (content: string) => ({ role: 'user', content })
  const a = (content: string) => ({ role: 'assistant', content })
  async function conduzir(casos: any[], respostas: any[]) {
    const corpos: any[] = []
    const dir = mkdtempSync(join(tmpdir(), 'aval-sin-'))
    const arq = join(dir, 'casos.json')
    writeFileSync(arq, JSON.stringify(casos))
    const srv = createServer((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => {
        const corpo = JSON.parse(b)
        res.writeHead(200, { 'content-type': 'application/json' })
        if ((corpo.historico ?? []).length === 0) return res.end('{}')
        corpos.push(corpo)
        res.end(JSON.stringify(respostas[corpos.length - 1] ?? perg('sobra')))
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const env = { ...process.env, AVALIACAO_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhook/chat`, AVALIACAO_SAIDA_DIR: dir, AVALIACAO_CASOS_ARQ: arq, AVALIACAO_ESPERA_MS: '1500' }
    try {
      await new Promise<void>((resolve) => execFile('node', [script, '--conjunto', 'ajuste'], { env }, () => resolve()))
      return corpos
    } finally {
      await new Promise<void>((r) => srv.close(() => r()))
    }
  }
  const mk = (id: string, mensagens: string[], extra = {}) => ({ id, conjunto: 'ajuste', mensagens, esperado: {}, itens_na: [], ...extra })

  it('vai true so depois de um turno silencioso com assistant no historico, e some na resposta seguinte', async () => {
    const c = await conduzir([mk('s1', ['m1', 'm2', 'm3', 'm4'])], [perg('r1'), mudo(), perg('r3'), perg('r4')])
    expect(c[0]).not.toHaveProperty('silencio_ocorrido')
    expect(c[1]).not.toHaveProperty('silencio_ocorrido')
    expect(c[2].silencio_ocorrido).toBe(true)
    expect(c[3]).not.toHaveProperty('silencio_ocorrido')
  }, 30_000)
  it('silencio na abertura (sem assistant) nao liga o sinal', async () => {
    const c = await conduzir([mk('s2', ['bolo', 'quero ar'])], [mudo(), perg('r2')])
    expect(c[1]).not.toHaveProperty('silencio_ocorrido')
  }, 30_000)
  it('caso semeado com silencio_ocorrido manda true na primeira chamada e limpa na resposta', async () => {
    const c = await conduzir([mk('s3', ['m1', 'm2'], { historico_inicial: [u('oi'), a('ola'), u('x')], silencio_ocorrido: true })], [perg('r1'), perg('r2')])
    expect(c[0].silencio_ocorrido).toBe(true)
    expect(c[1]).not.toHaveProperty('silencio_ocorrido')
  }, 30_000)
})
