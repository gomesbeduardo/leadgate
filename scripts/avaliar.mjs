// Executor da avaliacao: conduz cada conversa pelo webhook real e grava avaliacao/resultado-<conjunto>.json.
// Uso: node scripts/avaliar.mjs --conjunto ajuste|reservado [--forcar]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const raiz = new URL('../', import.meta.url)
const args = process.argv.slice(2)
const conjunto = args[args.indexOf('--conjunto') + 1]
const forcar = args.includes('--forcar')
if (!['ajuste', 'reservado'].includes(conjunto)) {
  console.error('uso: node scripts/avaliar.mjs --conjunto ajuste|reservado [--forcar]')
  process.exit(2)
}
const url = process.env.AVALIACAO_URL ?? 'http://127.0.0.1:5678/webhook/chat'
const saidaArq = new URL(`avaliacao/resultado-${conjunto}.json`, raiz)
if (conjunto === 'reservado' && existsSync(saidaArq) && !forcar) {
  console.error(`${saidaArq.pathname} ja existe: o conjunto reservado roda uma vez. Use --forcar para sobrescrever.`)
  process.exit(3)
}

const casos = JSON.parse(readFileSync(new URL('avaliacao/casos.json', raiz), 'utf8')).filter((c) => c.conjunto === conjunto)
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

writeFileSync(saidaArq, JSON.stringify({ gerado_em: new Date().toISOString(), limiar, conjunto, execucoes }, null, 2) + '\n')
console.log(`gravado em ${saidaArq.pathname}`)
