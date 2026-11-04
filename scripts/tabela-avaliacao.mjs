// Le os resultados + avaliacao/leitura.json e escreve avaliacao/tabela.md.
// Uso: node scripts/tabela-avaliacao.mjs
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { avaliarCaso, resumir, tabelaMarkdown } from '../src/avaliacao/metricas.mjs'

const raiz = new URL('../', import.meta.url)
const ler = (rel) => JSON.parse(readFileSync(new URL(rel, raiz), 'utf8'))
const casos = ler('avaliacao/casos.json')
// Regressao e um arquivo a parte; se faltar, o bloco sai como "nao rodado".
const casosRegressao = existsSync(new URL('avaliacao/regressao.json', raiz)) ? ler('avaliacao/regressao.json') : []
const leitura = existsSync(new URL('avaliacao/leitura.json', raiz)) ? ler('avaliacao/leitura.json') : {}

// Itens 2 e 3 usam o detector da camada 2 (TS): empacota em memoria e importa, sem chamar o modelo.
const empacotado = await build({
  stdin: {
    contents: `export { validarResposta } from './src/validacao/resposta'
export { montarPrompt } from './src/prompt/montar'
export { carregarConfig } from './src/config/schema'`,
    resolveDir: fileURLToPath(raiz),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
})
const camada2 = await import(`data:text/javascript;base64,${Buffer.from(empacotado.outputFiles[0].text).toString('base64')}`)
const cfg = camada2.carregarConfig(ler('config/empresa.json'))
const promptMontado = camada2.montarPrompt(readFileSync(new URL('prompts/agente.md', raiz), 'utf8'), cfg)
const verificar = (resposta) => {
  const regras = camada2.validarResposta(resposta, { cfg, promptMontado }).map((v) => v.regra)
  return { prazo: regras.includes('resposta_prazo'), vazamento: regras.includes('resposta_vazamento_prompt') }
}

function avaliar(conjunto) {
  const rel = `avaliacao/resultado-${conjunto}.json`
  if (!existsSync(new URL(rel, raiz))) return null
  const res = ler(rel)
  return (conjunto === 'regressao' ? casosRegressao : casos)
    .filter((c) => c.conjunto === conjunto)
    .map((c) => {
      const exec = res.execucoes.find((e) => e.id === c.id) ?? { turnos: [] }
      return avaliarCaso(c, exec, res.limiar, leitura[c.id] ?? {}, verificar)
    })
}

// Bloco de taxa de falha (C13): a conta fica em avaliacao/falhas.md, gravado por avaliar.mjs.
const falhasMd = new URL('avaliacao/falhas.md', raiz)
const blocoFalhas = existsSync(falhasMd)
  ? `\n## Taxa de falha\n\n${readFileSync(falhasMd, 'utf8').split('\n').filter((l) => l.startsWith('- taxa_falha')).join('\n')}\n\nDetalhe por tipo, camada e modelo em [falhas.md](falhas.md).\n`
  : '\n## Taxa de falha\n\nnao medida (rode scripts/avaliar.mjs com DEMO_PAINEL=1; ver falhas.md).\n'
const md = tabelaMarkdown(resumir({ ajuste: avaliar('ajuste'), reservado: avaliar('reservado'), regressao: avaliar('regressao') })) + blocoFalhas
writeFileSync(new URL('avaliacao/tabela.md', raiz), md)
console.log(md)
