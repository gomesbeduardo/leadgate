import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/alcance.mjs', import.meta.url))
const corpoCompleto = '## Contexto\nx\n\n## O que mudou\nx\n\n## Como testar\nx\n\n## Riscos e rollback\nx\n'

type Arquivo = { nome: string; estado: string; anterior?: string }
const mod = (nome: string): Arquivo => ({ nome, estado: 'modified' })

function rodar(arquivos: unknown, corpo = corpoCompleto, bruto?: string, rotulos: string | null = '[]') {
  const dir = mkdtempSync(join(tmpdir(), 'alcance-'))
  const a = join(dir, 'arquivos.json')
  const c = join(dir, 'corpo.md')
  writeFileSync(a, bruto ?? JSON.stringify(arquivos))
  writeFileSync(c, corpo)
  const r = join(dir, 'rotulos.json')
  if (rotulos !== null) writeFileSync(r, rotulos)
  return new Promise<{ code: number; out: string; err: string }>((resolve) =>
    execFile('node', [script, a, c, ...(rotulos === null ? [] : [r])], (e, out, err) => resolve({ code: e ? ((e as any).code ?? 1) : 0, out, err })))
}

describe('portao de alcance', () => {
  it('T9: arquivo fora das areas protegidas e aprovado', async () => {
    const r = await rodar([mod('src/servico/main.ts')])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('alcance: aprovado')
  })

  it('T10: prompts/ e rejeitado', async () => {
    const r = await rodar([mod('prompts/agente.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('prompts/')
  })

  it('T11: cita so a area tocada', async () => {
    const r = await rodar([mod('src/validacao/x.ts'), mod('README.md')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('src/validacao/')
    expect(r.out).not.toContain('README')
  })

  it('T12: pasta casa so a pasta, nao o prefixo do nome', async () => {
    expect((await rodar([mod('configuracao.md')])).code).toBe(0)
    expect((await rodar([mod('src/validacaoextra.ts')])).code).toBe(0)
  })

  it('T13: lista vazia e rejeitada', async () => {
    const r = await rodar([])
    expect(r.code).toBe(1)
    expect(r.out.length).toBeGreaterThan(0)
  })

  it('T14: corpo sem secao obrigatoria e rejeitado citando a secao', async () => {
    const r = await rodar([mod('src/a.ts')], '## Contexto\n## O que mudou\n## Como testar\n')
    expect(r.code).toBe(1)
    expect(r.out).toContain('## Riscos e rollback')
  })

  it('titulo dentro de linha maior nao conta', async () => {
    const r = await rodar([mod('src/a.ts')], corpoCompleto.replace('## Contexto', 'texto ## Contexto'))
    expect(r.code).toBe(1)
    expect(r.out).toContain('## Contexto')
  })

  it('T22: arquivo de raiz protegido e rejeitado', async () => {
    const r = await rodar([mod('vitest.config.ts')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('vitest.config.ts')
  })

  it('arquivo de raiz casa o caminho inteiro, Dockerfile* casa prefixo', async () => {
    expect((await rodar([mod('src/package.json')])).code).toBe(0)
    const r = await rodar([mod('Dockerfile.dev')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('Dockerfile')
  })

  it('T23: remover arquivo de tests/ e rejeitado', async () => {
    const r = await rodar([{ nome: 'tests/chat.test.ts', estado: 'removed' }])
    expect(r.code).toBe(1)
    expect(r.out).toContain('tests/chat.test.ts')
    expect(r.out).toContain('remo')
  })

  it('remover arquivo fora de tests/ e aprovado', async () => {
    const r = await rodar([{ nome: 'src/antigo.ts', estado: 'removed' }])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toBe('alcance: aprovado')
  })

  it('T24: modificar arquivo de tests/ e aprovado', async () => {
    const r = await rodar([mod('tests/chat.test.ts')])
    expect(r.code).toBe(0)
  })

  it('renomear para fora de tests/ conta como remocao', async () => {
    const r = await rodar([{ nome: 'src/a.ts', estado: 'renamed', anterior: 'tests/a.test.ts' }])
    expect(r.code).toBe(1)
    expect(r.out).toContain('tests/a.test.ts')
  })

  it('renomear a partir de area protegida e rejeitado', async () => {
    const r = await rodar([{ nome: 'docs/a.md', estado: 'renamed', anterior: 'prompts/a.md' }])
    expect(r.code).toBe(1)
    expect(r.out).toContain('prompts/')
  })

  it('JSON invalido sai com 2 e erro em stderr', async () => {
    const r = await rodar(null, corpoCompleto, '{nao e json')
    expect(r.code).toBe(2)
    expect(r.err.length).toBeGreaterThan(0)
    expect(r.out).not.toContain('aprovado')
  })

  it('entrada com formato errado sai com 2', async () => {
    const r = await rodar([{ nome: 5 }])
    expect(r.code).toBe(2)
  })

  it('T27: caminhos protegidos novos sao rejeitados, cada um sozinho', async () => {
    for (const n of ['scripts/alcance.mjs', 'src/CLAUDE.md', 'compose.yaml', 'dockerfile', 'docs/estado.md', 'Docker-Compose.override.yml', 'vitest.workspace.ts', '.npmrc', 'AGENTS.md', '.mcp.json', 'PROMPTS/a.md']) {
      const r = await rodar([mod(n)])
      expect(r.code, n).toBe(1)
    }
  })

  it('T28: vizinhos legitimos continuam aprovados', async () => {
    for (const n of ['scripts/stub-api.mjs', 'docs/README.md', 'src/composer.ts']) {
      expect((await rodar([mod(n)])).code, n).toBe(0)
    }
  })

  it('T29: renomear de tests/ para nome sem .test.ts conta como remocao', async () => {
    const r = await rodar([{ nome: 'tests/chat.txt', estado: 'renamed', anterior: 'tests/chat.test.ts' }])
    expect(r.code).toBe(1)
    expect(r.out).toContain('remo')
    expect((await rodar([{ nome: 'tests/b.test.ts', estado: 'renamed', anterior: 'tests/a.test.ts' }])).code).toBe(0)
  })

  it('T30: rotulo revisado-por-humano rejeita', async () => {
    const r = await rodar([mod('src/a.ts')], corpoCompleto, undefined, '["revisado-por-humano"]')
    expect(r.code).toBe(1)
    expect(r.out).toContain('revisado-por-humano')
    expect((await rodar([mod('src/a.ts')], corpoCompleto, undefined, '["bug"]')).code).toBe(0)
  })

  it('rotulos.json ausente ou que nao e lista sai com 2', async () => {
    expect((await rodar([mod('src/a.ts')], corpoCompleto, undefined, null)).code).toBe(2)
    expect((await rodar([mod('src/a.ts')], corpoCompleto, undefined, '{}')).code).toBe(2)
  })
})
