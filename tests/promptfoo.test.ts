import { readFileSync } from 'node:fs'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createTcp } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { CAMPOS, avaliarCaso } from '../src/avaliacao/metricas.mjs'
// @ts-expect-error .mjs sem declaração de tipos
import { pontuar } from '../scripts/promptfoo/asserir.mjs'
// @ts-expect-error .mjs sem declaração de tipos
import { gerarTestes } from '../scripts/promptfoo/casos.mjs'
// @ts-expect-error .mjs sem declaração de tipos
import { comparar, montarEnv } from '../scripts/promptfoo/comparar.mjs'
// @ts-expect-error .mjs sem declaração de tipos
import ProviderChat from '../scripts/promptfoo/provider.mjs'
// @ts-expect-error .mjs sem declaração de tipos
import { somar, tabelaMarkdown } from '../scripts/promptfoo/somar.mjs'

const todos: any[] = JSON.parse(readFileSync('avaliacao/casos.json', 'utf8'))
const ajuste = todos.filter((c) => c.conjunto === 'ajuste')

describe('gerador de testes', () => {
  it('devolve os 14 casos de ajuste e nenhum do reservado', () => {
    const ids = gerarTestes().map((t: any) => t.vars.caso_id)
    expect(ids).toHaveLength(14)
    expect([...ids].sort()).toEqual(ajuste.map((c) => c.id).sort())
    const reservados = new Set(todos.filter((c) => c.conjunto === 'reservado').map((c) => c.id))
    expect(ids.some((id: string) => reservados.has(id))).toBe(false)
    const t: any = gerarTestes()[0]
    expect(JSON.parse(t.vars.mensagens)).toEqual(ajuste.find((c) => c.id === t.vars.caso_id).mensagens)
    expect(Object.keys(t.vars).sort()).toEqual(['caso_id', 'esperado', 'mensagens'])
  })
})

describe('ambiente do promptfoo', () => {
  it('força os 5 desligamentos mesmo se o chamador passar 0 e aponta os diretórios para o temporário', () => {
    const herdado = Object.fromEntries(
      ['TELEMETRY', 'UPDATE', 'REMOTE_GENERATION', 'SHARING', 'SHARE_EMAIL_REQUEST'].map((k) => [`PROMPTFOO_DISABLE_${k}`, '0']),
    )
    const dir = join(tmpdir(), 'x')
    const env = montarEnv(dir, { ...herdado, PROMPTFOO_CONFIG_DIR: '/home/x/.promptfoo', OUTRA: 'ok' })
    for (const k of Object.keys(herdado)) expect(env[k]).toBe('1')
    expect(env.PROMPTFOO_CONFIG_DIR).toBe(dir)
    expect(env.PROMPTFOO_CACHE_PATH).toBe(dir)
    expect(env.PROMPTFOO_LOG_DIR).toBe(dir)
    expect(env.OUTRA).toBe('ok')
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) expect(env[k]).toBe('http://127.0.0.1:9')
    expect(env.NO_PROXY).toContain('127.0.0.1')
    const herdadoProxy = montarEnv(dir, { HTTP_PROXY: 'http://proxy.da.empresa:3128', all_proxy: 'http://x:1' })
    expect(herdadoProxy.HTTP_PROXY).toBe('http://127.0.0.1:9')
    expect(herdadoProxy.all_proxy).toBe('http://127.0.0.1:9')
    const interno = montarEnv(dir, {}, 'http://127.0.0.1:1234')
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) expect(interno[k]).toBe('http://127.0.0.1:1234')
  })
})

