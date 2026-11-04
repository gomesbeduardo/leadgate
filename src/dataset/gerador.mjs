// Rodada de geracao do dataset sintetico (spec 002, R14). Uma chamada por conversa, escolhida por categoria.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CATEGORIAS, amostrar, cobertura, conjuntoDoId, montarPromptGerador, marcacoesDoRevisao, proximaCategoria, revisaoMarkdown, schemaGerador, textoDoLead, validarConversa,
} from './dataset.mjs'

/** Cidade da chamada: ~20% fora da regiao configurada (1 a cada 5), as demais em rodizio pela lista. */
export function cidadeDaChamada(/** @type {any} */ cfg, /** @type {number} */ n) {
  const fora = ['Joinville', 'Curitiba', 'Porto Alegre', 'Pelotas', 'Blumenau']
  const dentro = cfg.regiao.cidades
  return n % 5 === 4 ? fora[Math.floor(n / 5) % fora.length] : dentro[n % dentro.length]
}

export async function rodarGeracao(/** @type {import('./gerador.mjs').OpcoesGeracao} */ o) {
  const { cfg, saidaDir, apiKey } = o
  const MINIMO = 5
  const log = o.log ?? (() => {})
  const base = (o.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')
  const refsCasos = [...o.referencias] // contra os casos vale a regra da spec: so a 1a mensagem do lead
  /** @type {string[]} */ const primeirasGeradas = [] // 1as mensagens das geradas (fora multiturno)
  /** @type {string[]} */ const leadsMulti = [] // texto inteiro do lead das multiturno geradas
  mkdirSync(saidaDir, { recursive: true })

  /** @type {any[]} */ const aceitas = []
  const reservadas = Object.fromEntries(CATEGORIAS.map((c) => [c, 0])) // aceitas + em voo
  const rejCat = Object.fromEntries(CATEGORIAS.map((c) => [c, 0])) // rejeicoes desta execucao, para ceder a vez
  const rejeitadas = { duplicata: 0, telefone: 0, schema: 0, api: 0 }
  const rejeitadasPorCategoria = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]))
  const tokens = { entrada: 0, saida: 0 }
  let chamadas = 0 // desta execucao
  let chamadasAnteriores = 0
  let emVoo = 0
  let inicio = new Date().toISOString()
  let volume = o.volume
  let proximoId = 1
  let marcas = {}
  const completar = o.completar === true
  const registrar = (/** @type {any} */ x) => {
    aceitas.push(x)
    reservadas[x.categoria]++
    proximoId = Math.max(proximoId, Number(String(x.id).replace(/\D/g, '')) + 1)
    const lead = x.conversa.filter((/** @type {any} */ m) => m.role === 'user')
    if (x.categoria === 'multiturno') leadsMulti.push(textoDoLead(lead))
    else primeirasGeradas.push(lead[0].content)
  }
  if (completar) {
    const ler = (/** @type {string} */ f) => {
      const caminho = join(saidaDir, f)
      if (!existsSync(caminho)) throw new Error(`--completar: ${caminho} nao existe`)
      return JSON.parse(readFileSync(caminho, 'utf8'))
    }
    const ex = ler('exemplos.json')
    const va = ler('validacao.json')
    const ant = existsSync(join(saidaDir, 'rodada.json')) ? ler('rodada.json') : {}
    for (const x of [...ex, ...va]) registrar(x)
    inicio = ant.data ?? inicio
    volume = ant.volume_pedido ?? volume
    chamadasAnteriores = ant.chamadas ?? 0
    for (const k of Object.keys(rejeitadas)) rejeitadas[/** @type {keyof typeof rejeitadas} */ (k)] = ant.rejeitadas?.[k] ?? 0
    for (const c of CATEGORIAS) rejeitadasPorCategoria[c] = ant.rejeitadas_por_categoria?.[c] ?? 0
    tokens.entrada = ant.tokens?.entrada ?? 0
    tokens.saida = ant.tokens?.saida ?? 0
    if (existsSync(join(saidaDir, 'revisao.md'))) marcas = marcacoesDoRevisao(readFileSync(join(saidaDir, 'revisao.md'), 'utf8'))
  }
  const faltam = () => CATEGORIAS.reduce((t, c) => t + Math.max(0, MINIMO - reservadas[c]), 0)
  // completar: no maximo 3x o que falta; rodada nova: o teto do config
  const maxChamadas = completar ? 3 * faltam() : cfg.dataset.max_chamadas
  const continuar = () => (completar ? faltam() > 0 : aceitas.length + emVoo < volume) && chamadas < maxChamadas
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
      rejeitadas_por_categoria: rejeitadasPorCategoria,
      categorias: cob.porCategoria,
      tokens,
      chamadas: chamadasAnteriores + chamadas,
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
    while (continuar()) {
      chamadas++
      emVoo++
      const n = chamadas
      // categoria que falha muito cede a vez, sem sair da fila
      // (completar so escolhe entre as categorias abaixo do minimo)
      const ajustada = Object.fromEntries(CATEGORIAS.map((c) => [c, reservadas[c] + Math.floor(rejCat[c] / 3)]))
      if (completar) for (const c of CATEGORIAS) if (reservadas[c] >= MINIMO) ajustada[c] = Infinity
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
        // multiturno compara o texto inteiro do lead entre as geradas (abertura curta e generica colide); as demais, a 1a mensagem
        const refs = categoria === 'multiturno' ? refsCasos : [...refsCasos, ...primeirasGeradas]
        const v = validarConversa(obj, cfg, refs, categoria, leadsMulti)
        if (v.ok) {
          const id = `sint-${String(proximoId).padStart(4, '0')}`
          reservadas[categoria]-- // registrar() conta de novo
          registrar({
            id, categoria, conjunto: conjuntoDoId(id), origem: 'sintetico',
            conversa: obj.conversa, gabarito: obj.gabarito, revisado: false, revisor_ok: null,
          })
        } else motivo = v.motivo
      } catch (e) {
        motivo = 'api'
        log(`chamada ${n}: ${String(e?.message ?? e)}`)
      }
      emVoo--
      if (motivo) {
        rejeitadas[/** @type {keyof typeof rejeitadas} */ (motivo)]++
        rejCat[categoria]++
        rejeitadasPorCategoria[categoria]++
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
  // marcacao ja trocada por humano nao se perde: a conversa marcada continua na amostra
  const amostra = amostrar(exemplos, cfg.dataset.amostra_revisao)
  for (const id of Object.keys(marcas)) {
    const x = exemplos.find((e) => e.id === id)
    if (x && !amostra.includes(x)) amostra.push(x)
  }
  writeFileSync(join(saidaDir, 'revisao.md'), revisaoMarkdown(amostra, marcas))
  log(`status ${rodada.status}; geradas ${rodada.geradas}/${volume}; chamadas ${chamadasAnteriores + chamadas}; tokens entrada ${tokens.entrada}, saida ${tokens.saida}; rejeitadas ${JSON.stringify(rejeitadas)}`)
  return rodada
}
