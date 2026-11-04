import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS, amostrar, cobertura, conjuntoDoId, converterValidacao, ehDuplicata, jaccard, montarPromptGerador,
  normalizar, proximaCategoria, revisaoMarkdown, telefoneValido, validarConversa, validarExemplosPrompt,
} from '../src/dataset/dataset.mjs'
import { carregarConfig } from '../src/config/schema'

const bruto = JSON.parse(readFileSync('config/empresa.json', 'utf8'))
const cfg = bruto
const casos = JSON.parse(readFileSync('avaliacao/casos.json', 'utf8')) as any[]
const regressao = JSON.parse(readFileSync('avaliacao/regressao.json', 'utf8')) as any[]
const refs = [...casos, ...regressao].map((c) => c.mensagens[0] as string)

const gab = { tipo_servico: 'manutencao', segmento: 'comercial', cidade: 'Palhoça', urgencia: 'media', qualificado: true, proxima_acao: 'perguntar' }
const conv = (primeira: string, extra: object[] = []) => ({
  conversa: [{ role: 'user', content: primeira }, { role: 'assistant', content: 'Certo, em que cidade fica?' }, ...extra],
  gabarito: gab,
})

describe('config dataset', () => {
  it('empresa.json traz dataset.volume 80, max_chamadas 150, amostra_revisao 15', () => {
    const c = carregarConfig(bruto)
    expect(c.dataset).toEqual({ volume: 80, max_chamadas: 150, amostra_revisao: 15 })
  })
})

describe('normalizar e Jaccard', () => {
  it('minusculas, sem acento, sem pontuacao, espacos unicos', () => {
    expect(normalizar('  Preciso,  INSTALAR um Split! em Florianópolis ')).toBe('preciso instalar um split em florianopolis')
  })
  it('jaccard de conjuntos de palavras', () => {
    expect(jaccard('a b c d', 'a b c d')).toBe(1)
    expect(jaccard('a b c d', 'a b c e')).toBeCloseTo(3 / 5)
    expect(jaccard('a', 'b')).toBe(0)
  })
  it('T3: igual ou quase igual a um caso e duplicata; diferente nao', () => {
    expect(ehDuplicata('Preciso instalar um split no meu apartamento em Florianópolis', refs)).toBe(true)
    expect(ehDuplicata('preciso instalar um split no meu apartamento em florianopolis!!', refs)).toBe(true)
    // 9 palavras iguais de 10 (Jaccard 0,82)
    expect(ehDuplicata('Preciso instalar um split no meu apartamento em Florianópolis urgente', refs)).toBe(true)
    expect(ehDuplicata('Quero orçamento de PMOC para três prédios em Tijucas', refs)).toBe(false)
  })
  it('os reservados e a regressao entram na comparacao', () => {
    expect(ehDuplicata('Queria um orçamento de ar', refs)).toBe(true)
    expect(ehDuplicata('Vocês dão desconto ou visita grátis?', refs)).toBe(true)
  })
})

describe('padrao de telefone', () => {
  it('aceita 48/55 99999-xxxx e texto sem telefone', () => {
    expect(telefoneValido('me liga 48 99999-1234 ou 55 99999-0007')).toBe(true)
    expect(telefoneValido('sem telefone aqui, 12 unidades')).toBe(true)
  })
  it('rejeita outros formatos e DDDs', () => {
    expect(telefoneValido('48 98888-1234')).toBe(false)
    expect(telefoneValido('(11) 99999-1234')).toBe(false)
    expect(telefoneValido('(48) 3364-9840')).toBe(false)
    expect(telefoneValido('48999991234')).toBe(false)
  })
})

describe('divisao por hash do id', () => {
  it('estavel e para os dois lados, ~50/50', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `sint-${String(i + 1).padStart(4, '0')}`)
    expect(ids.map(conjuntoDoId)).toEqual(ids.map(conjuntoDoId))
    const ex = ids.filter((i) => conjuntoDoId(i) === 'exemplos').length
    expect(ex).toBeGreaterThan(70)
    expect(ex).toBeLessThan(130)
    expect(new Set(ids.map(conjuntoDoId))).toEqual(new Set(['exemplos', 'validacao']))
  })
})

