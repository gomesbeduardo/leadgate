// Gera o dataset sintetico (spec 002, R14). Uso:
//   ANTHROPIC_API_KEY=... node scripts/gerar-dataset.mjs [--volume N] [--saida DIR] [--dry-run] [--completar]
//   --completar: mantem exemplos.json/validacao.json da saida e gera so o que falta para 5 por categoria (teto: 3x o que falta).
// Chave so pela env; nunca e impressa. Casos reservados so servem para a checagem de duplicata.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIAS, SEGMENTOS_COBERTURA, cobertura, montarPromptGerador } from '../src/dataset/dataset.mjs'
import { cidadeDaChamada, rodarGeracao, segmentoDaChamada } from '../src/dataset/gerador.mjs'

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

const completar = args.includes('--completar')
if (completar) {
  for (const f of ['exemplos.json', 'validacao.json']) {
    if (!existsSync(join(saidaDir, f))) {
      console.error(`--completar: ${join(saidaDir, f)} nao existe; rode a geracao antes.`)
      process.exit(2)
    }
  }
}

if (args.includes('--dry-run')) {
  if (completar) {
    const tudo = ['exemplos.json', 'validacao.json'].flatMap((f) => JSON.parse(readFileSync(join(saidaDir, f), 'utf8')))
    const cob = cobertura(tudo, 5)
    const falta = Object.fromEntries([
      ...CATEGORIAS.map((c) => [c, Math.max(0, 5 - cob.porCategoria[c])]),
      ...SEGMENTOS_COBERTURA.map((sg) => [`segmento ${sg}`, Math.max(0, 5 - cob.porSegmento[sg])]),
    ].filter(([, n]) => n > 0))
    const soma = (/** @type {string[]} */ ks) => ks.reduce((t, k) => t + (falta[k] ?? 0), 0)
    const teto = 3 * Math.max(soma(CATEGORIAS), soma(SEGMENTOS_COBERTURA.map((sg) => `segmento ${sg}`)))
    console.log(`dry-run --completar: falta ${JSON.stringify(falta)}; teto ${teto} chamadas`)
  }
  console.log(`dry-run: volume ${volume}, max_chamadas ${cfg.dataset.max_chamadas}, saida ${saidaDir}, ${referencias.length} referencias de duplicata`)
  for (const c of CATEGORIAS) console.log(`- ${c}: prompt de ${montarPromptGerador(cfg, c, cidadeDaChamada(cfg, 0), segmentoDaChamada(cfg, 0)).length} caracteres`)
  console.log(`segmentos por chamada: ${[0, 1, 2].map((n) => segmentoDaChamada(cfg, n)).join(', ')} (rodizio); qualificado so com telefone do lead`)
  console.log(montarPromptGerador(cfg, 'claro', cidadeDaChamada(cfg, 0), segmentoDaChamada(cfg, 0)).split('\n').filter((l) => /^- (qualificado|encaminhar_vendas)|^Segmento/.test(l)).join('\n'))
  process.exit(0)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY ausente na env.')
  process.exit(2)
}
const rodada = await rodarGeracao({ cfg, referencias, saidaDir, volume, completar, apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL, log: console.log })
console.log(`gravado em ${saidaDir}`)
process.exit(0)
