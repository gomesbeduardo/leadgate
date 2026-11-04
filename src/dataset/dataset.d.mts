export type Mensagem = { role: 'user' | 'assistant'; content: string }
export type Gabarito = {
  tipo_servico: string | null
  segmento: string | null
  cidade: string | null
  urgencia: string | null
  qualificado: boolean
  proxima_acao: string
}
export type Conversa = {
  id: string
  categoria: string
  conjunto: 'exemplos' | 'validacao'
  origem: 'sintetico'
  conversa: Mensagem[]
  gabarito: Gabarito
  revisado: boolean
  revisor_ok: boolean | null
}
export type Motivo = 'schema' | 'telefone' | 'duplicata'
export const CATEGORIAS: string[]
export function normalizar(t: unknown): string
export function palavras(t: string): Set<string>
export function jaccard(a: string, b: string): number
export function ehDuplicata(msg: string, refs: string[]): boolean
export function telefoneValido(texto: string): boolean
export function hashId(id: string): number
export function conjuntoDoId(id: string): 'exemplos' | 'validacao'
export function proximaCategoria(contagem: Record<string, number>): string
export function cobertura(conversas: { categoria: string }[], minimo?: number): { porCategoria: Record<string, number>; faltando: string[]; completa: boolean }
export function amostrar<T extends { id: string; categoria: string }>(exemplos: T[], n: number): T[]
export function revisaoMarkdown(amostra: any[]): string
export function schemaGerador(cfg: any): object
export function validarConversa(c: unknown, cfg: any, refs: string[], categoria: string): { ok: true } | { ok: false; motivo: Motivo }
export function montarPromptGerador(cfg: any, categoria: string, cidade: string): string
export function validarExemplosPrompt(promptTexto: string, exemplos: any[]): { ok: boolean; erros: string[] }
export function converterValidacao(dataset: any[]): { id: string; conjunto: string; teste: string; tipo: string; mensagens: string[]; esperado: Record<string, unknown[]>; itens_na: number[] }[]
