import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_EVENTOS = 5000
const DIA_MS = 86_400_000
const EFEITO_NO_LEAD = 'Os leads estão sem resposta.'

export type EventoQueda = {
  ts: string
  tipo_evento: 'queda' | 'recuperado'
  tipo_falha: string | null
  turnos_afetados: number
}
/** O que o canal recebe: o evento guardado mais o texto pronto (que nunca e gravado). */
export type EventoAlerta = EventoQueda & { assunto: string; texto: string }

export interface CanalAlerta {
  nome: string
  enviar(evento: EventoAlerta): Promise<void>
}

export type TurnoAlerta = { origem?: unknown; tipo?: unknown }

/** Maquina de estados pura da queda (R18). Entrada invalida (falha sem tipo) e ignorada. */
export function criarMaquinaQueda(cfg: { turnos_para_queda: number; intervalo_min: number }, agora: () => number, ultimo?: EventoQueda) {
  let consecutivos = 0
  let emQueda = ultimo?.tipo_evento === 'queda'
  let afetados = emQueda ? ultimo!.turnos_afetados : 0
  let ultimoAlerta = emQueda ? Date.parse(ultimo!.ts) : 0
  let tipoFalha: string | null = emQueda ? ultimo!.tipo_falha : null
  const evento = (tipo_evento: EventoQueda['tipo_evento']): EventoQueda => ({
    ts: new Date(agora()).toISOString(), tipo_evento, tipo_falha: tipoFalha, turnos_afetados: afetados,
  })
  return {
    registrar(t: TurnoAlerta): EventoQueda[] {
      if (t.origem === 'modelo') {
        consecutivos = 0
        if (!emQueda) return []
        emQueda = false
        const e = evento('recuperado')
        afetados = 0
        return [e]
      }
      if (t.origem !== 'falha' || typeof t.tipo !== 'string' || t.tipo === '') return []
      consecutivos++
      tipoFalha = t.tipo
      const grave = t.tipo === 'n8n' || t.tipo === 'servico'
      if (emQueda) {
        afetados++
        if (agora() - ultimoAlerta >= cfg.intervalo_min * 60_000) {
          ultimoAlerta = agora()
          return [evento('queda')]
        }
        return []
      }
      if (grave || consecutivos >= cfg.turnos_para_queda) {
        emQueda = true
        afetados = consecutivos
        ultimoAlerta = agora()
        return [evento('queda')]
      }
      return []
    },
  }
}

export const preencher = (modelo: string, v: Record<string, string>) =>
  modelo.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (v[k] ?? m))

type ArquivoAlertas = { eventos: EventoQueda[]; alerta_nao_entregue: number }

export class AlertasStore {
  private dados: ArquivoAlertas = { eventos: [], alerta_nao_entregue: 0 }
  private readonly arquivo?: string

  constructor(private readonly o: { dir?: string; agora?: () => number; retencaoDias: number }) {
    if (o.dir) this.arquivo = join(o.dir, 'alertas.json')
    if (this.arquivo && existsSync(this.arquivo)) {
      try {
        const j = JSON.parse(readFileSync(this.arquivo, 'utf8'))
        const corte = (o.agora ?? Date.now)() - o.retencaoDias * DIA_MS
        this.dados = {
          eventos: Array.isArray(j.eventos) ? j.eventos.filter((e: EventoQueda) => Date.parse(e.ts) >= corte) : [],
          alerta_nao_entregue: typeof j.alerta_nao_entregue === 'number' ? j.alerta_nao_entregue : 0,
        }
      } catch {
        /* arquivo corrompido: recomeca vazio */
      }
    }
  }

