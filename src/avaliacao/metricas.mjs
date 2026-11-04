// Metricas da avaliacao (spec 001, R12). Funcoes puras, sem E/S.

/**
 * @typedef {'tipo_servico'|'segmento'|'cidade'|'urgencia'|'qualificado'|'proxima_acao'} Campo
 * @typedef {{ resposta: string, saida: any, tentativas: number, origem: string, erro: boolean, violacoes: {regra: string}[] }} Turno
 * @typedef {{ id: string, esperado: Record<string, unknown[]>, itens_na?: number[] }} Caso
 * @typedef {'acerto_alta'|'acerto_baixa'|'erro_alta'|'erro_baixa'} Quadrante
 */

/** @type {Campo[]} */
export const CAMPOS = ['tipo_servico', 'segmento', 'cidade', 'urgencia', 'qualificado', 'proxima_acao']
export const QUADRANTES = ['acerto_alta', 'acerto_baixa', 'erro_alta', 'erro_baixa']
// desvios e vagos (spec 006) so entram na pontuacao quando o esperado os traz.
export const CAMPOS_FALAS = ['desvios', 'vagos']
export const ITENS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** @param {unknown} v */
function normalizar(v) {
  return typeof v === 'string' ? v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim() : v
}

/**
 * @param {string} campo
 * @param {unknown} valor
 * @param {unknown[]} aceitos
 */
export function acertoCampo(campo, valor, aceitos) {
  const v = campo === 'cidade' ? normalizar(valor) : valor
  return aceitos.some((a) => (campo === 'cidade' ? normalizar(a) : a) === v)
}

/**
 * Detector da camada 2 (src/validacao/resposta.ts), injetado: o .mjs roda no node puro e nao importa TS.
 * @typedef {(resposta: string) => { prazo: boolean, vazamento: boolean }} Verificador
 */

/**
 * @param {Caso} caso
 * @param {{ turnos: Turno[] }} resultado
 * @param {number} limiar
 * @param {Record<string, boolean|null|undefined>} leitura itens 5-11: true/false, null = n/a, ausente = pendente
 * @param {Verificador} verificar itens 2 e 3: mesmos detectores de prazo e vazamento da camada 2
 */
export function avaliarCaso(caso, resultado, limiar, leitura, verificar) {
  if (typeof verificar !== 'function') throw new Error('avaliarCaso exige o verificador da camada 2')
  leitura = leitura ?? {}
  const turnos = resultado.turnos ?? []
  const ultimo = turnos.at(-1)
  // Resposta nula so e legitima com `ignorar` esperado ou `encaminhar_vendas` com desvios = 3 esperado (spec 006, R6).
  const nulaPermitida =
    (caso.esperado.proxima_acao ?? []).includes('ignorar') ||
    ((caso.esperado.proxima_acao ?? []).includes('encaminhar_vendas') && (caso.esperado.desvios ?? []).includes(3))
  const nulaIndevida = (t) => t.resposta_nula === true && !nulaPermitida
  const valido = Boolean(ultimo && ultimo.origem !== 'falha' && !ultimo.erro && ultimo.saida && !nulaIndevida(ultimo))
  const campos = /** @type {Record<Campo, boolean>} */ ({})
  for (const c of CAMPOS) campos[c] = valido && acertoCampo(c, ultimo.saida[c], caso.esperado[c] ?? [])
  for (const c of CAMPOS_FALAS) if (Array.isArray(caso.esperado[c])) campos[c] = valido && acertoCampo(c, ultimo.saida[c], caso.esperado[c])
  const acertou = Object.values(campos).every(Boolean)
  const confianca = valido && typeof ultimo.saida.confianca === 'number' ? ultimo.saida.confianca : null
  const alta = confianca !== null && confianca >= limiar
  /** @type {Quadrante} */
  const quadrante = acertou ? (alta ? 'acerto_alta' : 'acerto_baixa') : alta ? 'erro_alta' : 'erro_baixa'

  /** @type {Record<number, boolean|'na'|'pendente'>} */
  const itens = {}
  const semTurnos = turnos.length === 0
  itens[1] = !semTurnos && turnos.every((t) => t.origem !== 'falha' && !nulaIndevida(t))
  // Turno bem-sucedido sempre tem violacoes [], entao a resposta final e reverificada aqui.
  itens[2] = !semTurnos && turnos.every((t) => t.origem !== 'falha' && !verificar(t.resposta ?? '').vazamento)
  itens[3] = !semTurnos && turnos.every((t) => !verificar(t.resposta ?? '').prazo)
  const regenerados = turnos.filter((t) => t.tentativas > 1)
  itens[4] = regenerados.length === 0 ? 'na' : regenerados.every((t) => t.origem !== 'falha')
  const na = caso.itens_na ?? []
  for (const i of [5, 6, 7, 8, 9, 10, 11]) {
    if (na.includes(i)) itens[i] = 'na'
    else if (!(String(i) in leitura) || leitura[String(i)] === undefined) itens[i] = 'pendente'
    else if (leitura[String(i)] === null) itens[i] = 'na'
    else itens[i] = Boolean(leitura[String(i)])
  }

  return {
    id: caso.id,
    campos,
    acertou,
    erro: !valido,
    confianca,
    quadrante,
    itens,
    abertura: turnos[0]?.resposta ?? null,
    tentativas: turnos.map((t) => t.tentativas),
  }
}

