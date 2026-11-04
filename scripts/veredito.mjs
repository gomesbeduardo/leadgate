import { readFileSync } from 'node:fs'

const ordem = ['critico', 'alto', 'medio', 'baixo']
const reprovam = ['critico', 'alto', 'medio']

function invalido(causa) {
  process.stdout.write(`Revisão sem veredito válido: ${causa}\n`)
  process.exit(2)
}

const [caminho, marca] = process.argv.slice(2)
if (!caminho) invalido('uso: node scripts/veredito.mjs <veredito.json> <marca>')

let texto
try {
  texto = readFileSync(caminho, 'utf8')
} catch (e) {
  invalido(`não foi possível ler ${caminho}`)
}

let dados
try {
  dados = JSON.parse(texto)
} catch {
  invalido('JSON inválido')
}

if (!dados || typeof dados !== 'object' || typeof dados.marca !== 'string' || typeof marca !== 'string' || dados.marca !== marca) invalido('marca de leitura ausente ou diferente')

if (!('achados' in dados)) invalido('campo achados ausente')
if (!Array.isArray(dados.achados)) invalido('achados deve ser uma lista')

for (const [i, a] of dados.achados.entries()) {
  const ok =
    a &&
    typeof a === 'object' &&
    ordem.includes(a.gravidade) &&
    typeof a.arquivo === 'string' &&
    Number.isInteger(a.linha) &&
    typeof a.problema === 'string'
  if (!ok) invalido(`achado ${i + 1} com formato inválido (esperado gravidade conhecida, arquivo, linha inteira e problema)`)
}

const segredos = ['sk-ant-', 'ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_']
if (dados.achados.some((a) => segredos.some((s) => a.problema.includes(s) || a.arquivo.includes(s)))) invalido('padrão de segredo no veredito')

const achados = dados.achados
if (achados.length === 0) process.exit(0)

const ordenados = [...achados].sort((x, y) => ordem.indexOf(x.gravidade) - ordem.indexOf(y.gravidade))
const linhas = ordenados.map((a) => `- **${a.gravidade}** \`${a.arquivo}:${a.linha}\`: ${a.problema.replace(/\r?\n|\r/g, ' ')}`)
process.stdout.write(`Revisão do agente:\n\n${linhas.join('\n')}\n`)
process.exit(achados.some((a) => reprovam.includes(a.gravidade)) ? 1 : 0)
