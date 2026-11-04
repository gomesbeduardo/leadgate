import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import { validarContrato } from '../src/validacao/contrato'

const bruto = JSON.parse(readFileSync('config/empresa.json', 'utf8'))
const cfg = bruto
const casos = JSON.parse(readFileSync('avaliacao/casos.json', 'utf8')) as any[]
const regressao = JSON.parse(readFileSync('avaliacao/regressao.json', 'utf8')) as any[]
const refs = [...casos, ...regressao].map((c) => c.mensagens[0] as string)

const gab = { tipo_servico: 'manutencao', segmento: 'comercial', cidade: 'Palhoça', urgencia: 'media', qualificado: false, proxima_acao: 'perguntar' }
const gabQ = { ...gab, qualificado: true }
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
    const segs = ['comercial', 'residencial', 'industrial']
    const cs = CATEGORIAS.flatMap((c, i) => Array.from({ length: c === 'spam' ? 4 : 5 }, (_, j) => ({ categoria: c, gabarito: { segmento: segs[(i + j) % 3] } })))
    const r = cobertura(cs, 5)
    expect(r.completa).toBe(false)
    expect(r.faltando).toEqual(['spam'])
    expect(r.segmentosFaltando).toEqual([])
    expect(cobertura(cs.concat({ categoria: 'spam', gabarito: { segmento: 'comercial' } }), 5).completa).toBe(true)
  })
  it('cobertura exige 5 conversas de cada segmento (comercial, residencial, industrial)', () => {
    const cs = CATEGORIAS.flatMap((c) => Array.from({ length: 5 }, () => ({ categoria: c, gabarito: { segmento: 'comercial' } })))
    const r = cobertura(cs, 5)
    expect(r.completa).toBe(false)
    expect(r.faltando).toEqual([])
    expect(r.segmentosFaltando).toEqual(['residencial', 'industrial'])
    expect(r.porSegmento).toMatchObject({ comercial: 45, residencial: 0, industrial: 0 })
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
  it('contrato: qualificado=true sem telefone do lead (forma do sint-0001) e rejeitado', () => {
    const semFone = { ...conv('Bom dia, somos uma clínica veterinária e precisamos de PMOC em Tijucas'), gabarito: gabQ }
    expect(validarConversa(semFone, cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'contrato' })
    // telefone so na fala do atendente nao conta
    const soAtendente = { conversa: [{ role: 'user', content: 'Quero PMOC em Tijucas, comercial' }, { role: 'assistant', content: 'Ligue 48 99999-0001' }], gabarito: gabQ }
    expect(validarConversa(soAtendente, cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'contrato' })
    const comFone = { ...conv('Bom dia, somos uma clínica veterinária e precisamos de PMOC em Tijucas, 48 99999-1234'), gabarito: gabQ }
    expect(validarConversa(comFone, cfg, refs, 'claro')).toEqual({ ok: true })
  })
  it('contrato: encaminhar_vendas com qualificado=false e rejeitado', () => {
    const c = { ...conv('Bom dia, somos uma clínica veterinária e precisamos de PMOC em Tijucas'), gabarito: { ...gab, proxima_acao: 'encaminhar_vendas' } }
    expect(validarConversa(c, cfg, refs, 'claro')).toEqual({ ok: false, motivo: 'contrato' })
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
  it('prompt: qualificado exige telefone do lead; sem telefone o atendente pede e nao qualifica', () => {
    const p = montarPromptGerador(cfg, 'claro', 'Palhoça', 'industrial') as string
    expect(p).toMatch(/qualificado: true somente quando[^\n]*telefone/)
    expect(p).toMatch(/qualificado=false[^\n]*proxima_acao=perguntar/)
    expect(p).toMatch(/encaminhar_vendas[^\n]*qualificado/)
    expect(p).toContain('Segmento do lead, quando ele aparecer: industrial')
  })
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
    expect(c!.esperado).toEqual({ tipo_servico: ['manutencao'], segmento: ['comercial'], cidade: ['Palhoça'], urgencia: ['media'], qualificado: [false], proxima_acao: ['perguntar'] })
  })
})

