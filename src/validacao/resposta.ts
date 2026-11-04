import type { Config } from '../config/schema'
import { normalizar, type Violacao } from './contrato'

const TRECHO_MIN = 40

const colapsar = (s: string) => normalizar(s).replace(/\s+/g, ' ')
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function vazaPrompt(resposta: string, cfg: Config, promptMontado: string): boolean {
  let r = colapsar(resposta)
  if (r.includes(colapsar(cfg.prompt.canario))) return true
  // Dados publicos da empresa podem ser citados (R5 exige o contato).
  for (const publico of [cfg.empresa.contato, cfg.empresa.nome, cfg.empresa.horario]) {
    r = r.split(colapsar(publico)).join('\u0000')
  }
  const p = colapsar(promptMontado)
  for (let i = 0; i + TRECHO_MIN <= r.length; i++) {
    if (p.includes(r.slice(i, i + TRECHO_MIN))) return true
  }
  return false
}

export function validarResposta(resposta: string, ctx: { cfg: Config; promptMontado: string }): Violacao[] {
  const { cfg, promptMontado } = ctx
  const v: Violacao[] = []
  const add = (regra: string, detalhe: string) => v.push({ tipo: 'resposta', regra, detalhe })
  const norm = normalizar(resposta)
  const max = cfg.resposta.max_chars

  if (norm.length === 0) add('resposta_vazia', 'A resposta esta vazia. Escreva uma mensagem curta para o lead.')
  if (resposta.length > max) add('resposta_longa', `A resposta tem ${resposta.length} caracteres; o maximo e ${max}. Encurte.`)

  const n = (resposta.match(/\?/g) ?? []).length
  if (n > 1) add('resposta_interrogacoes', `A resposta tem ${n} interrogacoes; use no maximo uma. Faca uma unica pergunta.`)

  if (vazaPrompt(resposta, cfg, promptMontado)) {
    add('resposta_vazamento_prompt', 'A resposta repete trecho das instrucoes internas ou o canario. Reescreva sem copiar o prompt.')
  }

  if (/r\$\s*\d/.test(norm) || /\d[\d.,]*\s*reais\b/.test(norm)) {
    add('resposta_valor_monetario', 'A resposta cita valor monetario. Nao informe precos; diga que o time comercial envia o orcamento.')
  }

  for (const termo of cfg.resposta.promessas_proibidas) {
    const re = new RegExp(`(?<![a-z0-9])${escapar(normalizar(termo))}(?![a-z0-9])`)
    if (re.test(norm)) {
      add('resposta_promessa', `A resposta contem a promessa proibida "${termo}". Remova qualquer promessa ou garantia.`)
    }
  }

  for (const frase of cfg.resposta.frases_bot) {
    if (norm.includes(normalizar(frase))) {
      add('resposta_frase_bot', `A resposta contem a frase de robo "${frase}". Escreva de forma natural, como uma pessoa.`)
    }
  }

  // Linha iniciada por numero ou marcador, ou enumeracao inline "1)" (sem casar "(55) ...").
  if (/^\s*(\d+\s*[.)\-:]|[-*]\s)/m.test(resposta) || /(?<![(\d])\d{1,2}\)/.test(resposta)) {
    add('resposta_menu', 'A resposta parece um menu ou lista numerada. Escreva em texto corrido, sem enumeracoes nem marcadores.')
  }

  return v
}
