export type OpcoesGeracao = {
  cfg: any
  referencias: string[]
  saidaDir: string
  volume: number
  baseUrl?: string
  apiKey: string
  concorrencia?: number
  log?: (linha: string) => void
}
export function rodarGeracao(opts: OpcoesGeracao): Promise<any>
