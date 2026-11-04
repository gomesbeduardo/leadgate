import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bruto = readFileSync('n8n/filtro-leads.json', 'utf8')
const wf = JSON.parse(bruto)

type No = { name: string; type: string; parameters: { url?: string; jsonBody?: string; options?: { allowedOrigins?: string } }; [k: string]: unknown }
const no = (nome: string): No => wf.nodes.find((n: No) => n.name === nome)

describe('workflow n8n gerado', () => {
  it('tem id e os 16 nos', () => {
    expect(wf.id).toBe('filtroLeadsIA0001')
    const nomes = wf.nodes.map((n: No) => n.name)
    expect(nomes).toHaveLength(16)
    for (const n of ['Webhook', 'Preparar turno', 'Precisa do modelo?', 'Tentativa', 'Precisa esperar?', 'Esperar', 'Nó de IA (Claude)', 'Validar saída', 'Regenerar?', 'Falha do serviço', 'Rota', 'Continuar conversa', 'Vendas (simulado)', 'Humano (simulado)', 'Encerrar', 'Responder']) {
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
    const corpoValidar = no('Validar saída').parameters.jsonBody as string
    expect(corpoValidar).toContain("$('Tentativa').last().json.estado")
    for (const campo of ['status:', 'cabecalhos:', 'corpo:', 'erro:']) expect(corpoValidar).toContain(campo)
  })

  it('no de IA: sem retry, resposta completa, nunca erro, erro de rede segue o fluxo', () => {
    const ia = no('Nó de IA (Claude)') as any
    expect(ia.retryOnFail).toBeUndefined()
    expect(ia.maxTries).toBeUndefined()
    expect(ia.waitBetweenTries).toBeUndefined()
    expect(ia.onError).toBe('continueRegularOutput')
    expect(ia.parameters.jsonBody).toBe('={{ JSON.stringify($json.requisicao) }}')
    expect(ia.parameters.url).toBe('={{ $env.ANTHROPIC_BASE_URL }}/v1/messages')
    expect(ia.parameters.options.response.response).toMatchObject({ fullResponse: true, neverError: true })
    expect(ia.parameters.options.timeout).toBe('={{ $json.timeout_ms }}')
    const cab = ia.parameters.headerParameters.parameters.map((h: any) => h.name)
    expect(cab).toEqual(expect.arrayContaining(['x-api-key', 'anthropic-version']))
  })

  it('Esperar e um no Wait em ms e fica no laco Tentativa -> IA -> Validar -> Regenerar? -> Tentativa', () => {
    const w = no('Esperar') as any
    expect(w.type).toBe('n8n-nodes-base.wait')
    expect(JSON.stringify(w.parameters)).toContain('esperar_ms')
    const destino = (n: string, saida = 0) => wf.connections[n].main[saida].map((c: any) => c.node)
    expect(destino('Tentativa')).toEqual(['Precisa esperar?'])
    expect(destino('Precisa esperar?', 0)).toEqual(['Esperar'])
    expect(destino('Precisa esperar?', 1)).toEqual(['Nó de IA (Claude)'])
    expect(destino('Esperar')).toEqual(['Nó de IA (Claude)'])
    expect(destino('Nó de IA (Claude)')).toEqual(['Validar saída'])
    expect(destino('Validar saída', 0)).toEqual(['Regenerar?'])
  })

  it('/preparar e /validar tem ramo de erro que responde silencio de servico', () => {
    for (const n of ['Preparar turno', 'Validar saída']) {
      expect(no(n).onError).toBe('continueErrorOutput')
      expect(wf.connections[n].main[1].map((c: any) => c.node)).toEqual(['Falha do serviço'])
    }
    const f = JSON.stringify(no('Falha do serviço').parameters)
    for (const t of ['servico', 'falha', 'aguardando_humano', 'encaminhar_humano']) expect(f).toContain(t)
    expect(f).toContain('null')
    expect(wf.connections['Falha do serviço'].main[0][0].node).toBe('Rota')
  })

  it('o workflow nao decide: so If de fim e Switch de proxima_acao', () => {
    const ifs = wf.nodes.filter((n: No) => n.type === 'n8n-nodes-base.if').map((n: No) => JSON.stringify(n.parameters))
    expect(ifs.every((p: string) => p.includes('$json.fim') || p.includes('$json.esperar_ms'))).toBe(true)
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
