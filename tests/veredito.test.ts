import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/veredito.mjs', import.meta.url))

type Achado = { gravidade: string; arquivo: string; linha: unknown; problema: string }
const achado = (gravidade: string, extra: Partial<Achado> = {}): Achado => ({ gravidade, arquivo: 'src/a.ts', linha: 10, problema: 'algo errado', ...extra })

function executar(args: string[]) {
  return new Promise<{ code: number; out: string }>((resolve) =>
    execFile('node', [script, ...args], (e, out) => resolve({ code: e ? ((e as any).code ?? 1) : 0, out })))
}

function rodar(conteudo: unknown, bruto?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'veredito-'))
  const f = join(dir, 'veredito.json')
  writeFileSync(f, bruto ?? JSON.stringify(conteudo))
  return executar([f])
}

describe('veredito do revisor', () => {
  it('lista vazia: passa sem comentario', async () => {
    const r = await rodar({ achados: [] })
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
  })

  it('so baixo: passa com comentario citando arquivo e linha', async () => {
    const r = await rodar({ achados: [achado('baixo')] })
    expect(r.code).toBe(0)
    expect(r.out).toContain('src/a.ts:10')
    expect(r.out.startsWith('Revisão do agente:\n\n')).toBe(true)
  })

  it('medio reprova', async () => {
    const r = await rodar({ achados: [achado('medio')] })
    expect(r.code).toBe(1)
    expect(r.out).toContain('- **medio** `src/a.ts:10`: algo errado')
  })

  it('alto e baixo: reprova e o alto vem primeiro', async () => {
    const r = await rodar({ achados: [achado('baixo', { arquivo: 'b.ts' }), achado('alto', { arquivo: 'a.ts' })] })
    expect(r.code).toBe(1)
    expect(r.out.indexOf('**alto**')).toBeGreaterThan(-1)
    expect(r.out.indexOf('**alto**')).toBeLessThan(r.out.indexOf('**baixo**'))
  })

  it('critico reprova', async () => {
    expect((await rodar({ achados: [achado('critico')] })).code).toBe(1)
  })

  it('gravidade desconhecida: exit 2 sem veredito valido', async () => {
    const r = await rodar({ achados: [achado('grave')] })
    expect(r.code).toBe(2)
    expect(r.out.startsWith('Revisão sem veredito válido:')).toBe(true)
  })

  it('linha como texto: exit 2', async () => {
    const r = await rodar({ achados: [achado('baixo', { linha: '10' })] })
    expect(r.code).toBe(2)
    expect(r.out.startsWith('Revisão sem veredito válido:')).toBe(true)
  })

  it('achados nao e lista: exit 2', async () => {
    expect((await rodar({ achados: 'x' })).code).toBe(2)
  })

  it('objeto sem achados: exit 2', async () => {
    expect((await rodar({})).code).toBe(2)
  })

  it('JSON invalido: exit 2', async () => {
    const r = await rodar(null, '{nao e json')
    expect(r.code).toBe(2)
    expect(r.out.startsWith('Revisão sem veredito válido:')).toBe(true)
  })

  it('arquivo inexistente: exit 2', async () => {
    const r = await executar([join(tmpdir(), 'nao-existe-veredito.json')])
    expect(r.code).toBe(2)
    expect(r.out.startsWith('Revisão sem veredito válido:')).toBe(true)
  })

  it('sem argumento: exit 2', async () => {
    expect((await executar([])).code).toBe(2)
  })

  it('quebra de linha no problema continua em uma linha so', async () => {
    const r = await rodar({ achados: [achado('medio', { problema: 'linha um\nlinha dois\r\nlinha tres' })] })
    const bullets = r.out.split('\n').filter((l) => l.startsWith('- '))
    expect(bullets).toHaveLength(1)
    expect(bullets[0]).toContain('linha um linha dois linha tres')
  })

  it('T31: padrao de segredo no veredito sai com 2 sem ecoar o valor', async () => {
    const a = await rodar({ achados: [achado('baixo', { problema: 'chave sk-ant-abc123 vazou' })] })
    expect(a.code).toBe(2)
    expect(a.out).toContain('padrão de segredo no veredito')
    expect(a.out).not.toContain('abc123')
    const b = await rodar({ achados: [achado('baixo', { arquivo: 'ghs_abc123' })] })
    expect(b.code).toBe(2)
    expect(b.out).not.toContain('abc123')
  })
})
