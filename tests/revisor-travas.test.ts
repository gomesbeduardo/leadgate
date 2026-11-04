import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('revisor no Actions', () => {
  it('barra a leitura de .git, onde a action grava o token do app', () => {
    const workflow = readFileSync('.github/workflows/revisao-agente.yml', 'utf8')
    const negadas = workflow.match(/--disallowedTools "([^"]*)"/)?.[1]
    expect(negadas?.split(',')).toContain('Read(.git/**)')
  })
})