describe('package.json', () => {
  const ler = (arq: string) => JSON.parse(readFileSync(arq, 'utf8'))
  it('raiz sem promptfoo: dependencies só com zod, nada no devDependencies nem no lockfile', () => {
    const pkg = ler('package.json')
    expect(Object.keys(pkg.dependencies)).toEqual(['zod'])
    expect(pkg.devDependencies.promptfoo).toBeUndefined()
    expect(pkg.scripts['comparar:prompt']).toContain('comparar.mjs')
    expect(pkg.scripts['test:promptfoo']).toContain('COMPARAR_E2E=1')
    const lock = ler('package-lock.json')
    expect(Object.keys(lock.packages).filter((k) => /promptfoo/.test(k))).toEqual([])
    expect(lock.packages[''].devDependencies.promptfoo).toBeUndefined()
  })
  it('scripts/promptfoo fixa o promptfoo 0.124.1 exato, e o lockfile próprio resolve essa versão', () => {
    const pkg = ler('scripts/promptfoo/package.json')
    expect(pkg.private).toBe(true)
    expect(pkg.type).toBe('module')
    expect(pkg.dependencies).toEqual({ promptfoo: '0.124.1' })
    const lock = ler('scripts/promptfoo/package-lock.json')
    expect(lock.packages['node_modules/promptfoo'].version).toBe('0.124.1')
    expect(lock.packages[''].dependencies).toEqual({ promptfoo: '0.124.1' })
  })
})

describe('asserção por campo', () => {
  const caso = {
    id: 'f1',
    esperado: { tipo_servico: ['instalacao'], segmento: ['residencial'], cidade: ['São Paulo'], urgencia: ['alta'], qualificado: [true], proxima_acao: ['encaminhar'] },
  }
  const ok = { origem: 'modelo', erro: false, resposta: 'x', violacoes: [], tentativas: 1, saida: { tipo_servico: 'instalacao', segmento: 'comercial', cidade: 'sao paulo', urgencia: 'alta', qualificado: false, proxima_acao: 'encaminhar', confianca: 0.9 } }
  const verificador = () => ({ prazo: false, vazamento: false })
  const concorda = (turno: any) => {
    const ref = avaliarCaso(caso, { turnos: turno ? [turno] : [] }, 0.7, {}, verificador).campos
    const r = pontuar(turno, caso.esperado)
    expect(Object.keys(r.namedScores)).toEqual(CAMPOS)
    for (const c of CAMPOS) expect(r.namedScores[c] === 1).toBe(ref[c])
    return r
  }
  it('concorda com avaliarCaso numa saída parcialmente certa', () => {
    const r = concorda(ok)
    expect(r.namedScores.segmento).toBe(0)
    expect(r.namedScores.cidade).toBe(1)
    expect(r.pass).toBe(false)
  })
  it('concorda com avaliarCaso em saídas inválidas (falha, erro, sem saída)', () => {
    for (const t of [{ ...ok, origem: 'falha' }, { ...ok, erro: true }, { ...ok, saida: null }, null]) {
      const r = concorda(t)
      expect(Object.values(r.namedScores).every((v) => v === 0)).toBe(true)
    }
  })
})

const linha = (label: string, scores: Record<string, number> | null) =>
  scores ? { provider: { label }, gradingResult: { namedScores: scores } } : { provider: { label }, error: 'HTTP 500', response: { error: 'HTTP 500' } }
const tudo = (v: number, extra: Record<string, number> = {}) => Object.fromEntries(CAMPOS.map((c) => [c, v])) && { ...Object.fromEntries(CAMPOS.map((c) => [c, v])), ...extra }
const json = (linhas: any[]) => ({ results: { results: linhas } })
const rep = (n: number, f: () => any) => Array.from({ length: n }, f)