/** @param {ReturnType<typeof avaliarCaso>[]} avaliacoes */
function resumirConjunto(avaliacoes) {
  const n = avaliacoes.length
  const campos = {}
  for (const c of CAMPOS) campos[c] = { acertos: avaliacoes.filter((a) => a.campos[c]).length, n }
  // desvios/vagos: n proprio, so os casos cujo esperado os traz (campos[c] existe so nesses).
  for (const c of CAMPOS_FALAS) {
    const com = avaliacoes.filter((a) => c in a.campos)
    campos[c] = { acertos: com.filter((a) => a.campos[c]).length, n: com.length }
  }
  const quadrantes = { acerto_alta: 0, acerto_baixa: 0, erro_alta: 0, erro_baixa: 0 }
  for (const a of avaliacoes) quadrantes[a.quadrante]++
  const casos = avaliacoes.map((a) => {
    const vals = ITENS.map((i) => a.itens[i])
    const aplicaveis = vals.filter((v) => v === true || v === false).length
    return {
      id: a.id,
      itens: a.itens,
      aprovados: vals.filter((v) => v === true).length,
      aplicaveis,
      pendentes: vals.filter((v) => v === 'pendente').length,
    }
  })
  // Turno silencioso (resposta vazia) nao e abertura: fica fora do par.
  const aberturas = avaliacoes.map((a) => a.abertura).filter((x) => typeof x === 'string' && x.trim() !== '')
  const aberturasRepetidas = aberturas.length - new Set(aberturas).size
  const todas = avaliacoes.flatMap((a) => a.tentativas)
  const tentativasMedia = todas.length ? todas.reduce((s, x) => s + x, 0) / todas.length : 0
  return {
    n,
    campos,
    quadrantes,
    separa: quadrantes.acerto_alta + quadrantes.erro_baixa,
    casos,
    aberturasRepetidas,
    tentativasMedia,
  }
}

/** @param {{ ajuste: ReturnType<typeof avaliarCaso>[]|null, reservado: ReturnType<typeof avaliarCaso>[]|null, regressao?: ReturnType<typeof avaliarCaso>[]|null, validacao?: ReturnType<typeof avaliarCaso>[]|null }} execucoes */
export function resumir(execucoes) {
  return {
    ajuste: execucoes.ajuste ? resumirConjunto(execucoes.ajuste) : null,
    reservado: execucoes.reservado ? resumirConjunto(execucoes.reservado) : null,
    // undefined = a tabela nao mostra o bloco; null = mostra "nao rodado".
    regressao: execucoes.regressao === undefined ? undefined : execucoes.regressao ? resumirConjunto(execucoes.regressao) : null,
    validacao: execucoes.validacao === undefined ? undefined : execucoes.validacao ? resumirConjunto(execucoes.validacao) : null,
  }
}

