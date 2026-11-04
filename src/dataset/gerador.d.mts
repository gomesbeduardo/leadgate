export type OpcoesGeracao = {
  cfg: any
  referencias: string[]
  saidaDir: string
  volume: number
  baseUrl?: string
  apiKey: string
  /** Completa uma rodada existente em saidaDir em vez de comecar outra. */
  completar?: boolean
  concorrencia?: number
  log?: (linha: string) => void
}
export function rodarGeracao(opts: OpcoesGeracao): Promise<any>
