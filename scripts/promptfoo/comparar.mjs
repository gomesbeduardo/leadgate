// Compara duas versoes do sistema (base e branch) com o promptfoo: 3 rodadas, conjunto de ajuste.
// Antes: npm ci --prefix scripts/promptfoo --ignore-scripts (o promptfoo vive num pacote proprio, fora da raiz).
// Uso: npm run comparar:prompt [-- --saida arquivo.json]. Sobe antes as duas pilhas (README) e ajuste COMPARAR_URL_BASE / COMPARAR_URL_BRANCH.
// O veredito sai do JSON e de somar.mjs; o codigo de saida do promptfoo (nao zero quando uma asserção falha) e ignorado.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { somar, tabelaMarkdown } from './somar.mjs'

const aqui = fileURLToPath(new URL('.', import.meta.url))
// Porta 9 (descarte): ninguem escuta. So um parametro interno pode trocar, nunca uma variavel de ambiente.
const PROXY_MORTO = 'http://127.0.0.1:9'

/** Ambiente forcado: nada do que veio herdado liga telemetria, compartilhamento nem escreve em ~/.promptfoo.
 * Opt-out documentado em https://www.promptfoo.dev/docs/configuration/telemetry/ (PROMPTFOO_DISABLE_TELEMETRY=1); so ele nao basta no 0.124.1 (ver o proxy abaixo). */
export function montarEnv(dir, herdado = process.env, proxy = PROXY_MORTO) {
  return {
    ...herdado,
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_UPDATE: '1',
    PROMPTFOO_DISABLE_REMOTE_GENERATION: '1',
    PROMPTFOO_DISABLE_SHARING: '1',
    PROMPTFOO_DISABLE_SHARE_EMAIL_REQUEST: '1',
    PROMPTFOO_CONFIG_DIR: dir,
    PROMPTFOO_CACHE_PATH: dir,
    PROMPTFOO_LOG_DIR: dir,
    // Com a telemetria desligada o promptfoo 0.124.1 ainda avisa r.promptfoo.app ("telemetry disabled"): o proxy morto
    // (porta 9, descarte) derruba essa chamada HTTPS. O trafego local (as pilhas e os servidores falsos) segue direto.
    HTTPS_PROXY: proxy,
    https_proxy: proxy,
    HTTP_PROXY: proxy,
    http_proxy: proxy,
    ALL_PROXY: proxy,
    all_proxy: proxy,
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  }
}

/** @returns {Promise<{ codigo: number, saida: string }>} */
export async function comparar({ saida, env = process.env, log = console.log, silencioso = false, proxy, bin = resolve(aqui, 'node_modules/.bin/promptfoo') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'comparar-prompt-'))
  const arquivo = resolve(saida ?? join(dir, 'resultado.json'))
  const args = ['eval', '-c', join(aqui, 'promptfooconfig.yaml'), '-o', arquivo, '--no-cache', '--no-write']
  // O promptfoo mora num pacote isolado (scripts/promptfoo); sem ele nada roda e o --saida existente fica como esta.
  if (!existsSync(bin)) {
    log(`comparação inválida: promptfoo não instalado em ${bin}. Instale com: npm ci --prefix scripts/promptfoo --ignore-scripts`)
    return { codigo: 1, saida: arquivo }
  }
  // Resultado de uma rodada anterior nunca pode virar veredito desta.
  rmSync(arquivo, { force: true })
  const morreu = await new Promise((ok, falha) => {
    const filho = spawn(bin, args, { cwd: aqui, env: montarEnv(dir, env, proxy), stdio: ['ignore', silencioso ? 'ignore' : 'inherit', silencioso ? 'ignore' : 'inherit'] })
    filho.on('error', falha)
    // O codigo de saida do promptfoo nao decide nada: asserção reprovada tambem sai diferente de zero.
    // Processo morto por sinal (codigo null) ou que nem iniciou invalida a rodada, haja arquivo ou nao.
    filho.on('close', (codigo, sinal) => ok(codigo === null ? `processo encerrado por sinal ${sinal}` : null))
  }).catch((e) => `falha ao executar o promptfoo: ${e.message}`)
  if (morreu) {
    log(`comparação inválida: ${morreu}`)
    return { codigo: 1, saida: arquivo }
  }
  let r
  try {
    r = somar(JSON.parse(readFileSync(arquivo, 'utf8')))
  } catch (e) {
    log(`comparação inválida: ${e.message}`)
    return { codigo: 1, saida: arquivo }
  }
  log(tabelaMarkdown(r))
  for (const p of r.problemas) log(`comparação inválida: ${p}`)
  if (r.valido && r.bloqueado) log('bloqueado: a soma da branch ficou abaixo da base em algum campo')
  if (r.aprovado) log('aprovado: nenhum campo da branch ficou abaixo da base')
  return { codigo: r.aprovado ? 0 : 1, saida: arquivo }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--saida')
  const { codigo } = await comparar({ saida: i >= 0 ? process.argv[i + 1] : undefined })
  process.exit(codigo)
}