describe('somar', () => {
  it('soma acertos por campo e provider, e passa no empate', () => {
    const r = somar(json([...rep(42, () => linha('base', tudo(1))), ...rep(42, () => linha('branch', tudo(1)))]))
    expect(r.lados.base.n).toBe(42)
    expect(r.lados.branch.acertos.segmento).toBe(42)
    expect(r.bloqueado).toBe(false)
    expect(r.aprovado).toBe(true)
    expect(tabelaMarkdown(r)).toMatch(/^\| campo \| base \| branch \| situação \|/)
  })
  it('bloqueia quando a soma da branch fica abaixo da base em um campo', () => {
    const r = somar(json([...rep(42, () => linha('base', tudo(1))), ...rep(41, () => linha('branch', tudo(1))), linha('branch', tudo(1, { segmento: 0 }))]))
    expect(r.bloqueado).toBe(true)
    expect(r.aprovado).toBe(false)
    expect(r.campos.find((c: any) => c.campo === 'segmento')).toMatchObject({ base: 42, branch: 41, bloqueia: true })
    expect(tabelaMarkdown(r)).toContain('bloqueia')
  })
  it('linha com erro conta em n e nunca como acerto', () => {
    const r = somar(json([...rep(42, () => linha('base', tudo(1))), ...rep(41, () => linha('branch', tudo(1))), linha('branch', null)]))
    expect(r.lados.branch.n).toBe(42)
    expect(r.lados.branch.acertos.tipo_servico).toBe(41)
    expect(r.bloqueado).toBe(true)
  })
  it('linha com asserção reprovada tem error preenchido, mas conta pelos namedScores', () => {
    const reprovada = { ...linha('branch', tudo(1, { segmento: 0 })), error: '5/6 campos' }
    const r = somar(json([...rep(42, () => linha('base', tudo(1))), ...rep(41, () => linha('branch', tudo(1))), reprovada]))
    expect(r.lados.branch.acertos.tipo_servico).toBe(42)
    expect(r.lados.branch.acertos.segmento).toBe(41)
  })
  it('erro de provider em qualquer lado invalida a comparação, mesmo com a branch somando mais', () => {
    const r = somar(json([...rep(30, () => linha('base', tudo(1))), ...rep(12, () => linha('base', null)), ...rep(42, () => linha('branch', tudo(1)))]))
    expect(r.lados.base.acertos.segmento).toBe(30)
    expect(r.campos.every((c: any) => c.branch > c.base)).toBe(true)
    expect(r.valido).toBe(false)
    expect(r.aprovado).toBe(false)
    expect(r.problemas.join()).toMatch(/base: 12 de 42 linhas com erro/)
    const tab = tabelaMarkdown(r)
    expect(tab).toContain('30/42')
    expect(tab).toContain('inválida')
  })
  it('falha alto: n zero ("não medida"), linhas a menos e formato inesperado', () => {
    const vazio = somar(json(rep(42, () => linha('base', tudo(1)))))
    expect(vazio.valido).toBe(false)
    expect(vazio.aprovado).toBe(false)
    expect(tabelaMarkdown(vazio)).toContain('não medida')
    expect(tabelaMarkdown(vazio)).not.toMatch(/(^|[^\d,])0,0 %/)
    const mortos = somar(json([...rep(42, () => linha('base', null)), ...rep(42, () => linha('branch', null))]))
    expect(mortos.valido).toBe(false)
    expect(mortos.aprovado).toBe(false)
    expect(mortos.problemas.join()).toContain('não medida')
    const curto = somar(json([...rep(42, () => linha('base', tudo(1))), ...rep(41, () => linha('branch', tudo(1)))]))
    expect(curto.valido).toBe(false)
    expect(curto.problemas.join()).toContain('41 de 42')
    expect(() => somar({})).toThrow(/formato inesperado/)
    expect(() => somar(json([{ provider: { label: 'outro' } }]))).toThrow(/formato inesperado/)
    expect(() => somar(json([{ provider: { label: 'base' }, gradingResult: {} }]))).toThrow(/formato inesperado/)
  })
})