describe('cobertura e escolha de categoria', () => {
  it('9 categorias; escolhe a de menor contagem, em ordem', () => {
    expect(CATEGORIAS).toHaveLength(9)
    expect(proximaCategoria({})).toBe(CATEGORIAS[0])
    expect(proximaCategoria({ [CATEGORIAS[0]!]: 1 })).toBe(CATEGORIAS[1])
    const todas = Object.fromEntries(CATEGORIAS.map((c) => [c, 5]))
    expect(proximaCategoria({ ...todas, spam: 4 })).toBe('spam')
  })
  it('cobertura aponta categorias abaixo do minimo', () => {
    const cs = CATEGORIAS.flatMap((c) => Array.from({ length: c === 'spam' ? 4 : 5 }, () => ({ categoria: c })))
    const r = cobertura(cs, 5)
    expect(r.completa).toBe(false)
    expect(r.faltando).toEqual(['spam'])
    expect(cobertura(cs.concat({ categoria: 'spam' }), 5).completa).toBe(true)
  })
})

describe('amostra de revisao', () => {
  const exs = Array.from({ length: 40 }, (_, i) => ({ id: `sint-${i + 1}`, categoria: CATEGORIAS[i % 9]!, conversa: [], gabarito: gab }))
  it('n itens, ao menos 1 por categoria, deterministica', () => {
    const a = amostrar(exs, 15)
    expect(a).toHaveLength(15)
    expect(new Set(a.map((x: any) => x.categoria)).size).toBe(9)
    expect(amostrar(exs, 15).map((x: any) => x.id)).toEqual(a.map((x: any) => x.id))
  })
  it('revisao.md lista cada id com ok/rejeitada para marcar', () => {
    const md = revisaoMarkdown(amostrar(exs, 15))
    for (const x of amostrar(exs, 15)) expect(md).toContain(x.id)
    expect(md).toMatch(/ok \/ rejeitada/)
  })
})

describe('validarConversa', () => {
  it('valida conversa boa', () => {
    expect(validarConversa(conv('Bom dia, somos uma clínica veterinária e precisamos de PMOC em Tijucas'), cfg, refs, 'claro')).toEqual({ ok: true })
  })
  it('duplicata, telefone e schema com motivo', () => {
    expect(validarConversa(conv('Preciso instalar um split no meu apartamento em Florianópolis'), cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'duplicata' })
    expect(validarConversa(conv('Quero PMOC em Tijucas, 11 98888-0000'), cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'telefone' })
    const ruim = { conversa: [{ role: 'assistant', content: 'oi' }], gabarito: gab }
    expect(validarConversa(ruim, cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'schema' })
    const gruim = { ...conv('Quero PMOC em Tijucas'), gabarito: { ...gab, urgencia: 'altissima' } }
    expect(validarConversa(gruim, cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'schema' })
  })
  it('multiturno exige 3+ mensagens do lead', () => {
    const duas = conv('Quero PMOC em Tijucas', [{ role: 'user', content: 'sou o Pedro' }, { role: 'assistant', content: 'ok' }])
    expect(validarConversa(duas, cfg, refs, 'multiturno')).toEqual({ ok: false, motivo: 'schema' })
    const tres = conv('Quero PMOC em Tijucas', [
      { role: 'user', content: 'sou o Pedro' }, { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'prédio comercial' }, { role: 'assistant', content: 'certo' },
    ])
    expect(validarConversa(tres, cfg, refs, 'multiturno')).toEqual({ ok: true })
  })
})

describe('T4: prompt do gerador nao carrega os reservados', () => {
  it('nenhuma 1a mensagem de caso reservado aparece no prompt, em nenhuma categoria', () => {
    const reservados = casos.filter((c) => c.conjunto === 'reservado')
    expect(reservados).toHaveLength(6)
    for (const cat of CATEGORIAS) {
      const p = montarPromptGerador(cfg, cat, 'Palhoça') as string
      expect(p.length).toBeGreaterThan(200)
      const n = normalizar(p)
      for (const r of reservados) expect(n).not.toContain(normalizar(r.mensagens[0]))
      expect(p).toContain('Palhoça')
      expect(p).toContain('48 99999-')
    }
  })
})

