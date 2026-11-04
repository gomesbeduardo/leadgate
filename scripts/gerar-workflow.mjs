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
  })

const Y = 300
const acoes = ['perguntar', 'encaminhar_vendas', 'encaminhar_humano', 'responder_e_encerrar']
const simulados = ['Continuar conversa', 'Vendas (simulado)', 'Humano (simulado)', 'Encerrar']

const nodes = [
  no('n-webhook', 'Webhook', 'n8n-nodes-base.webhook', 2, [0, Y],
    { httpMethod: 'POST', path: 'chat', responseMode: 'responseNode', options: { allowedOrigins: '*' } },
    { webhookId: 'filtro-leads-chat-0001' }),
  chamada('n-preparar', 'Preparar turno', '/preparar', [240, Y], '={{ JSON.stringify($json.body) }}'),
  no('n-precisa', 'Precisa do modelo?', 'n8n-nodes-base.if', 2.2, [480, Y], { conditions: fimFalso('precisa-fim-falso'), options: {} }),
  no('n-tentativa', 'Tentativa', 'n8n-nodes-base.noOp', 1, [720, 160], {}),
  no('n-ia', 'Nó de IA (Claude)', 'n8n-nodes-base.httpRequest', 4.2, [960, 160], {
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
    options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: 60000 },
  }),
  chamada('n-validar', 'Validar saída', '/validar', [1200, 160],
    "={{ JSON.stringify({ tentativa: $('Tentativa').last().json, http: { statusCode: $json.statusCode, body: $json.body } }) }}"),
  no('n-regenerar', 'Regenerar?', 'n8n-nodes-base.if', 2.2, [1440, 160], { conditions: fimFalso('regenerar-fim-falso'), options: {} }),
  no('n-rota', 'Rota', 'n8n-nodes-base.switch', 3.2, [1680, 440], { rules: { values: acoes.map(regra) }, options: {} }),
  ...simulados.map((nome, i) => no(`n-sim-${i}`, nome, 'n8n-nodes-base.noOp', 1, [1920, 200 + i * 160], {})),
  no('n-responder', 'Responder', 'n8n-nodes-base.respondToWebhook', 1.1, [2160, 360], {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify($json.resultado) }}',
    options: {},
  }),
]

const ligar = (...destinos) => ({ main: destinos.map((d) => (d ? d.map((node) => ({ node, type: 'main', index: 0 })) : [])) })
const connections = {
  Webhook: ligar(['Preparar turno']),
  'Preparar turno': ligar(['Precisa do modelo?']),
  'Precisa do modelo?': ligar(['Tentativa'], ['Rota']),
  Tentativa: ligar(['Nó de IA (Claude)']),
  'Nó de IA (Claude)': ligar(['Validar saída']),
  'Validar saída': ligar(['Regenerar?']),
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
