import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ModeloAtual } from '../fluxo/turno'

const MAX_REGISTROS = 5000
const DIA_MS = 86_400_000

export type Componente = 'modelo' | 'n8n' | 'servico'
export type Tentativa = {
  ts: string
  turno_id: string
  tipo: string
  origem_componente: Componente
  modelo: string | null
  tentativa: number | null
  camada: number | null
  recuperado: boolean
}
export type TurnoRegistro = {
  ts: string
  turno_id: string
  origem: 'modelo' | 'falha'
  tipo: string | null
  camada: number | null
  modelo_respondeu: ModeloAtual | null
}
type Arquivo = { tentativas: Tentativa[]; turnos: TurnoRegistro[]; entradas_invalidas: number }

export type Resumo = {
  turnos_totais: number
  turnos_falha: number
  taxa_falha: string
  tentativas_falhas_por_tipo: Record<string, number>
  recuperados_por_camada: { '1': number; '2': number }
  modelo_respondeu: { primario: number; reserva: number }
  entradas_invalidas: number
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const inteiro = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null)

/** Classifica o resultado do workflow. Entrada invalida (falha sem tipo) e abuso, nao queda. */
export function classificarTurno(r: Record<string, unknown>): 'modelo' | 'falha' | 'entrada_invalida' | 'outro' {
  if (r.origem === 'modelo') return 'modelo'
  if (r.origem === 'falha') return texto(r.tipo) ? 'falha' : 'entrada_invalida'
  return 'outro'
}

export class FalhasStore {
  private dados: Arquivo = { tentativas: [], turnos: [], entradas_invalidas: 0 }
  private readonly arquivo?: string

  constructor(private readonly o: { dir?: string; agora?: () => number; retencaoDias: number }) {
    if (o.dir) this.arquivo = join(o.dir, 'falhas.json')
    this.carregar()
  }

  private agora = () => (this.o.agora ?? Date.now)()

  private carregar() {
    if (!this.arquivo || !existsSync(this.arquivo)) return
    try {
      const j = JSON.parse(readFileSync(this.arquivo, 'utf8'))
      const corte = this.agora() - this.o.retencaoDias * DIA_MS
      const vivo = (r: { ts?: unknown }) => typeof r.ts === 'string' && Date.parse(r.ts) >= corte
      this.dados = {
        tentativas: Array.isArray(j.tentativas) ? j.tentativas.filter(vivo) : [],
        turnos: Array.isArray(j.turnos) ? j.turnos.filter(vivo) : [],
        entradas_invalidas: typeof j.entradas_invalidas === 'number' ? j.entradas_invalidas : 0,
      }
    } catch {
      this.dados = { tentativas: [], turnos: [], entradas_invalidas: 0 }
    }
  }

  private gravar() {
    if (!this.arquivo) return
    mkdirSync(this.o.dir!, { recursive: true })
    const tmp = `${this.arquivo}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.dados))
    renameSync(tmp, this.arquivo)
  }

  /** Registra o resultado do workflow. So campos de controle sao copiados: nunca texto nem telefone. */
  registrarTurno(r: Record<string, unknown>, componente?: Componente): void {
    const classe = classificarTurno(r)
    if (classe === 'outro') return
    if (classe === 'entrada_invalida') {
      this.dados.entradas_invalidas++
      this.gravar()
      return
    }
    const ts = new Date(this.agora()).toISOString()
    const turno_id = randomUUID()
    const recuperado = classe === 'modelo'
    const tipoTurno = classe === 'falha' ? texto(r.tipo) : null
    const lista = Array.isArray(r.registros) ? r.registros.filter(ehObjeto) : []
    const novas: Tentativa[] = lista.flatMap((x) => {
      const tipo = texto(x.tipo)
      if (!tipo || tipo === 'nenhum') return []
      return [{
        ts: texto(x.ts) ?? ts, turno_id, tipo, origem_componente: 'modelo' as Componente,
        modelo: texto(x.modelo), tentativa: inteiro(x.tentativa), camada: inteiro(x.camada), recuperado,
      }]
    })
    if (tipoTurno === 'n8n' || tipoTurno === 'servico') {
      novas.push({ ts, turno_id, tipo: tipoTurno, origem_componente: componente ?? tipoTurno, modelo: null, tentativa: null, camada: null, recuperado: false })
    }
    this.dados.tentativas.push(...novas)
    this.dados.turnos.push({
      ts, turno_id, origem: classe, tipo: tipoTurno, camada: inteiro(r.camada), modelo_respondeu: r.modelo_respondeu === 'primario' || r.modelo_respondeu === 'reserva' ? r.modelo_respondeu : null,
    })
    this.dados.tentativas = this.dados.tentativas.slice(-MAX_REGISTROS)
    this.dados.turnos = this.dados.turnos.slice(-MAX_REGISTROS)
    this.gravar()
  }

  tentativas(): Tentativa[] {
    return [...this.dados.tentativas]
  }

  resumo(): Resumo {
    const { turnos, tentativas } = this.dados
    const falhos = turnos.filter((t) => t.origem === 'falha').length
    const porTipo: Record<string, number> = {}
    for (const t of tentativas) porTipo[t.tipo] = (porTipo[t.tipo] ?? 0) + 1
    const comFalha = new Set(tentativas.map((t) => t.turno_id))
    const rec = { '1': 0, '2': 0 }
    let primario = 0
    let reserva = 0
    for (const t of turnos) {
      if (t.origem !== 'modelo') continue
      if (t.modelo_respondeu === 'primario') primario++
      else if (t.modelo_respondeu === 'reserva') reserva++
      if (comFalha.has(t.turno_id) && (t.camada === 1 || t.camada === 2)) rec[String(t.camada) as '1' | '2']++
    }
    const pct = turnos.length === 0 ? 0 : (falhos / turnos.length) * 100
    return {
      turnos_totais: turnos.length,
      turnos_falha: falhos,
      taxa_falha: `${pct.toFixed(1).replace('.', ',')} %`,
      tentativas_falhas_por_tipo: porTipo,
      recuperados_por_camada: rec,
      modelo_respondeu: { primario, reserva },
      entradas_invalidas: this.dados.entradas_invalidas,
    }
  }

  reset(): void {
    this.dados = { tentativas: [], turnos: [], entradas_invalidas: 0 }
    this.gravar()
  }
}
