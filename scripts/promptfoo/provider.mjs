// Provider do promptfoo: conduz a conversa pelo /api/chat como o laco de scripts/avaliar.mjs e devolve o ultimo turno.
// Falha de HTTP ou de rede volta como { error }, nunca como sucesso falso.
export default class ProviderChat {
  constructor(options = {}) {
    this.url = options.config?.url
    this.rotulo = options.label ?? options.id ?? 'provider'
  }

  id() {
    return this.rotulo
  }

  async chamar(historico, tentativaRede = 0) {
    try {
      const r = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ historico }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { http: true })
      return await r.json()
    } catch (e) {
      const rede = !e.http && e.name !== 'TimeoutError' && e.name !== 'SyntaxError'
      if (rede && tentativaRede === 0) return this.chamar(historico, 1)
      throw e
    }
  }

  async callApi(_prompt, context) {
    let mensagens = context?.vars?.mensagens
    if (typeof mensagens === 'string') {
      try {
        mensagens = JSON.parse(mensagens)
      } catch {}
    }
    if (!this.url) return { error: 'url do provider nao configurada' }
    if (!Array.isArray(mensagens) || mensagens.length === 0) return { error: 'caso sem mensagens' }
    const historico = []
    let ultimo = null
    try {
      for (const msg of mensagens) {
        historico.push({ role: 'user', content: msg })
        ultimo = await this.chamar(historico)
        historico.push({ role: 'assistant', content: ultimo.resposta ?? '' })
        if (ultimo.proxima_acao !== 'perguntar') break
      }
    } catch (e) {
      return { error: `${this.url}: ${String(e?.message ?? e)}` }
    }
    return { output: ultimo }
  }
}