// Servidor falso do /api/chat: acerta tudo, erra um campo ou responde 500.
function servidor(modo: 'certo' | 'segmento_errado' | '500'): Promise<Server> {
  const s = createServer((req, res) => {
    let corpo = ''
    req.on('data', (d) => (corpo += d))
    req.on('end', () => {
      if (modo === '500') return void res.writeHead(500).end('erro')
      const { historico } = JSON.parse(corpo)
      const falas = historico.filter((m: any) => m.role === 'user').map((m: any) => m.content)
      const turno = falas.length
      const c = ajuste.find((x) => falas.every((f: string, i: number) => x.mensagens[i] === f))
      const final = turno >= c.mensagens.length
      const saida: any = Object.fromEntries(CAMPOS.map((k) => [k, c.esperado[k][0]]))
      if (modo === 'segmento_errado') saida.segmento = 'zzz'
      saida.confianca = 0.9
      const proxima_acao = final ? saida.proxima_acao : 'perguntar'
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ resposta: 'ok', saida: { ...saida, proxima_acao }, tentativas: 1, origem: 'modelo', erro: false, violacoes: [], proxima_acao }))
    })
  })
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s)))
}
const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/chat`

describe('provider', () => {
  it('devolve { error } em HTTP 500, sem output', async () => {
    const s = await servidor('500')
    const p = new ProviderChat({ config: { url: url(s) } })
    const r: any = await p.callApi('', { vars: { mensagens: JSON.stringify(['oi']) } })
    s.close()
    expect(r.error).toContain('HTTP 500')
    expect(r.output).toBeUndefined()
  })
})

describe('resultado antigo e processo morto', () => {
  const aprovado = () => json([...rep(42, () => linha('base', tudo(1))), ...rep(42, () => linha('branch', tudo(1)))])
  const preparar = (corpoScript: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'comparar-stale-'))
    const saida = join(dir, 'antigo.json')
    writeFileSync(saida, JSON.stringify(aprovado()))
    writeFileSync(join(dir, 'aprovado.json'), JSON.stringify(aprovado()))
    const bin = join(dir, 'falso-promptfoo.sh')
    writeFileSync(bin, `#!/bin/sh\n${corpoScript}\n`)
    chmodSync(bin, 0o755)
    return { dir, saida, bin }
  }
  const rodar = async (corpo: string) => {
    const { dir, saida, bin } = preparar(corpo)
    const linhas: string[] = []
    const r = await comparar({ saida, bin, env: { ...process.env, APROVADO: join(dir, 'aprovado.json') }, log: (l: string) => linhas.push(l), silencioso: true })
    return { r, texto: linhas.join('\n'), saida }
  }
  it('JSON antigo em --saida não vira veredito quando o promptfoo não escreve nada', async () => {
    const { r, texto } = await rodar('exit 0')
    expect(r.codigo).toBe(1)
    expect(texto).not.toContain('aprovado:')
  })
  it('promptfoo que cai sem escrever, com código diferente de zero, também é inválido', async () => {
    const { r, texto } = await rodar('exit 3')
    expect(r.codigo).toBe(1)
    expect(texto).not.toContain('aprovado:')
  })
  it('processo morto por sinal é inválido mesmo com JSON bom no arquivo', async () => {
    const { r, texto } = await rodar('cp "$APROVADO" "$5"\nkill -9 $$')
    expect(r.codigo).toBe(1)
    expect(texto).not.toContain('aprovado:')
  })
  it('erro ao iniciar o processo é inválido mesmo com JSON bom no arquivo', async () => {
    const { dir, saida } = preparar('exit 0')
    const linhas: string[] = []
    const r = await comparar({ saida, bin: join(dir, 'nao-existe'), log: (l: string) => linhas.push(l), silencioso: true })
    expect(r.codigo).toBe(1)
    expect(linhas.join('\n')).not.toContain('aprovado:')
  })
  it('promptfoo isolado ausente: mensagem com o comando de instalação, código 1 e o --saida existente intocado', async () => {
    const { dir, saida } = preparar('exit 0')
    const antes = readFileSync(saida, 'utf8')
    const linhas: string[] = []
    const r = await comparar({ saida, bin: join(dir, 'nao-existe'), log: (l: string) => linhas.push(l), silencioso: true })
    expect(r.codigo).toBe(1)
    expect(linhas.join('\n')).toContain('npm ci --prefix scripts/promptfoo --ignore-scripts')
    expect(existsSync(saida)).toBe(true)
    expect(readFileSync(saida, 'utf8')).toBe(antes)
  })
  it('exit diferente de zero do promptfoo com JSON novo e bom segue decidido pelo JSON', async () => {
    const { r, texto } = await rodar('cp "$APROVADO" "$5"\nexit 1')
    expect(r.codigo).toBe(0)
    expect(texto).toContain('aprovado:')
  })
})

// Só estes hosts podem aparecer no que o promptfoo tenta alcançar pelo proxy; um host novo reprova o teste.
const HOSTS_PERMITIDOS = ['r.promptfoo.app']

