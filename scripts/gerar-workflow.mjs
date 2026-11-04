import { writeFileSync, mkdirSync } from 'node:fs'

const opts = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }
const fimFalso = (id) => ({
  options: opts,
  conditions: [
    { id, leftValue: '={{ $json.fim }}', rightValue: '', operator: { type: 'boolean', operation: 'false', singleValue: true } },
  ],
  combinator: 'and',
})
const regra = (acao) => ({
  conditions: {
    options: opts,
    conditions: [
      { id: `regra-${acao}`, leftValue: '={{ $json.resultado.proxima_acao }}', rightValue: acao, operator: { type: 'string', operation: 'equals' } },
    ],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: acao,
})

const no = (id, name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id, name, type, typeVersion, position, ...extra,
})
const chamada = (id, name, rota, position, jsonBody) =>
  no(id, name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: `={{ $env.SERVICO_URL }}${rota}`,
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody,
    options: {},
  }, { onError: 'continueErrorOutput' })

const Y = 300
const acoes = ['perguntar', 'encaminhar_vendas', 'encaminhar_humano', 'responder_e_encerrar']
const simulados = ['Continuar conversa', 'Vendas (simulado)', 'Humano (simulado)', 'Encerrar']

const nodes = [
  no('n-webhook', 'Webhook', 'n8n-nodes-base.webhook', 2, [0, Y],
    { httpMethod: 'POST', path: 'chat', responseMode: 'responseNode', options: { allowedOrigins: 'http://localhost:8080' } },
    { webhookId: 'filtro-leads-chat-0001' }),
  chamada('n-preparar', 'Preparar turno', '/preparar', [240, Y], '={{ JSON.stringify($json.body) }}'),
  no('n-precisa', 'Precisa do modelo?', 'n8n-nodes-base.if', 2.2, [480, Y], { conditions: fimFalso('precisa-fim-falso'), options: {} }),
  no('n-tentativa', 'Tentativa', 'n8n-nodes-base.noOp', 1, [720, 160], {}),
  no('n-precisa-esperar', 'Precisa esperar?', 'n8n-nodes-base.if', 2.2, [920, 160], {
    conditions: {
      options: opts,
      conditions: [
        { id: 'esperar-maior-zero', leftValue: '={{ $json.esperar_ms }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } },
      ],
      combinator: 'and',
    },
    options: {},
  }),
  no('n-esperar', 'Esperar', 'n8n-nodes-base.wait', 1.1, [1120, 40], {
    resume: 'timeInterval',
    amount: '={{ $json.esperar_ms / 1000 }}',
    unit: 'seconds',
  }, { webhookId: 'filtro-leads-espera-0001' }),
  no('n-ia', 'Nó de IA (Claude)', 'n8n-nodes-base.httpRequest', 4.2, [1320, 160], {
    method: 'POST',
    url: '={{ $env.ANTHROPIC_BASE_URL }}/v1/messages',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'x-api-key', value: '={{ $env.ANTHROPIC_API_KEY }}' },
        { name: 'anthropic-version', value: '2026-10-21' },
        { name: 'content-type', value: 'application/json' },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.requisicao) }}',
    options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: '={{ $json.timeout_ms }}' },
  }, { onError: 'continueRegularOutput' }),
  chamada('n-validar', 'Validar saída', '/validar', [1520, 160],
    "={{ JSON.stringify({ estado: $('Tentativa').last().json.estado, resposta: { status: $json.statusCode, cabecalhos: $json.headers, corpo: $json.body, erro: $json.error ? (typeof $json.error === 'string' ? $json.error : ($json.error.message || String($json.error))) : undefined } }) }}"),
  no('n-regenerar', 'Regenerar?', 'n8n-nodes-base.if', 2.2, [1760, 160], { conditions: fimFalso('regenerar-fim-falso'), options: {} }),
  no('n-falha', 'Falha do serviço', 'n8n-nodes-base.set', 3.4, [1760, 560], {
    mode: 'raw',
    jsonOutput: JSON.stringify({
      resultado: { resposta: null, estado: 'aguardando_humano', estado_conversa: 'aguardando_humano', proxima_acao: 'encaminhar_humano', origem: 'falha', tipo: 'servico' },
    }),
    options: {},
  }),
  no('n-rota', 'Rota', 'n8n-nodes-base.switch', 3.2, [2000, 440], { rules: { values: acoes.map(regra) }, options: {} }),
  ...simulados.map((nome, i) => no(`n-sim-${i}`, nome, 'n8n-nodes-base.noOp', 1, [2240, 200 + i * 160], {})),
  no('n-responder', 'Responder', 'n8n-nodes-base.respondToWebhook', 1.1, [2480, 360], {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify($json.resultado) }}',
    options: {},
  }),
]

const ligar = (...destinos) => ({ main: destinos.map((d) => (d ? d.map((node) => ({ node, type: 'main', index: 0 })) : [])) })
const connections = {
  Webhook: ligar(['Preparar turno']),
  'Preparar turno': ligar(['Precisa do modelo?'], ['Falha do serviço']),
  'Precisa do modelo?': ligar(['Tentativa'], ['Rota']),
  Tentativa: ligar(['Precisa esperar?']),
  'Precisa esperar?': ligar(['Esperar'], ['Nó de IA (Claude)']),
  Esperar: ligar(['Nó de IA (Claude)']),
  'Falha do serviço': ligar(['Rota']),
  'Nó de IA (Claude)': ligar(['Validar saída']),
  'Validar saída': ligar(['Regenerar?'], ['Falha do serviço']),
  'Regenerar?': ligar(['Tentativa'], ['Rota']),
  Rota: ligar(...simulados.map((s) => [s])),
  ...Object.fromEntries(simulados.map((s) => [s, ligar(['Responder'])])),
}

const workflow = {
  id: 'filtroLeadsIA0001',
  name: 'Filtro de leads com IA',
  active: false,
  nodes,
  connections,
  settings: {},
}

mkdirSync('n8n', { recursive: true })
writeFileSync('n8n/filtro-leads.json', JSON.stringify(workflow, null, 2) + '\n')
console.log(`workflow gerado: n8n/filtro-leads.json (${nodes.length} nos)`)
