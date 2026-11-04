export type Turno = {
  resposta: string
  saida: any
  tentativas: number
  origem: string
  erro: boolean
  violacoes: { regra: string }[]
}
export type Caso = { id: string; esperado: Record<string, unknown[]>; itens_na?: number[] }
export type Item = boolean | 'na' | 'pendente'
export type Avaliacao = {
  id: string
  campos: Record<string, boolean>
  acertou: boolean
  erro: boolean
  confianca: number | null
  quadrante: 'acerto_alta' | 'acerto_baixa' | 'erro_alta' | 'erro_baixa'
  itens: Record<number, Item>
  abertura: string | null
  tentativas: number[]
}
export type ResumoConjunto = {
  n: number
  campos: Record<string, { acertos: number; n: number }>
  quadrantes: Record<Avaliacao['quadrante'], number>
  separa: number
  casos: { id: string; itens: Record<number, Item>; aprovados: number; aplicaveis: number; pendentes: number }[]
  aberturasRepetidas: number
  tentativasMedia: number
}
export type Resumo = { ajuste: ResumoConjunto | null; reservado: ResumoConjunto | null }

export const CAMPOS: string[]
export const ITENS: number[]
export function acertoCampo(campo: string, valor: unknown, aceitos: unknown[]): boolean
export function citaPrazo(texto: string): boolean
export function avaliarCaso(
  caso: Caso,
  resultado: { turnos: Turno[] },
  limiar: number,
  leitura?: Record<string, boolean | null | undefined>,
): Avaliacao
export function resumir(execucoes: { ajuste: Avaliacao[] | null; reservado: Avaliacao[] | null }): Resumo
export function tabelaMarkdown(resumo: Resumo): string
