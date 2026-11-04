import { createServer } from 'node:http'

const porta = Number(process.env.PORT ?? 8787)

createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`)
    if (req.method === 'POST' && req.url === '/v1/messages') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'isto nao e json' }] }))
    } else {
      res.writeHead(404).end()
    }
  })
}).listen(porta, () => console.log(`stub da API em http://localhost:${porta}`))