  private gravar() {
    if (!this.arquivo) return
    mkdirSync(this.o.dir!, { recursive: true })
    const tmp = `${this.arquivo}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.dados))
    renameSync(tmp, this.arquivo)
  }

  adicionar(e: EventoQueda) {
    const { ts, tipo_evento, tipo_falha, turnos_afetados } = e
    this.dados.eventos = [...this.dados.eventos, { ts, tipo_evento, tipo_falha, turnos_afetados }].slice(-MAX_EVENTOS)
    this.gravar()
  }

  incNaoEntregue() {
    this.dados.alerta_nao_entregue++
    this.gravar()
  }

  json(): ArquivoAlertas {
    return { eventos: [...this.dados.eventos], alerta_nao_entregue: this.dados.alerta_nao_entregue }
  }
}

type Env = Record<string, string | undefined>

export const canalSimulado = (log: (l: string) => void): CanalAlerta => ({
  nome: 'simulado',
  async enviar(e) {
    log(`ALERTA ${e.tipo_evento} ${e.ts} ${e.texto}`)
  },
})

export const canalResend = (env: Env): CanalAlerta => ({
  nome: 'resend',
  async enviar(e) {
    const base = (env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/$/, '')
    const r = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: env.ALERTA_EMAIL_DE, to: [env.ALERTA_EMAIL_PARA], subject: e.assunto, text: e.texto }),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) throw new Error(`resend HTTP ${r.status}`)
  },
})

/** O simulado sempre roda; o resend entra com ALERTA_CANAL=resend e RESEND_API_KEY. */
export function criarCanais(env: Env, log: (l: string) => void): CanalAlerta[] {
  const canais = [canalSimulado(log)]
  if (env.ALERTA_CANAL === 'resend') {
    if (env.RESEND_API_KEY) canais.push(canalResend(env))
    else log('ALERTA_CANAL=resend sem RESEND_API_KEY: usando so o canal simulado')
  }
  return canais
}

const hora = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(ms)

export function criarNotificador(o: {
  empresa: string
  turnosParaQueda: number
  intervaloMin: number
  agora: () => number
  store: AlertasStore
  canais: CanalAlerta[]
  textos: { alerta_queda: string; alerta_recuperado: string }
  log?: (linha: string) => void
}) {
  // Reinicio no meio de uma queda: retoma nela, para o primeiro turno bom emitir `recuperado`.
  const maquina = criarMaquinaQueda({ turnos_para_queda: o.turnosParaQueda, intervalo_min: o.intervaloMin }, o.agora, o.store.json().eventos.at(-1))
  const log = o.log ?? console.error
  const pendentes = new Set<Promise<void>>()
  const emitir = async (e: EventoQueda) => {
    // Persistir nunca bloqueia os canais: a lista em memoria ja foi atualizada antes de gravar.
    try {
      o.store.adicionar(e)
    } catch (err) {
      log(`falha ao gravar o alerta em disco: ${err instanceof Error ? err.message : String(err)}`)
    }
    const queda = e.tipo_evento === 'queda'
    const texto = preencher(queda ? o.textos.alerta_queda : o.textos.alerta_recuperado, {
      'empresa.nome': o.empresa,
      hora: hora(Date.parse(e.ts)),
      tipo: e.tipo_falha ?? '',
      efeito_no_lead: EFEITO_NO_LEAD,
      n: String(e.turnos_afetados),
    })
    const assunto = queda ? `Atendimento automático da ${o.empresa} parou` : `Atendimento automático da ${o.empresa} voltou`
    await Promise.all(
      o.canais.map(async (c) => {
        try {
          await c.enviar({ ...e, assunto, texto })
        } catch {
          if (c.nome === 'simulado') return
          try {
            o.store.incNaoEntregue()
          } catch {
            /* contador em memoria ja subiu; disco falhou */
          }
        }
      }),
    )
  }
  return {
    /** Nao bloqueia o turno do lead. */
    tratar(t: TurnoAlerta): void {
      for (const e of maquina.registrar(t)) {
        const p = emitir(e).catch(() => {}).finally(() => pendentes.delete(p))
        pendentes.add(p)
      }
    },
    aguardar: async () => {
      await Promise.all([...pendentes])
    },
  }
}
