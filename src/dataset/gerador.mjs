// Rodada de geracao do dataset sintetico (spec 002, R14). Uma chamada por conversa, escolhida por categoria.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CATEGORIAS, amostrar, cobertura, conjuntoDoId, montarPromptGerador, proximaCategoria, revisaoMarkdown, schemaGerador, validarConversa,
} from './dataset.mjs'

/** Cidade da chamada: ~20% fora da regiao configurada (1 a cada 5), as demais em rodizio pela lista. */
export function cidadeDaChamada(/** @type {any} */ cfg, /** @type {number} */ n) {
  const fora = ['Joinville', 'Curitiba', 'Porto Alegre', 'Pelotas', 'Blumenau']
  const dentro = cfg.regiao.cidades
  return n % 5 === 4 ? fora[Math.floor(n / 5) % fora.length] : dentro[n % dentro.length]
}

export async function rodarGeracao(/** @type {import('./gerador.mjs').OpcoesGeracao} */ o) {
  const { cfg, saidaDir, volume, apiKey } = o
  const log = o.log ?? (() => {})
  const base = (o.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')
  const maxChamadas = cfg.dataset.max_chamadas
  const refs = [...o.referencias]
  mkdirSync(saidaDir, { recursive: true })

  /** @type {any[]} */ const aceitas = []
  const reservadas = Object.fromEntries(CATEGORIAS.map((c) => [c, 0])) // aceitas + em voo
  const rejCat = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]))
  const rejeitadas = { duplicata: 0, telefone: 0, schema: 0, api: 0 }
  const tokens = { entrada: 0, saida: 0 }
  let chamadas = 0
  let emVoo = 0
  const inicio = new Date().toISOString()
  const schema = schemaGerador(cfg)

  const gravar = (/** @type {'em_andamento'|'completa'|'incompleta'} */ status) => {
    const ex = aceitas.filter((x) => x.conjunto === 'exemplos')
    const va = aceitas.filter((x) => x.conjunto === 'validacao')
    const cob = cobertura(aceitas, 5)
    writeFileSync(join(saidaDir, 'exemplos.json'), JSON.stringify(ex, null, 2) + '\n')
    writeFileSync(join(saidaDir, 'validacao.json'), JSON.stringify(va, null, 2) + '\n')
    const rodada = {
      data: inicio,
      modelo: cfg.ia.modelo,
      volume_pedido: volume,
      geradas: aceitas.length,
      rejeitadas,
      categorias: cob.porCategoria,
      tokens,
      chamadas,
      status,
      // So um humano libera o prompt, depois de revisar a amostra (R14). Esta rodada nunca libera.
      prompt_liberado: false,
    }
    writeFileSync(join(saidaDir, 'rodada.json'), JSON.stringify(rodada, null, 2) + '\n')
    return rodada
  }

  async function uma(/** @type {number} */ n, /** @type {string} */ categoria) {
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2026-10-21', 'x-api-key': apiKey },
      body: JSON.stringify({
        model: cfg.ia.modelo,
        max_tokens: cfg.ia.max_tokens,
        system: montarPromptGerador(cfg, categoria, cidadeDaChamada(cfg, n)),
        messages: [{ role: 'user', content: `Gere uma conversa. categoria: ${categoria}. variacao: ${n}` }],
        output_config: { effort: cfg.ia.effort, format: { type: 'json_schema', schema } },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }

  async function trabalhador() {
    while (aceitas.length + emVoo < volume && chamadas < maxChamadas) {
      chamadas++
      emVoo++
      const n = chamadas
      // categoria que falha muito cede a vez, sem sair da fila
      const ajustada = Object.fromEntries(CATEGORIAS.map((c) => [c, reservadas[c] + Math.floor(rejCat[c] / 3)]))
      const categoria = proximaCategoria(ajustada)
      reservadas[categoria]++
      let motivo = null
      try {
        const resp = await uma(n, categoria)
        tokens.entrada += resp?.usage?.input_tokens ?? 0
        tokens.saida += resp?.usage?.output_tokens ?? 0
        let obj = null
        if (resp?.stop_reason === 'end_turn') {
          const bloco = (resp.content ?? []).find((/** @type {any} */ b) => b?.type === 'text')
          try {
            obj = JSON.parse(bloco?.text ?? '')
          } catch {
            obj = null
          }
        }
        const v = validarConversa(obj, cfg, refs, categoria)
        if (v.ok) {
          const id = `sint-${String(aceitas.length + 1).padStart(4, '0')}`
          aceitas.push({
            id, categoria, conjunto: conjuntoDoId(id), origem: 'sintetico',
            conversa: obj.conversa, gabarito: obj.gabarito, revisado: false, revisor_ok: null,
          })
          refs.push(obj.conversa[0].content)
        } else motivo = v.motivo
      } catch (e) {
        motivo = 'api'
        log(`chamada ${n}: ${String(e?.message ?? e)}`)
      }
      emVoo--
      if (motivo) {
        rejeitadas[/** @type {keyof typeof rejeitadas} */ (motivo)]++
        rejCat[categoria]++
        reservadas[categoria]--
      }
      gravar('em_andamento')
    }
  }

  gravar('em_andamento')
  await Promise.all(Array.from({ length: o.concorrencia ?? 4 }, trabalhador))

  const cob = cobertura(aceitas, 5)
  const completa = cob.completa && aceitas.length >= Math.min(volume, 60)
  const rodada = gravar(completa ? 'completa' : 'incompleta')
  const exemplos = aceitas.filter((x) => x.conjunto === 'exemplos')
  writeFileSync(join(saidaDir, 'revisao.md'), revisaoMarkdown(amostrar(exemplos, cfg.dataset.amostra_revisao)))
  log(`status ${rodada.status}; geradas ${rodada.geradas}/${volume}; chamadas ${chamadas}; tokens entrada ${tokens.entrada}, saida ${tokens.saida}; rejeitadas ${JSON.stringify(rejeitadas)}`)
  return rodada
}
