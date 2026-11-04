import { readFileSync } from 'node:fs'

const pastas = ['prompts/', 'src/validacao/', 'config/', 'docs/specs/', 'avaliacao/', '.github/', '.claude/', 'docker/']
const raiz = ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', '.env.example', 'docker-compose.yml']
const prefixosRaiz = ['Dockerfile']
const secoes = ['## Contexto', '## O que mudou', '## Como testar', '## Riscos e rollback']

function area(caminho) {
  const pasta = pastas.find((p) => caminho.startsWith(p))
  if (pasta) return pasta
  const arquivo = raiz.find((r) => caminho === r) ?? prefixosRaiz.find((p) => caminho.startsWith(p))
  return arquivo ? (prefixosRaiz.includes(arquivo) ? `${arquivo}*` : arquivo) : null
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

const [arquivosPath, corpoPath] = process.argv.slice(2)
if (!arquivosPath || !corpoPath) falhar('uso: node scripts/alcance.mjs <arquivos.json> <corpo.md>')

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

const motivos = []
if (arquivos.length === 0) motivos.push('lista de arquivos vazia')

for (const a of arquivos) {
  const nomes = a.anterior ? [a.nome, a.anterior] : [a.nome]
  for (const n of nomes) {
    const alvo = area(n)
    if (alvo) motivos.push(`${n}: area protegida ${alvo}`)
  }
  const saiuDeTests = a.estado === 'removed' ? a.nome : a.estado === 'renamed' && a.anterior?.startsWith('tests/') && !a.nome.startsWith('tests/') ? a.anterior : null
  if (saiuDeTests) motivos.push(`${saiuDeTests}: remocao de arquivo de tests/`)
}

const linhas = new Set(corpo.split(/\r?\n/).map((l) => l.trimEnd()))
for (const s of secoes) if (!linhas.has(s)) motivos.push(`corpo sem a secao ${s}`)

if (motivos.length) {
  process.stdout.write(motivos.join('\n') + '\n')
  process.exit(1)
}
process.stdout.write('alcance: aprovado\n')
