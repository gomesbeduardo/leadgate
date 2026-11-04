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
    expect(md).toContain('| Campo | Acerto ajuste (n=14) | Acerto reservado (n=6) |')
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
  it('tem 20 casos, 14 + 6, ids unicos', () => {
    expect(casos).toHaveLength(20)
    expect(casos.filter((c) => c.conjunto === 'ajuste')).toHaveLength(14)
    expect(casos.filter((c) => c.conjunto === 'reservado')).toHaveLength(6)
    expect(new Set(casos.map((c) => c.id)).size).toBe(20)
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
    expect(j.execucoes).toHaveLength(9)
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
  it('tem g01 a g09, conjunto regressao, esperado completo', () => {
    expect(casos.map((c) => c.id)).toEqual(['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g09'])
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
    expect(com).toContain('Acerto ajuste (n=14)')
    expect(base).not.toContain('Regressão (n=')
    expect(base).toContain('Acerto ajuste (n=14)')
  })
})
