import { createServer } from 'node:http'

const porta = Number(process.env.PORT ?? 8787)
const cenario = process.env.STUB_CENARIO ?? 'padrao'
const atrasoMs = Number(process.env.STUB_ATRASO_MS ?? 30000)
const MODELO_RESERVA = 'claude-haiku-5-5'
const chamadas = new Map()

// Saida valida do contrato para a mensagem "Oi, quero manutenção na loja": uma pergunta so.
const saidaValida = {
  tipo_servico: 'manutencao',
  segmento: null,
  cidade: null,
  nome: null,
  telefone: null,
  ja_cliente: null,
  email: null,
  urgencia: null,
  dados_faltantes: ['segmento', 'cidade', 'telefone'],
  qualificado: false,
  confianca: 0.6,
  desvios: 0,
  vagos: 0,
  proxima_acao: 'perguntar',
  resposta: 'Claro, posso ajudar com a manutenção. Em qual cidade fica a loja?',
}
const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(saidaValida) }] }

function decidir(corpo) {
  const chave = JSON.stringify(corpo?.messages?.[0] ?? null)
  const n = (chamadas.get(chave) ?? 0) + 1
  chamadas.set(chave, n)
  switch (cenario) {
    case '503_depois_ok':
      return n === 1 ? { status: 503, corpo: { error: { type: 'overloaded_error' } } } : { status: 200, corpo: ok }
    case 'sempre_503':
      return { status: 503, corpo: { error: { type: 'overloaded_error' } } }
    case '429_retry_after':
      return n === 1
        ? { status: 429, cabecalhos: { 'retry-after': '1' }, corpo: { error: { type: 'rate_limit_error' } } }
        : { status: 200, corpo: ok }
    case 'reserva_ok':
      return corpo?.model === MODELO_RESERVA ? { status: 200, corpo: ok } : { status: 503, corpo: { error: { type: 'overloaded_error' } } }
    case 'fecha_socket':
      return { fecharSocket: true }
    case 'lento':
      return { status: 200, atrasoMs, corpo: ok }
    case 'recusa_depois_ok':
      return n === 1 ? { status: 200, corpo: { stop_reason: 'refusal', content: [] } } : { status: 200, corpo: ok }
    default:
      return { status: 200, corpo: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'isto nao e json' }] } }
  }
}

createServer((req, res) => {
  const partes = []
  req.on('data', (c) => partes.push(c))
  req.on('end', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`)
    if (req.method === 'POST' && req.url === '/v1/messages') {
      let corpo = null
      try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8')) } catch { /* corpo invalido vira null */ }
      const d = decidir(corpo)
      if (d.fecharSocket) return req.socket.destroy()
      if (d.atrasoMs) return setTimeout(() => { res.writeHead(d.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(d.corpo)) }, d.atrasoMs)
      res.writeHead(d.status, { 'content-type': 'application/json', ...(d.cabecalhos ?? {}) })
      res.end(JSON.stringify(d.corpo))
    } else {
      res.writeHead(404).end()
    }
  })
}).listen(porta, () => console.log(`stub da API em http://localhost:${porta} (cenario ${cenario})`))
