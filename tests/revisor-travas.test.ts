import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('revisor no Actions', () => {
  it('barra a leitura de .git, onde a action grava o token do app', () => {
    const workflow = readFileSync('.github/workflows/revisao-agente.yml', 'utf8')
    const negadas = workflow.match(/--disallowedTools "([^"]*)"/)?.[1]
    expect(negadas?.split(',')).toContain('Read(.git/**)')
  })
})

describe('merge do agente pelo app', () => {
  const passos = readFileSync('.github/workflows/alcance.yml', 'utf8').split(/^ {6}- /m)
  const decide = passos.find((p) => p.includes('scripts/alcance.mjs')) ?? ''
  const token = passos.find((p) => p.includes('create-github-app-token')) ?? ''
  const liga = passos.find((p) => p.includes('gh pr merge "$PR" --auto')) ?? ''

  it('só o passo que liga o auto-merge recebe o token do app', () => {
    expect(liga).toContain('GH_TOKEN: ${{ steps.app.outputs.token }}')
    expect(passos.filter((p) => p.includes('steps.app.outputs.token'))).toHaveLength(1)
    expect(decide).not.toContain('steps.app')
    expect(passos.indexOf(token)).toBeGreaterThan(passos.indexOf(decide))
    expect(passos.indexOf(liga)).toBeGreaterThan(passos.indexOf(token))
  })

  it('fixa a action por SHA e gera o token só para o PR do agente', () => {
    expect(token).toMatch(/create-github-app-token@[0-9a-f]{40}\b/)
    expect(token).toContain("if: steps.decide.outputs.armar == 'true'")
    expect(liga).toContain("if: steps.decide.outputs.armar == 'true'")
    expect(decide.indexOf("!= 'claude[bot]'")).toBeGreaterThan(-1)
    expect(decide.indexOf("!= 'claude[bot]'")).toBeLessThan(decide.indexOf('armar=true'))
  })
})
