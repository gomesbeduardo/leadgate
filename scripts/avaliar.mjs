// Executor da avaliacao: conduz cada conversa pelo proxy /api/chat (so ele conta falhas; precisa de DEMO_PAINEL=1) e grava avaliacao/resultado-<conjunto>.json.
// Uso: node scripts/avaliar.mjs --conjunto ajuste|reservado|regressao|validacao [--forcar]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { converterValidacao } from '../src/dataset/dataset.mjs'
import { falhasMarkdown } from '../src/avaliacao/metricas.mjs'

const raiz = new URL('../', import.meta.url)
const args = process.argv.slice(2)
const conjunto = args[args.indexOf('--conjunto') + 1]
const forcar = args.includes('--forcar')
if (!['ajuste', 'reservado', 'regressao', 'validacao'].includes(conjunto)) {
  console.error('uso: node scripts/avaliar.mjs --conjunto ajuste|reservado|regressao|validacao [--forcar]')
  process.exit(2)
}
const url = process.env.AVALIACAO_URL ?? 'http://127.0.0.1:8080/api/chat'
// AVALIACAO_SAIDA_DIR e AVALIACAO_ESPERA_MS existem para teste; o padrao e avaliacao/ e 60 s.
const saidaDir = process.env.AVALIACAO_SAIDA_DIR
const saidaArq = saidaDir ? new URL(`file://${saidaDir.replace(/\/$/, '')}/resultado-${conjunto}.json`) : new URL(`avaliacao/resultado-${conjunto}.json`, raiz)
const esperaMs = Number(process.env.AVALIACAO_ESPERA_MS ?? 60_000)
if (conjunto === 'reservado' && existsSync(saidaArq) && !forcar) {
  console.error(`${saidaArq.pathname} ja existe: o conjunto reservado roda uma vez. Use --forcar para sobrescrever.`)
  process.exit(3)
}

// validacao: avaliacao/dataset/validacao.json (conversa/gabarito, spec 002) convertido para o formato de casos.
// AVALIACAO_DATASET_DIR existe para teste.
const datasetDir = process.env.AVALIACAO_DATASET_DIR?.replace(/\/$/, '')
let casos
if (conjunto === 'validacao') {
  const arq = datasetDir ? new URL(`file://${datasetDir}/validacao.json`) : new URL('avaliacao/dataset/validacao.json', raiz)
  casos = converterValidacao(JSON.parse(readFileSync(arq, 'utf8')))
} else {
  const arquivoCasos = conjunto === 'regressao' ? 'avaliacao/regressao.json' : 'avaliacao/casos.json'
  casos = JSON.parse(readFileSync(new URL(arquivoCasos, raiz), 'utf8')).filter((c) => c.conjunto === conjunto)
}
const limiar = JSON.parse(readFileSync(new URL('config/empresa.json', raiz), 'utf8')).ia.limiar_confianca

async function chamar(historico, tentativaRede = 0) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ historico }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { http: true })
    return await r.json()
  } catch (e) {
    const rede = !e.http && e.name !== 'TimeoutError' && e.name !== 'SyntaxError'
    if (rede && tentativaRede === 0) return chamar(historico, 1)
    throw e
  }
}

// O n8n responde 404 enquanto o workflow nao esta ativo: espera ate esperaMs, repetindo enquanto 404 ou sem conexao.
async function esperarWebhook() {
  const fim = Date.now() + esperaMs
  let ultimo = 'sem resposta'
  for (;;) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ historico: [] }),
        signal: AbortSignal.timeout(10_000),
      })
      if (r.status !== 404) return
      ultimo = 'HTTP 404'
    } catch (e) {
      ultimo = String(e?.cause?.code ?? e?.message ?? e)
    }
    if (Date.now() >= fim) {
      console.error(`webhook ${url} nao ficou pronto em ${Math.round(esperaMs / 1000)} s (${ultimo}). O workflow esta importado e ativo?`)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(50, esperaMs / 10))))
  }
}
await esperarWebhook()

// Contagem de falhas (R17): le /falhas na porta publica, que so responde com DEMO_PAINEL=1.
// AVALIACAO_FALHAS_URL e o endereco de /falhas; o reset (DELETE) so ocorre com DEMO_PAINEL=1.
const falhasUrl = process.env.AVALIACAO_FALHAS_URL ?? 'http://127.0.0.1:8080/falhas'
const painel = process.env.DEMO_PAINEL === '1'
const lerFalhas = async () => {
  try {
    const r = await fetch(falhasUrl, { signal: AbortSignal.timeout(5000) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
let falhasAtivas = false
if (painel) {
  try {
    falhasAtivas = (await fetch(falhasUrl, { method: 'DELETE', signal: AbortSignal.timeout(5000) })).ok
  } catch {}
}
if (!falhasAtivas) console.warn(`aviso: contagem de falhas desligada (${falhasUrl} inacessivel ou DEMO_PAINEL != 1); avaliacao/falhas-<conjunto>.md nao sera gerado.`)

const execucoes = []
for (const caso of casos) {
  const turnos = []
  const historico = []
  let falhou = null
  for (const msg of caso.mensagens) {
    historico.push({ role: 'user', content: msg })
    try {
      const r = await chamar(historico)
      turnos.push({
        resposta: r.resposta ?? '',
        saida: r.saida ?? null,
        tentativas: r.tentativas ?? 0,
        origem: r.origem ?? 'falha',
        erro: Boolean(r.erro),
        violacoes: r.violacoes ?? [],
        proxima_acao: r.proxima_acao ?? null,
      })
      historico.push({ role: 'assistant', content: r.resposta ?? '' })
      if (r.proxima_acao !== 'perguntar') break
    } catch (e) {
      falhou = String(e?.message ?? e)
      turnos.push({ resposta: '', saida: null, tentativas: 0, origem: 'falha', erro: true, violacoes: [], proxima_acao: null, erro_execucao: falhou })
      break
    }
  }
  console.log(`${caso.id}: ${turnos.length} turno(s)${falhou ? ` (falha: ${falhou})` : ''}`)
  execucoes.push({ id: caso.id, turnos, falha_execucao: falhou })
}

const falhas = execucoes.filter((e) => e.falha_execucao)
const turnosTotal = execucoes.reduce((n, e) => n + e.turnos.length, 0)
const turnosFalhos = execucoes.reduce((n, e) => n + e.turnos.filter((t) => t.erro_execucao).length, 0)
if (turnosTotal === 0 || turnosFalhos === turnosTotal) {
  console.error(`todos os ${turnosTotal} turnos falharam: resultado NAO gravado (${saidaArq.pathname}). Ex.: ${falhas[0]?.falha_execucao}`)
  process.exit(1)
}
mkdirSync(new URL('.', saidaArq), { recursive: true })
writeFileSync(saidaArq, JSON.stringify({ gerado_em: new Date().toISOString(), limiar, conjunto, execucoes }, null, 2) + '\n')
console.log(`gravado em ${saidaArq.pathname}`)
if (falhasAtivas) {
  const f = await lerFalhas()
  if (f) {
    const arq = new URL(`falhas-${conjunto}.md`, new URL('.', saidaArq))
    writeFileSync(arq, falhasMarkdown(conjunto, f))
    console.log(`gravado em ${arq.pathname}`)
  }
}
if (falhas.length) {
  console.error(`${falhas.length} de ${execucoes.length} caso(s) com falha HTTP: ${falhas.map((e) => `${e.id} (${e.falha_execucao})`).join(', ')}`)
  process.exit(1)
}
