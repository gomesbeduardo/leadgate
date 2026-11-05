import type { Config } from '../config/schema'

export class ErroMontagem extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroMontagem'
  }
}

const MARCADOR = /\{\{\s*([^{}]*?)\s*\}\}/g

function resolver(caminho: string, cfg: Config): string | null {
  let atual: unknown = cfg
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object' || !(parte in atual)) return null
    atual = (atual as Record<string, unknown>)[parte]
  }
  if (Array.isArray(atual)) return atual.length > 0 ? atual.join(', ') : null
  if (typeof atual === 'string') return atual === '' ? null : atual
  if (typeof atual === 'number' || typeof atual === 'boolean') return String(atual)
  return null
}

export function periodoDoDia(agora: number): 'manhã' | 'tarde' | 'noite' {
  const hora = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora),
  )
  if (hora >= 5 && hora < 12) return 'manhã'
  if (hora >= 12 && hora < 18) return 'tarde'
  return 'noite'
}

export function montarPrompt(modelo: string, cfg: Config, agora: number = Date.now()): string {
  const saida = modelo.replace(MARCADOR, (_inteiro, caminho: string) => {
    const valor = caminho === 'periodo_do_dia' ? periodoDoDia(agora) : resolver(caminho, cfg)
    if (valor === null) throw new ErroMontagem(`Marcador sem valor na config: {{${caminho}}}`)
    return valor
  })
  if (saida.includes('{{')) throw new ErroMontagem('Marcador malformado: sobrou "{{" no prompt montado')
  return saida
}
