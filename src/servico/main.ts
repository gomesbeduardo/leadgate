import { readFileSync } from 'node:fs'
import { carregarConfig } from '../config/schema'
import { AlertasStore } from './alertas'
import { criarServidor, criarServidorInterno } from './app'
import { FalhasStore } from './falhas'

function falhar(msg: string): never {
  console.error(`servico: ${msg}`)
  process.exit(1)
}

const caminhoConfig = process.env.CONFIG_PATH ?? falhar('CONFIG_PATH nao definido')
const caminhoPrompt = process.env.PROMPT_PATH ?? falhar('PROMPT_PATH nao definido')
const porta = Number(process.env.PORT ?? 3000)
const portaInterna = Number(process.env.PORT_INTERNA ?? 3001)
const numero = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

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

const dir = process.env.DADOS_DIR || 'dados'
const falhas = new FalhasStore({ dir, retencaoDias: cfg.lgpd.retencao_dias })
const alertas = new AlertasStore({ dir, retencaoDias: cfg.lgpd.retencao_dias })

criarServidor(cfg, prompt, {
  falhas,
  alertas,
  env: process.env,
  chatHtml,
  webhookUrl: process.env.N8N_WEBHOOK_URL,
  painel: process.env.DEMO_PAINEL === '1',
  limiteCorpo: numero(process.env.LIMITE_CORPO_BYTES),
  limitePorMinuto: numero(process.env.LIMITE_POR_MINUTO),
  maxConcorrentes: numero(process.env.MAX_CONCORRENTES),
}).listen(porta, () => console.log(`servico publico ouvindo na porta ${porta}`))

criarServidorInterno(cfg, prompt, { falhas, alertas }).listen(portaInterna, () => console.log(`servico interno ouvindo na porta ${portaInterna}`))