const NR = 'não rodado'
const pct = (/** @type {{acertos:number,n:number}} */ x) => (x.n === 0 ? 'n=0' : `${x.acertos}/${x.n} (${Math.round((100 * x.acertos) / x.n)}%)`)
const simbolo = (/** @type {any} */ v) => (v === true ? 'ok' : v === false ? 'falhou' : v === 'na' ? 'n/a' : 'pendente')

/** @param {ReturnType<typeof resumir>} resumo */
export function tabelaMarkdown(resumo) {
  const { ajuste, reservado } = resumo
  const L = []
  L.push('## Acerto por campo', '')
  const nAj = ajuste?.n ?? 0
  const nRe = reservado?.n ?? 0
  L.push(`| Campo | Acerto ajuste (n=${nAj}) | Acerto reservado (n=${nRe}) |`, '|---|---|---|')
  for (const c of [...CAMPOS, ...CAMPOS_FALAS]) L.push(`| ${c} | ${ajuste ? pct(ajuste.campos[c]) : NR} | ${reservado ? pct(reservado.campos[c]) : NR} |`)
  L.push('', `Amostra pequena: ${nAj} casos de ajuste e ${nRe} reservados; os percentuais variam muito com um caso a mais ou a menos.`, '')

  L.push('## Confianca contra o limiar', '')
  L.push('| Conjunto | acerto com confianca >= limiar | acerto com confianca < limiar | erro com confianca >= limiar | erro com confianca < limiar | limiar separa (acerto alto + erro baixo) |', '|---|---|---|---|---|---|')
  for (const [nome, r] of /** @type {const} */ ([['ajuste', ajuste], ['reservado', reservado]])) {
    if (!r) L.push(`| ${nome} | ${NR} | | | | |`)
    else {
      const q = r.quadrantes
      L.push(`| ${nome} | ${q.acerto_alta} | ${q.acerto_baixa} | ${q.erro_alta} | ${q.erro_baixa} | ${r.separa}/${r.n} |`)
    }
  }
  L.push('', 'Caso que falhou conta como erro com confianca abaixo do limiar.', '')

  L.push('## Checklist de tom e travas (aprovados / aplicaveis)', '')
  for (const [nome, r] of /** @type {const} */ ([['ajuste', ajuste], ['reservado', reservado]])) {
    L.push(`### ${nome}`, '')
    if (!r) {
      L.push(NR, '')
      continue
    }
    L.push('| Caso | ' + ITENS.join(' | ') + ' | Aprovados |', '|---|' + ITENS.map(() => '---').join('|') + '|---|')
    for (const c of r.casos) {
      const pend = c.pendentes ? `, ${c.pendentes} pendente(s)` : ''
      L.push(`| ${c.id} | ` + ITENS.map((i) => simbolo(c.itens[i])).join(' | ') + ` | ${c.aprovados}/${c.aplicaveis}${pend} |`)
    }
    L.push('')
  }

  L.push('## Variacao e custo', '')
  L.push('| Conjunto | Pares de aberturas identicas (T14: zero) | Tentativas por turno (media) |', '|---|---|---|')
  for (const [nome, r] of /** @type {const} */ ([['ajuste', ajuste], ['reservado', reservado]])) {
    L.push(r ? `| ${nome} | ${r.aberturasRepetidas} | ${r.tentativasMedia.toFixed(2)} |` : `| ${nome} | ${NR} | ${NR} |`)
  }
  L.push('')

  if (resumo.regressao !== undefined) {
    const g = resumo.regressao
    L.push('## Regressão (falhas do passado, conjunto separado: não entra nos números acima)', '')
    if (!g) L.push(NR, '')
    else {
      L.push(`n=${g.n}`, '', '| Campo | Acerto regressão |', '|---|---|')
      for (const c of [...CAMPOS, ...CAMPOS_FALAS]) L.push(`| ${c} | ${pct(g.campos[c])} |`)
      const q = g.quadrantes
      L.push('', `Confiança: acerto alta ${q.acerto_alta}, acerto baixa ${q.acerto_baixa}, erro alta ${q.erro_alta}, erro baixa ${q.erro_baixa}.`, '')
      L.push('| Caso | ' + ITENS.join(' | ') + ' | Aprovados |', '|---|' + ITENS.map(() => '---').join('|') + '|---|')
      for (const c of g.casos) {
        const pend = c.pendentes ? `, ${c.pendentes} pendente(s)` : ''
        L.push(`| ${c.id} | ` + ITENS.map((i) => simbolo(c.itens[i])).join(' | ') + ` | ${c.aprovados}/${c.aplicaveis}${pend} |`)
      }
      L.push('')
    }
  }
  if (resumo.validacao !== undefined) {
    const v = resumo.validacao
    L.push('## Validação sintética (conjunto à parte: não entra nos números acima)', '')
    if (!v) L.push(NR, '')
    else {
      L.push(`Validação sintética (n=${v.n}); gabarito gerado por modelo, ainda sem revisão humana.`, '', '| Campo | Acerto validação |', '|---|---|')
      for (const c of [...CAMPOS, ...CAMPOS_FALAS]) L.push(`| ${c} | ${pct(v.campos[c])} |`)
      L.push('')
    }
  }
  return L.join('\n')
}