describe('T5: exemplos do prompt vinculados a ids revisados', () => {
  const exs = [
    { id: 'sint-0001', revisado: true, revisor_ok: true },
    { id: 'sint-0002', revisado: true, revisor_ok: false },
    { id: 'sint-0003', revisado: false, revisor_ok: null },
  ]
  it('prompt sem ids sint-xxxx passa', () => {
    expect(validarExemplosPrompt(readFileSync('prompts/agente.md', 'utf8'), exs).ok).toBe(true)
  })
  it('id revisado e ok passa; ok diferente de true, nao revisado ou inexistente falha', () => {
    expect(validarExemplosPrompt('exemplo sint-0001', exs).ok).toBe(true)
    for (const id of ['sint-0002', 'sint-0003', 'sint-0099']) {
      const r = validarExemplosPrompt(`exemplo ${id}`, exs)
      expect(r.ok).toBe(false)
      expect(r.erros.join(' ')).toContain(id)
    }
  })
})

describe('converterValidacao', () => {
  it('mensagens do lead da conversa; gabarito vira lista de aceitos', () => {
    const [c] = converterValidacao([{ id: 'sint-0002', categoria: 'claro', conjunto: 'validacao', conversa: [
      { role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }, { role: 'user', content: 'tchau' },
    ], gabarito: gab }])
    expect(c!).toMatchObject({ id: 'sint-0002', conjunto: 'validacao', mensagens: ['oi', 'tchau'] })
    expect(c!.esperado).toEqual({ tipo_servico: ['manutencao'], segmento: ['comercial'], cidade: ['Palhoça'], urgencia: ['media'], qualificado: [true], proxima_acao: ['perguntar'] })
  })
})

// ---- gerador com stub da API ----
type Stub = { url: string; chamadas: any[]; fechar: () => Promise<void> }
async function subirStub(corpo: (n: number, categoria: string, req: any) => object): Promise<Stub> {
  const chamadas: any[] = []
  const srv = createServer((req, res) => {
    let b = ''
    req.on('data', (d) => (b += d))
    req.on('end', () => {
      const req2 = JSON.parse(b || '{}')
      chamadas.push({ headers: req.headers, body: req2 })
      const n = chamadas.length
      const categoria = /categoria: (\w+)/.exec(JSON.stringify(req2.messages))?.[1] ?? 'claro'
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(corpo(n, categoria, req2)) }], usage: { input_tokens: 1000, output_tokens: 500 } }))
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, chamadas, fechar: () => new Promise((r) => srv.close(() => r())) }
}
const valida = (n: number, categoria: string) => {
  const u = (t: string) => ({ role: 'user', content: t })
  const a = (t: string) => ({ role: 'assistant', content: t })
  const conversa = [u(`Ola sou Maria${n} preciso de servico em Palhoça para ${n} unidades zeta${n}`), a('Certo, qual o tipo de local?')]
  if (categoria === 'multiturno') conversa.push(u(`sou comercial lote${n}`), a('E o prazo?'), u(`telefone 48 99999-${String(1000 + n)}`), a('Obrigado.'))
  return { conversa, gabarito: gab }
}
const script = fileURLToPath(new URL('../scripts/gerar-dataset.mjs', import.meta.url))
function cli(url: string, args: string[], saida: string) {
  const env = { ...process.env, ANTHROPIC_BASE_URL: url, ANTHROPIC_API_KEY: 'chave-de-teste' }
  return new Promise<{ code: number; out: string }>((resolve) =>
    execFile('node', [script, '--saida', saida, ...args], { env }, (e, so, se) => resolve({ code: e ? ((e as any).code ?? 1) : 0, out: so + se })),
  )
}
const ler = (d: string, f: string) => JSON.parse(readFileSync(join(d, f), 'utf8'))