// ---- gerador com stub da API ----
type Stub = { url: string; chamadas: any[]; fechar: () => Promise<void> }
async function subirStub(corpo: (n: number, categoria: string, req: any) => object, seguirSegmento = true): Promise<Stub> {
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
      const obj: any = corpo(n, categoria, req2)
      // o modelo do stub segue o segmento pedido no prompt (quando a conversa tem segmento)
      const seg = /Segmento do lead, quando ele aparecer: (\w+)/.exec(String(req2.system))?.[1]
      if (seguirSegmento && seg && obj?.gabarito?.segmento) obj.gabarito = { ...obj.gabarito, segmento: seg }
      res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 1000, output_tokens: 500 } }))
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

  it('segmentos: o prompt roda os tres segmentos e cada um fecha >= 5 conversas', async () => {
    const stub = await subirStub(valida)
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(stub.url, ['--volume', '80'], dir)
      const todas = [...ler(dir, 'exemplos.json'), ...ler(dir, 'validacao.json')]
      for (const sg of ['comercial', 'residencial', 'industrial']) expect(todas.filter((x: any) => x.gabarito.segmento === sg).length).toBeGreaterThanOrEqual(5)
      const pedidos = new Set(stub.chamadas.map((c) => /Segmento do lead, quando ele aparecer: (\w+)/.exec(c.body.system)?.[1]))
      expect(pedidos).toEqual(new Set(['comercial', 'residencial', 'industrial']))
      expect(ler(dir, 'rodada.json').status).toBe('completa')
    } finally {
      await stub.fechar()
    }
  }, 60_000)

  it('segmentos: modelo que so devolve comercial deixa a rodada incompleta', async () => {
    const stub = await subirStub(valida, false)
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(stub.url, ['--volume', '80'], dir)
      const rod = ler(dir, 'rodada.json')
      expect(rod.status).toBe('incompleta')
      expect(rod.segmentos).toMatchObject({ residencial: 0, industrial: 0 })
    } finally {
      await stub.fechar()
    }
  }, 60_000)

  it('--completar tambem preenche o buraco de segmento, no teto de 3x', async () => {
    const s1 = await subirStub(valida, false)
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(s1.url, ['--volume', '80'], dir)
    } finally {
      await s1.fechar()
    }
    expect(ler(dir, 'rodada.json').status).toBe('incompleta')
    const s2 = await subirStub((n, cat) => valida(n + 1000, cat))
    try {
      const r = await cli(s2.url, ['--completar'], dir)
      expect(r.code).toBe(0)
      const rod = ler(dir, 'rodada.json')
      expect(rod.segmentos.residencial).toBeGreaterThanOrEqual(5)
      expect(rod.segmentos.industrial).toBeGreaterThanOrEqual(5)
      expect(rod.status).toBe('completa')
      expect(s2.chamadas.length).toBeLessThanOrEqual(30)
      expect(s2.chamadas.length).toBeGreaterThanOrEqual(10)
    } finally {
      await s2.fechar()
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

  it('contrato: gabarito qualificado sem telefone do lead e rejeitado e contado em rejeitadas.contrato', async () => {
    const stub = await subirStub((n, cat) => {
      if (n === 1) return { ...conv('Bom dia, somos uma clínica veterinária e precisamos de PMOC em Tijucas'), gabarito: gabQ }
      return valida(n, cat)
    })
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(stub.url, ['--volume', '10'], dir)
      const rod = ler(dir, 'rodada.json')
      expect(rod.rejeitadas.contrato).toBe(1)
      expect(rod.geradas).toBe(10)
      const soma = (Object.values(rod.rejeitadas_por_categoria) as number[]).reduce((a, b) => a + b, 0)
      expect(soma).toBe(Object.values(rod.rejeitadas as Record<string, number>).reduce((a, b) => a + b, 0))
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

// ---- causa das rejeicoes por duplicata no multiturno e --completar ----
const lead = (t: string) => ({ role: 'user', content: t })
const ag = (t: string) => ({ role: 'assistant', content: t })
const multi = (abertura: string, resto: [string, string]) => ({
  conversa: [lead(abertura), ag('Claro, de qual cidade?'), lead(resto[0]), ag('E o tipo de local?'), lead(resto[1]), ag('Obrigado.')],
  gabarito: gab,
})

describe('duplicata no multiturno', () => {
  it('causa: aberturas curtas e genericas colidem na primeira mensagem', () => {
    // regra antiga: a 1a mensagem da conversa aceita entra nas referencias
    const aceitas = ['oi, queria um orçamento']
    expect(ehDuplicata('Oi! Queria um orçamento', aceitas)).toBe(true)
    expect(ehDuplicata('oi queria um orçamento', aceitas)).toBe(true)
  })

  it('entre geradas, multiturno compara o texto inteiro do lead: mesma abertura, resto diferente passa', () => {
    const a = multi('oi, queria um orçamento', ['moro em Palhoça, tenho 3 splits no escritório', 'precisa ser até sexta, meu contato é 48 99999-1111'])
    const b = multi('oi, queria um orçamento', ['sou de Tijucas, é uma padaria com câmara fria', 'urgente, ligue no 48 99999-2222'])
    const lideresA = a.conversa.filter((m) => m.role === 'user').map((m) => m.content).join(' ')
    // contra os casos continua valendo so a 1a mensagem
    expect(validarConversa(b, cfg, refs, 'multiturno', [lideresA])).toEqual({ ok: true })
    // texto inteiro igual e rejeitado
    expect(validarConversa(a, cfg, refs, 'multiturno', [lideresA])).toEqual({ ok: false, motivo: 'duplicata' })
  })

  it('contra os casos, a regra da spec segue: 1a mensagem quase igual a um caso e duplicata', () => {
    const c = multi(casos[0].mensagens[0], ['sou o Pedro', 'prédio comercial'])
    expect(validarConversa(c, cfg, refs, 'multiturno', [])).toEqual({ ok: false, motivo: 'duplicata' })
  })
})

describe('gerador: rejeitadas_por_categoria e --completar', () => {
  // 1a rodada: so 3 multiturno validos; os demais multiturno vem com 2 mensagens do lead (schema)
  const primeiraRodada = () => {
    let multiOk = 0
    return (n: number, cat: string) => {
      if (cat === 'multiturno') {
        if (multiOk < 3) {
          multiOk++
          return valida(n, cat)
        }
        return valida(n, 'claro')
      }
      return valida(n, cat)
    }
  }

  it('rodada.json traz rejeitadas_por_categoria somando o total de rejeitadas', async () => {
    const stub = await subirStub(primeiraRodada())
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(stub.url, ['--volume', '80'], dir)
      const rod = ler(dir, 'rodada.json')
      expect(Object.keys(rod.rejeitadas_por_categoria).sort()).toEqual([...CATEGORIAS].sort())
      expect(rod.rejeitadas_por_categoria.multiturno).toBeGreaterThan(0)
      const soma = (Object.values(rod.rejeitadas_por_categoria) as number[]).reduce((a, b) => a + b, 0)
      expect(soma).toBe(Object.values(rod.rejeitadas as Record<string, number>).reduce((a, b) => a + b, 0))
    } finally {
      await stub.fechar()
    }
  }, 60_000)

  it('--completar sobre rodada sem contagem por categoria grava null, nao zeros', async () => {
    const s1 = await subirStub(primeiraRodada())
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(s1.url, ['--volume', '80'], dir)
    } finally {
      await s1.fechar()
    }
    const r0 = ler(dir, 'rodada.json')
    delete r0.rejeitadas_por_categoria
    writeFileSync(join(dir, 'rodada.json'), JSON.stringify(r0))
    const s2 = await subirStub((n, cat) => valida(n + 1000, cat))
    try {
      await cli(s2.url, ['--completar'], dir)
      expect(ler(dir, 'rodada.json').rejeitadas_por_categoria).toBeNull()
    } finally {
      await s2.fechar()
    }
  }, 60_000)

  it('--completar: rodada com multiturno = 3 termina completa, originais intactos, tokens acumulados', async () => {
    const s1 = await subirStub(primeiraRodada())
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(s1.url, ['--volume', '80'], dir)
    } finally {
      await s1.fechar()
    }
    const antes = { ex: readFileSync(join(dir, 'exemplos.json'), 'utf8'), va: readFileSync(join(dir, 'validacao.json'), 'utf8') }
    const r0 = ler(dir, 'rodada.json')
    expect(r0.categorias.multiturno).toBe(3)
    expect(r0.status).toBe('incompleta')
    const orig = [...JSON.parse(antes.ex), ...JSON.parse(antes.va)]
    // marcacao humana no revisao.md
    const rev0 = readFileSync(join(dir, 'revisao.md'), 'utf8')
    const idMarcado = /## (sint-\d+) /.exec(rev0)![1]
    const trecho = new RegExp(`(## ${idMarcado} [\\s\\S]*?Marcacao: )ok / rejeitada`)
    writeFileSync(join(dir, 'revisao.md'), rev0.replace(trecho, '$1rejeitada'))

    const s2 = await subirStub((n, cat) => valida(n + 1000, cat))
    try {
      const r = await cli(s2.url, ['--completar'], dir)
      expect(r.code).toBe(0)
      const todas = [...ler(dir, 'exemplos.json'), ...ler(dir, 'validacao.json')]
      // originais intactos (mesmo id, mesmo conteudo)
      for (const o of orig) expect(todas.find((x: any) => x.id === o.id)).toEqual(o)
      expect(todas.length).toBe(orig.length + s2.chamadas.length)
      const ids = todas.map((x: any) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(Math.max(...ids.map((i: string) => Number(i.slice(5))))).toBe(todas.length)
      const rod = ler(dir, 'rodada.json')
      expect(rod.status).toBe('completa')
      expect(rod.prompt_liberado).toBe(false)
      expect(rod.categorias.multiturno).toBe(5)
      // so gerou o que faltava: 2 multiturno, dentro do teto de 3x
      expect(s2.chamadas.length).toBeLessThanOrEqual(6)
      expect(s2.chamadas.every((c) => /categoria: multiturno/.test(JSON.stringify(c.body.messages)))).toBe(true)
      expect(rod.chamadas).toBe(r0.chamadas + s2.chamadas.length)
      expect(rod.tokens.entrada).toBe(r0.tokens.entrada + 1000 * s2.chamadas.length)
      expect(rod.tokens.saida).toBe(r0.tokens.saida + 500 * s2.chamadas.length)
      expect(rod.rejeitadas.schema).toBe(r0.rejeitadas.schema)
      // marcacao humana preservada
      const rev = readFileSync(join(dir, 'revisao.md'), 'utf8')
      expect(rev).toMatch(new RegExp(`## ${idMarcado} [\\s\\S]*?Marcacao: rejeitada`))
    } finally {
      await s2.fechar()
    }
  }, 60_000)

  it('--completar para no teto de 3x o que falta quando o gerador so erra', async () => {
    const s1 = await subirStub(primeiraRodada())
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      await cli(s1.url, ['--volume', '80'], dir)
    } finally {
      await s1.fechar()
    }
    const r0 = ler(dir, 'rodada.json')
    const s2 = await subirStub((n) => valida(n, 'claro')) // multiturno sempre invalido
    try {
      await cli(s2.url, ['--completar'], dir)
      expect(s2.chamadas.length).toBe(6)
      const rod = ler(dir, 'rodada.json')
      expect(rod.status).toBe('incompleta')
      expect(rod.chamadas).toBe(r0.chamadas + 6)
      expect(rod.rejeitadas_por_categoria.multiturno).toBe(r0.rejeitadas_por_categoria.multiturno + 6)
    } finally {
      await s2.fechar()
    }
  }, 60_000)

  it('--completar sem rodada anterior: erro, sem chamar a API', async () => {
    const stub = await subirStub(valida)
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    try {
      const r = await cli(stub.url, ['--completar'], dir)
      expect(r.code).toBe(2)
      expect(stub.chamadas).toHaveLength(0)
    } finally {
      await stub.fechar()
    }
  }, 30_000)
})

describe('deriva: regras do dataset iguais as de src/validacao/contrato.ts', () => {
  const cfgC = carregarConfig(bruto)
  const base = { tipo_servico: 'manutencao', segmento: 'comercial', cidade: 'Palhoça', nome: null, urgencia: 'media', dados_faltantes: [], confianca: 0.9, desvios: 0, vagos: 0, resposta: 'ok' }
  for (const telefone of [null, '48 99999-1234']) {
    for (const qualificado of [true, false]) {
      for (const acao of ['perguntar', 'encaminhar_vendas']) {
        it(`telefone=${telefone} qualificado=${qualificado} acao=${acao}`, () => {
          const lead = `Quero manutenção comercial em Palhoça${telefone ? `, meu telefone é ${telefone}` : ''}`
          const historico = [{ role: 'user' as const, content: lead }]
          const r = validarContrato(JSON.stringify({ ...base, telefone, qualificado, proxima_acao: acao }), { historico, cfg: cfgC })
          const regras = r.ok ? [] : r.violacoes.map((v) => v.regra)
          const contratoRejeita = regras.includes('qualificado_exige_telefone') || regras.includes('vendas_exige_qualificado')
          const c = { conversa: [{ role: 'user', content: lead }, { role: 'assistant', content: 'Certo.' }], gabarito: { ...gab, qualificado, proxima_acao: acao } }
          const ds = validarConversa(c, cfg, [], 'claro')
          expect(ds.ok).toBe(!contratoRejeita)
        })
      }
    }
  }
})