// O e2e usa o binário real do pacote isolado (scripts/promptfoo). Sem ele, pula com motivo visível;
// com COMPARAR_E2E=1 (npm run test:promptfoo) a ausência do binário reprova, para pular não parecer sucesso.
const binIsolado = fileURLToPath(new URL('../scripts/promptfoo/node_modules/.bin/promptfoo', import.meta.url))
const temBin = existsSync(binIsolado)
const exigido = process.env.COMPARAR_E2E === '1'
const MOTIVO = 'promptfoo isolado não instalado: npm ci --prefix scripts/promptfoo --ignore-scripts'
if (!temBin && !exigido) process.stderr.write(`\n[promptfoo.test] e2e com o binário real PULADO: ${MOTIVO}\n`)

describe.skipIf(!temBin && !exigido)('comparação ponta a ponta com o promptfoo real', () => {
  it('o binário isolado está instalado', () => {
    expect(temBin, `COMPARAR_E2E=1 mas ${MOTIVO}`).toBe(true)
  })
  const abertos: Server[] = []
  afterAll(() => abertos.forEach((s) => s.close()))
  const conexoes: string[] = []
  const capturador = createTcp((sock) => {
    sock.once('data', (d) => {
      conexoes.push(String(d).split('\r\n')[0] ?? '')
      sock.destroy()
    })
    sock.on('error', () => {})
  })
  const portaProxy = new Promise<number>((ok) => capturador.listen(0, '127.0.0.1', () => ok((capturador.address() as AddressInfo).port)))
  afterAll(() => capturador.close())
  const rodar = async (modoBranch: 'segmento_errado' | '500') => {
    const base = await servidor('certo')
    const branch = await servidor(modoBranch)
    abertos.push(base, branch)
    const saida = join(tmpdir(), `comparar-e2e-${modoBranch}-${process.pid}.json`)
    const r = await comparar({
      saida,
      env: { ...process.env, COMPARAR_URL_BASE: url(base), COMPARAR_URL_BRANCH: url(branch), PROMPTFOO_DISABLE_TELEMETRY: '0' },
      log: () => {},
      silencioso: true,
      proxy: `http://127.0.0.1:${await portaProxy}`,
    })
    return { r, resumo: somar(JSON.parse(readFileSync(saida, 'utf8'))) }
  }
  it('segmento errado na branch: 14 x 3 linhas por lado, soma certa, bloqueia e sai diferente de zero', async () => {
    const { r, resumo } = await rodar('segmento_errado')
    expect(resumo.lados.base.n).toBe(42)
    expect(resumo.lados.branch.n).toBe(42)
    for (const c of resumo.campos as any[]) {
      expect(c.base).toBe(42)
      expect(c.branch).toBe(c.campo === 'segmento' ? 0 : 42)
    }
    expect(resumo.bloqueado).toBe(true)
    expect(r.codigo).not.toBe(0)
  }, 240_000)
  it('o único destino externo que o promptfoo tenta alcançar é o da lista permitida', () => {
    const hosts = [...new Set(conexoes.map((l) => l.replace(/^CONNECT\s+/, '').replace(/\s+HTTP.*$/, '').replace(/:\d+$/, '')))]
    expect(conexoes.length, 'o proxy de captura não recebeu nenhum CONNECT').toBeGreaterThan(0)
    expect(conexoes.every((l) => l.startsWith('CONNECT '))).toBe(true)
    expect(hosts.filter((h) => !HOSTS_PERMITIDOS.includes(h))).toEqual([])
    console.log('hosts capturados:', JSON.stringify(hosts), 'CONNECTs:', conexoes.length)
  })
  it('branch com HTTP 500: linhas contam em n e nenhum acerto', async () => {
    const { r, resumo } = await rodar('500')
    expect(resumo.lados.branch.n).toBe(42)
    for (const c of resumo.campos as any[]) expect(c.branch).toBe(0)
    expect(resumo.lados.branch.erros).toBe(42)
    expect(resumo.valido).toBe(false)
    expect(resumo.bloqueado).toBe(true)
    expect(r.codigo).not.toBe(0)
  }, 240_000)
})
