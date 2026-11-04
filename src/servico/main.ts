import { readFileSync } from 'node:fs'
import { carregarConfig } from '../config/schema'
import { criarServidor } from './app'

function falhar(msg: string): never {
  console.error(`servico: ${msg}`)
  process.exit(1)
}

const caminhoConfig = process.env.CONFIG_PATH ?? falhar('CONFIG_PATH nao definido')
const caminhoPrompt = process.env.PROMPT_PATH ?? falhar('PROMPT_PATH nao definido')
const porta = Number(process.env.PORT ?? 3000)

let cfg
let prompt: string
let chatHtml: string | undefined
try {
  cfg = carregarConfig(JSON.parse(readFileSync(caminhoConfig, 'utf8')))
  prompt = readFileSync(caminhoPrompt, 'utf8')
  if (process.env.CHAT_PATH) chatHtml = readFileSync(process.env.CHAT_PATH, 'utf8')
} catch (e) {
  falhar(`config ou prompt invalido (${caminhoConfig}, ${caminhoPrompt}): ${e instanceof Error ? e.message : String(e)}`)
}

criarServidor(cfg, prompt, { chatHtml, webhookUrl: process.env.N8N_WEBHOOK_URL, painel: process.env.DEMO_PAINEL === '1' }).listen(porta, () => console.log(`servico ouvindo na porta ${porta}`))
