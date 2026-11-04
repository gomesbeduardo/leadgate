import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bruto = readFileSync('n8n/filtro-leads.json', 'utf8')
const wf = JSON.parse(bruto)

type No = { name: string; type: string; parameters: { url?: string; jsonBody?: string; options?: { allowedOrigins?: string } }; [k: string]: unknown }
const no = (nome: string): No => wf.nodes.find((n: No) => n.name === nome)

describe('workflow n8n gerado', () => {
  it('tem id e os 13 nos', () => {
    expect(wf.id).toBe('filtroLeadsIA0001')
    const nomes = wf.nodes.map((n: No) => n.name)
    expect(nomes).toHaveLength(13)
    for (const n of ['Webhook', 'Preparar turno', 'Precisa do modelo?', 'Tentativa', 'Nó de IA (Claude)', 'Validar saída', 'Regenerar?', 'Rota', 'Continuar conversa', 'Vendas (simulado)', 'Humano (simulado)', 'Encerrar', 'Responder']) {
      expect(nomes).toContain(n)
    }
  })

  it('Regenerar? volta para Tentativa (saida 0) e vai para Rota (saida 1)', () => {
    expect(wf.connections['Regenerar?'].main[0][0].node).toBe('Tentativa')
    expect(wf.connections['Regenerar?'].main[1][0].node).toBe('Rota')
  })

  it('nao ha no de codigo', () => {
    expect(wf.nodes.filter((n: No) => n.type === 'n8n-nodes-base.code')).toEqual([])
  })

  it('Preparar turno e Validar saída chamam o servico por SERVICO_URL', () => {
    expect(no('Preparar turno').type).toBe('n8n-nodes-base.httpRequest')
    expect(no('Validar saída').type).toBe('n8n-nodes-base.httpRequest')
    expect(no('Preparar turno').parameters.url).toBe('={{ $env.SERVICO_URL }}/preparar')
    expect(no('Validar saída').parameters.url).toBe('={{ $env.SERVICO_URL }}/validar')
    expect(no('Validar saída').parameters.jsonBody).toContain("$('Tentativa').last().json")
  })

  it('falha de rede no no de IA segue o fluxo com tentativas', () => {
    const ia = no('Nó de IA (Claude)')
    expect(ia.onError).toBe('continueRegularOutput')
    expect(ia.retryOnFail).toBe(true)
    expect(ia.maxTries).toBe(3)
    expect(ia.waitBetweenTries).toBe(1000)
  })

  it('o webhook so aceita a origem do chat local', () => {
    expect(no('Webhook').parameters.options?.allowedOrigins).toBe('http://localhost:8080')
  })

  it('nao vaza chave de API nem nome de empresa', () => {
    expect(bruto).not.toContain('sk-ant')
    expect(bruto).toContain('$env.ANTHROPIC_API_KEY')
    expect(bruto.toLowerCase()).not.toContain(['central', 'eng'].join(''))
  })

  it('o JSON e pequeno', () => {
    expect(Buffer.byteLength(bruto)).toBeLessThan(50 * 1024)
  })
})
