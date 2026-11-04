import { readFileSync } from 'node:fs'

const pastas = ['prompts/', 'src/validacao/', 'config/', 'docs/specs/', 'avaliacao/', '.github/', '.claude/', 'docker/']
const raiz = ['scripts/alcance.mjs', 'scripts/veredito.mjs', 'docs/aprendizados.md', 'docs/estado.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.env.example', '.mcp.json', '.npmrc']
const prefixosRaiz = ['vitest.config.', 'vitest.workspace.', 'docker-compose', 'compose.', 'dockerfile']
const nomesQualquerPasta = ['claude.md', 'agents.md']
const secoes = ['## Contexto', '## O que mudou', '## Como testar', '## Riscos e rollback']

function area(original) {
  const caminho = original.toLowerCase()
  const pasta = pastas.find((p) => caminho.startsWith(p))
  if (pasta) return pasta
  const exato = raiz.find((r) => caminho === r)
  if (exato) return exato
  const prefixo = prefixosRaiz.find((p) => caminho.startsWith(p))
  if (prefixo) return `${prefixo}*`
  const nome = caminho.split('/').pop()
  return nomesQualquerPasta.includes(nome) ? nome : null
}

function falhar(msg) {
  process.stderr.write(`alcance: ${msg}\n`)
  process.exit(2)
}

function ler(caminho) {
  try {
    return readFileSync(caminho, 'utf8')
  } catch (e) {
    return falhar(`nao foi possivel ler ${caminho}: ${e.message}`)
  }
}

const [arquivosPath, corpoPath, rotulosPath] = process.argv.slice(2)
if (!arquivosPath || !corpoPath || !rotulosPath) falhar('uso: node scripts/alcance.mjs <arquivos.json> <corpo.md> <rotulos.json>')

let arquivos
try {
  arquivos = JSON.parse(ler(arquivosPath))
} catch {
  falhar(`JSON invalido em ${arquivosPath}`)
}
if (!Array.isArray(arquivos)) falhar('arquivos.json deve ser uma lista')
for (const a of arquivos) {
  if (!a || typeof a.nome !== 'string' || typeof a.estado !== 'string' || (a.anterior !== undefined && typeof a.anterior !== 'string'))
    falhar('item invalido em arquivos.json: esperado { nome, estado, anterior? }')
}
const corpo = ler(corpoPath)
let rotulos
try {
  rotulos = JSON.parse(ler(rotulosPath))
} catch {
  falhar(`JSON invalido em ${rotulosPath}`)
}
if (!Array.isArray(rotulos) || rotulos.some((r) => typeof r !== 'string')) falhar('rotulos.json deve ser uma lista de textos')

const motivos = []
if (arquivos.length === 0) motivos.push('lista de arquivos vazia')

for (const a of arquivos) {
  const nomes = a.anterior ? [a.nome, a.anterior] : [a.nome]
  for (const n of nomes) {
    const alvo = area(n)
    if (alvo) motivos.push(`${n}: area protegida ${alvo}`)
  }
  const nome = a.nome.toLowerCase()
  const anterior = a.anterior?.toLowerCase()
  const saiuDeTests =
    a.estado === 'removed' && nome.startsWith('tests/')
      ? a.nome
      : a.estado === 'renamed' && anterior?.startsWith('tests/') && !(nome.startsWith('tests/') && nome.endsWith('.test.ts'))
        ? a.anterior
        : null
  if (saiuDeTests) motivos.push(`${saiuDeTests}: remocao de arquivo de tests/`)
}

if (rotulos.includes('revisado-por-humano')) motivos.push('rotulo revisado-por-humano presente')

const linhas = new Set(corpo.split(/\r?\n/).map((l) => l.trimEnd()))
for (const s of secoes) if (!linhas.has(s)) motivos.push(`corpo sem a secao ${s}`)

if (motivos.length) {
  process.stdout.write(motivos.join('\n') + '\n')
  process.exit(1)
}
process.stdout.write('alcance: aprovado\n')