describe('gerador (CLI com stub da API)', () => {
  it('T1: volume 80 com conversas validas: completa, cada categoria >= 5, tokens e chamadas', async () => {
    const stub = await subirStub(valida)
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      const r = await cli(stub.url, ['--volume', '80'], dir)
      expect(r.code).toBe(0)
      const ex = ler(dir, 'exemplos.json')
      const va = ler(dir, 'validacao.json')
      const todas = [...ex, ...va]
      expect(todas).toHaveLength(80)
      expect(ex.length).toBeGreaterThan(0)
      expect(va.length).toBeGreaterThan(0)
      expect(ex.every((x: any) => x.conjunto === 'exemplos' && conjuntoDoId(x.id) === 'exemplos')).toBe(true)
      expect(va.every((x: any) => x.conjunto === 'validacao' && conjuntoDoId(x.id) === 'validacao')).toBe(true)
      expect(todas[0]).toMatchObject({ origem: 'sintetico', revisado: false, revisor_ok: null })
      for (const c of CATEGORIAS) expect(todas.filter((x: any) => x.categoria === c).length).toBeGreaterThanOrEqual(5)
      const rod = ler(dir, 'rodada.json')
      expect(rod).toMatchObject({ status: 'completa', prompt_liberado: false, modelo: bruto.ia.modelo, geradas: 80, chamadas: 80 })
      expect(rod.tokens).toEqual({ entrada: 80_000, saida: 40_000 })
      expect(rod.volume_pedido).toBe(80)
      expect(rod.rejeitadas).toMatchObject({ duplicata: 0, telefone: 0, schema: 0 })
      const rev = readFileSync(join(dir, 'revisao.md'), 'utf8')
      expect((rev.match(/sint-\d{4}/g) ?? []).length).toBeGreaterThanOrEqual(15)
      // o pedido segue o formato da API
      const c0 = stub.chamadas[0]
      expect(c0.headers['anthropic-version']).toBe('2026-10-21')
      expect(c0.headers['x-api-key']).toBe('chave-de-teste')
      expect(c0.body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
      expect(c0.body).not.toHaveProperty('temperature')
      expect(c0.body).not.toHaveProperty('thinking')
      expect(r.out).not.toContain('chave-de-teste')
    } finally {
      await stub.fechar()
    }
  }, 60_000)

  it('T2: stub sem conversa multiturno valida: incompleta e prompt_liberado false', async () => {
    const stub = await subirStub((n) => valida(n, 'claro'))
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      const r = await cli(stub.url, ['--volume', '12'], dir)
      expect(r.code).toBe(0)
      const rod = ler(dir, 'rodada.json')
      expect(rod.status).toBe('incompleta')
      expect(rod.prompt_liberado).toBe(false)
      expect(rod.rejeitadas.schema).toBeGreaterThan(0)
    } finally {
      await stub.fechar()
    }
  }, 60_000)

  it('T3: conversa duplicada de caso e rejeitada e contada; telefone fora do padrao tambem', async () => {
    const stub = await subirStub((n, cat) => {
      if (n === 1) return conv('Preciso instalar um split no meu apartamento em Florianópolis')
      if (n === 2) return conv('Quero PMOC em Tijucas, 11 98888-0000')
      return valida(n, cat)
    })
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(stub.url, ['--volume', '10'], dir)
      const rod = ler(dir, 'rodada.json')
      expect(rod.rejeitadas.duplicata).toBe(1)
      expect(rod.rejeitadas.telefone).toBe(1)
      expect(rod.geradas).toBe(10)
    } finally {
      await stub.fechar()
    }
  }, 60_000)

  it('--dry-run nao chama a API nem grava', async () => {
    const stub = await subirStub(valida)
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      const r = await cli(stub.url, ['--volume', '10', '--dry-run'], dir)
      expect(r.code).toBe(0)
      expect(stub.chamadas).toHaveLength(0)
      expect(existsSync(join(dir, 'rodada.json'))).toBe(false)
    } finally {
      await stub.fechar()
    }
  }, 30_000)

  it('sem chave na env: sai 2 sem chamar a API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    const env = { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' }
    delete (env as any).ANTHROPIC_API_KEY
    const r = await new Promise<number>((resolve) => execFile('node', [script, '--saida', dir], { env }, (e) => resolve(e ? ((e as any).code ?? 1) : 0)))
    expect(r).toBe(2)
  }, 30_000)
})