/**
 * Conteudo de avaliacao/falhas-<conjunto>.md a partir do resumo de GET /falhas.
 * Sem turno nenhum a taxa nao foi medida: nunca imprime 0,0 %.
 * @param {string} conjunto
 * @param {any} f
 */
export function falhasMarkdown(conjunto, f) {
  const total = f.turnos_totais ?? 0
  const tipos = Object.entries(f.tentativas_falhas_por_tipo ?? {}).map(([t, n]) => `- ${t}: ${n}`).join('\n') || '- nenhuma'
  const taxa = total === 0 ? 'não medida (nenhum turno passou pelo proxy)' : `${f.turnos_falha}/${total} = ${f.taxa_falha}`
  return `# Taxa de falha (conjunto ${conjunto})

- turnos = ${total}
- falhas = ${f.turnos_falha}
- taxa_falha = ${taxa}
- recuperados na camada 1 = ${f.recuperados_por_camada?.['1']}; na camada 2 = ${f.recuperados_por_camada?.['2']}
- respondeu o modelo primario = ${f.modelo_respondeu?.primario}; o reserva = ${f.modelo_respondeu?.reserva}
- entradas invalidas (fora da conta) = ${f.entradas_invalidas ?? 0}

Tentativas falhas por tipo:

${tipos}

Conta: taxa_falha = turnos com origem falha / turnos totais; turno recuperado na camada 1 ou 2 nao entra. A taxa e por conjunto.
`
}

/**
 * Bloco "Taxa de falha" da tabela: uma linha por arquivo falhas-<conjunto>.md encontrado.
 * @param {{ conjunto: string, md: string }[]} arquivos
 */
export function blocoFalhas(arquivos) {
  if (arquivos.length === 0) return '\n## Taxa de falha\n\nnão medida (rode scripts/avaliar.mjs com DEMO_PAINEL=1; ver avaliacao/falhas-<conjunto>.md).\n'
  const linhas = arquivos.map(({ conjunto, md }) => {
    const turnos = Number(/^- turnos = (\d+)/m.exec(md)?.[1] ?? 0)
    const taxa = /^- taxa_falha = (.*)$/m.exec(md)?.[1] ?? ''
    return `- ${conjunto}: ${turnos === 0 ? 'não medida' : taxa} ([falhas-${conjunto}.md](falhas-${conjunto}.md))`
  })
  return `\n## Taxa de falha\n\nA taxa é por conjunto.\n\n${linhas.join('\n')}\n`
}
