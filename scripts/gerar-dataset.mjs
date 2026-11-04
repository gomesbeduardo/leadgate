// Gera o dataset sintetico (spec 002, R14). Uso:
//   ANTHROPIC_API_KEY=... node scripts/gerar-dataset.mjs [--volume N] [--saida DIR] [--dry-run]
// Chave so pela env; nunca e impressa. Casos reservados so servem para a checagem de duplicata.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATEGORIAS, montarPromptGerador } from '../src/dataset/dataset.mjs'
import { cidadeDaChamada, rodarGeracao } from '../src/dataset/gerador.mjs'

const raiz = new URL('../', import.meta.url)
const args = process.argv.slice(2)
const valor = (/** @type {string} */ f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
const ler = (/** @type {string} */ rel) => JSON.parse(readFileSync(new URL(rel, raiz), 'utf8'))

const cfg = ler('config/empresa.json')
const volume = Number(valor('--volume') ?? cfg.dataset.volume)
const saidaDir = valor('--saida') ?? fileURLToPath(new URL('avaliacao/dataset/', raiz))
if (!Number.isInteger(volume) || volume < 1) {
  console.error('--volume deve ser um inteiro positivo')
  process.exit(2)
}
const referencias = [...ler('avaliacao/casos.json'), ...ler('avaliacao/regressao.json')].map((c) => c.mensagens[0])

if (args.includes('--dry-run')) {
  console.log(`dry-run: volume ${volume}, max_chamadas ${cfg.dataset.max_chamadas}, saida ${saidaDir}, ${referencias.length} referencias de duplicata`)
  for (const c of CATEGORIAS) console.log(`- ${c}: prompt de ${montarPromptGerador(cfg, c, cidadeDaChamada(cfg, 0)).length} caracteres`)
  process.exit(0)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY ausente na env.')
  process.exit(2)
}
const rodada = await rodarGeracao({ cfg, referencias, saidaDir, volume, apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL, log: console.log })
console.log(`gravado em ${saidaDir}`)
process.exit(0)
