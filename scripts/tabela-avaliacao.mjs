// Le os resultados + avaliacao/leitura.json e escreve avaliacao/tabela.md.
// Uso: node scripts/tabela-avaliacao.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { avaliarCaso, resumir, tabelaMarkdown } from '../src/avaliacao/metricas.mjs'

const raiz = new URL('../', import.meta.url)
const ler = (rel) => JSON.parse(readFileSync(new URL(rel, raiz), 'utf8'))
const casos = ler('avaliacao/casos.json')
// Regressao e um arquivo a parte; se faltar, o bloco sai como "nao rodado".
const casosRegressao = existsSync(new URL('avaliacao/regressao.json', raiz)) ? ler('avaliacao/regressao.json') : []
const leitura = existsSync(new URL('avaliacao/leitura.json', raiz)) ? ler('avaliacao/leitura.json') : {}

function avaliar(conjunto) {
  const rel = `avaliacao/resultado-${conjunto}.json`
  if (!existsSync(new URL(rel, raiz))) return null
  const res = ler(rel)
  return (conjunto === 'regressao' ? casosRegressao : casos)
    .filter((c) => c.conjunto === conjunto)
    .map((c) => {
      const exec = res.execucoes.find((e) => e.id === c.id) ?? { turnos: [] }
      return avaliarCaso(c, exec, res.limiar, leitura[c.id] ?? {})
    })
}

const md = tabelaMarkdown(resumir({ ajuste: avaliar('ajuste'), reservado: avaliar('reservado'), regressao: avaliar('regressao') }))
writeFileSync(new URL('avaliacao/tabela.md', raiz), md)
console.log(md)
