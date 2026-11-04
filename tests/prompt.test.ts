import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { ErroMontagem, montarPrompt } from '../src/prompt/montar'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const modelo = readFileSync('prompts/agente.md', 'utf8')

describe('arquivo do prompt', () => {
  it('T21: tem os 7 títulos de R9 na ordem, marcadores base e nenhum nome de empresa', () => {
    const titulos = [...modelo.matchAll(/^## (.+)$/gm)].map((m) => (m[1] ?? "").trim())
    expect(titulos).toEqual([
      'Papel',
      'Contexto da empresa',
      'Regras de qualificação',
      'Política de conversa',
      'Tom',
      'Travas',
      'Contrato de saída',
    ])
    expect(modelo).toContain('{{empresa.nome}}')
    expect(modelo).toContain('{{prompt.canario}}')
    expect(modelo.toLowerCase()).not.toContain(cfg.empresa.nome.toLowerCase())
  })

  it('traz a versão no cabeçalho', () => {
    expect(modelo.split('\n').slice(0, 5).join('\n')).toMatch(/versao:\s*\S+/i)
  })
})

describe('montarPrompt', () => {
  it('monta sem sobras de {{ e com canário, contato e nome da empresa da config', () => {
    const out = montarPrompt(modelo, cfg)
    expect(out).not.toContain('{{')
    expect(out).toContain(cfg.prompt.canario)
    expect(out).toContain(cfg.empresa.contato)
    expect(out).toContain(cfg.empresa.nome)
  })

  it('junta listas com ", "', () => {
    expect(montarPrompt('{{servicos}}', cfg)).toBe(cfg.servicos.join(', '))
  })

  it('T22: marcador sem valor na config gera ErroMontagem', () => {
    const vazio = { ...cfg, segmentos_aceitos: [] }
    expect(() => montarPrompt(modelo, vazio)).toThrow(ErroMontagem)
    expect(() => montarPrompt(modelo, vazio)).toThrow(/segmentos_aceitos/)
  })

  it('marcador desconhecido gera ErroMontagem nomeando o marcador', () => {
    expect(() => montarPrompt('oi {{nao.existe}}', cfg)).toThrow(ErroMontagem)
    expect(() => montarPrompt('oi {{nao.existe}}', cfg)).toThrow(/nao\.existe/)
  })

  it('{{ sobrando gera ErroMontagem', () => {
    expect(() => montarPrompt('oi {{ aberto', cfg)).toThrow(ErroMontagem)
  })
})
