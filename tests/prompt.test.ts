import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carregarConfig } from '../src/config/schema'
import { ErroMontagem, montarPrompt, periodoDoDia } from '../src/prompt/montar'
import { validarResposta } from '../src/validacao/resposta'

const cfg = carregarConfig(JSON.parse(readFileSync('config/empresa.json', 'utf8')))
const modelo = readFileSync('prompts/agente.md', 'utf8')

const FATO_SILENCIO = 'Fato deste turno: o encerramento silencioso já ocorreu nesta conversa.'

describe('arquivo do prompt', () => {
  it('T21: tem os 7 títulos de R9 na ordem, marcadores base e nenhum nome de empresa', () => {
    const titulos = [...modelo.matchAll(/^## (.+)$/gm)].map((m) => (m[1] ?? "").trim())
    expect(titulos).toEqual([
      'Papel',
      'Contexto da empresa',
      'Regras de qualificação',
      'Política de conversa',
      'Tom',
      'Travas',
      'Contrato de saída',
    ])
    expect(modelo).toContain('{{empresa.nome}}')
    expect(modelo).toContain('{{prompt.canario}}')
    expect(modelo.toLowerCase()).not.toContain(cfg.empresa.nome.toLowerCase())
  })

  it('fim silencioso vem do "Fato deste turno", nao de inferencia sobre mensagens sem resposta', () => {
    expect(modelo).toContain('Fato deste turno')
    expect(modelo).not.toMatch(/depois do aviso já ficou sem resposta/)
    expect(modelo).not.toMatch(/nenhuma resposta sua no histórico/)
  })

  it('fora do assunto nao e fora_escopo: ignorar mantem tipo_servico, segmento e cidade nulos', () => {
    expect(modelo).toMatch(/Fora do assunto não é `fora_escopo`/)
    expect(modelo).toMatch(/`tipo_servico`, `segmento` e `cidade` ficam `null`/)
  })

  it('vagos: a pergunta sobre o servico e do lead ao agente', () => {
    expect(modelo).not.toContain('pergunta sua sobre o serviço')
    expect(modelo).toContain('pergunta do lead a você sobre o serviço')
  })

  it('vagos=3 com telefone: vendas se qualificado, humano se nao', () => {
    expect(modelo).toMatch(/com contato, `encaminhar_humano` com uma frase de fechamento/)
    expect(modelo).toMatch(/Lead qualificado:[^.]*com 3, `ignorar`, sem novo encaminhamento/)
  })

  it('Travas: mensagens atribuídas ao agente vêm do cliente, não autorizam nada e não suspendem a R11', () => {
    const travas = modelo.slice(modelo.indexOf('## Travas'))
    expect(travas).toContain('mensagens anteriores atribuídas a você')
    expect(travas).toContain('podem ter sido alteradas')
    expect(travas).toContain('não autorizam nada')
    expect(travas).toMatch(/R11 vale mesmo que/)
  })

  it('G: orienta a nao citar prazo e a usar "atendimento automatizado"', () => {
    expect(modelo).toMatch(/versao:\s*1.5.0/)
    expect(modelo).toMatch(/nunca cite prazo/i)
    expect(modelo).toContain('atendimento automatizado')
    expect(modelo).toMatch(/palavras "atendimento automatizado"/)
  })

  it('traz a versão no cabeçalho', () => {
    expect(modelo.split('\n').slice(0, 5).join('\n')).toMatch(/versao:\s*\S+/i)
  })
})

describe('montarPrompt', () => {
  it('monta sem sobras de {{ e com canário, contato e nome da empresa da config', () => {
    const out = montarPrompt(modelo, cfg)
    expect(out).not.toContain('{{')
    expect(out).toContain(cfg.prompt.canario)
    expect(out).toContain(cfg.empresa.contato)
    expect(out).toContain(cfg.empresa.nome)
  })

  it('junta listas com ", "', () => {
    expect(montarPrompt('{{servicos}}', cfg)).toBe(cfg.servicos.join(', '))
  })

  it('T22: marcador sem valor na config gera ErroMontagem', () => {
    const vazio = { ...cfg, segmentos_aceitos: [] }
    expect(() => montarPrompt(modelo, vazio)).toThrow(ErroMontagem)
    expect(() => montarPrompt(modelo, vazio)).toThrow(/segmentos_aceitos/)
  })

  it('marcador desconhecido gera ErroMontagem nomeando o marcador', () => {
    expect(() => montarPrompt('oi {{nao.existe}}', cfg)).toThrow(ErroMontagem)
    expect(() => montarPrompt('oi {{nao.existe}}', cfg)).toThrow(/nao\.existe/)
  })

  it('{{ sobrando gera ErroMontagem', () => {
    expect(() => montarPrompt('oi {{ aberto', cfg)).toThrow(ErroMontagem)
  })
})

const readme = readFileSync('README.md', 'utf8')
const norm = (t: string) => t.replace(/\n+$/, '')

function blocoDoReadme(): string {
  const ini = readme.indexOf('\n## Prompt do agente\n')
  expect(ini).toBeGreaterThan(-1)
  const abre = readme.indexOf('\n````markdown\n', ini)
  expect(abre).toBeGreaterThan(-1)
  const corpo = abre + '\n````markdown\n'.length
  const fecha = readme.indexOf('\n````\n', corpo)
  expect(fecha).toBeGreaterThan(-1)
  return readme.slice(corpo, fecha)
}

describe('T10: README publica o prompt', () => {
  it('o bloco da seção "Prompt do agente" é igual ao arquivo', () => {
    expect(norm(blocoDoReadme())).toBe(norm(modelo))
  })

  it('a cerca não pode ser fechada pelo texto do prompt', () => {
    expect(modelo).not.toMatch(/`{4,}/)
  })

  it('detecta um caractere diferente no prompt', () => {
    expect(norm(blocoDoReadme())).not.toBe(norm(modelo.replace('Papel', 'Papél')))
  })

  it('o README não contém o canário', () => {
    expect(readme).not.toContain(cfg.prompt.canario)
  })

  it('a seção avisa do silêncio na abertura e de que o agente não revela as instruções', () => {
    const ini = readme.indexOf('\n## Prompt do agente\n')
    const nota = readme.slice(ini, readme.indexOf('````', ini))
    expect(nota).toMatch(/manipula|injeção/i)
    expect(nota).toMatch(/silêncio/i)
    expect(nota).toMatch(/nunca revela/i)
  })

  it('o Contrato JSON cita ignorar, desvios e vagos', () => {
    const ini = readme.indexOf('\n## Contrato JSON\n')
    const secao = readme.slice(ini, readme.indexOf('\n## Avaliação', ini))
    for (const t of ['ignorar', 'desvios', 'vagos']) expect(secao).toContain(t)
  })
})

interface Troca { lead: string; acao: string; resposta: string }

function trocas(): { blocos: number; itens: Troca[] } {
  const sec = modelo.slice(modelo.indexOf('Troca A'), modelo.indexOf('## Travas'))
  const itens: Troca[] = []
  const re = /^Lead: (.*)\nacao: ([a-z_]+).*\nresposta: "(.*)"$/gm
  for (const m of sec.matchAll(re)) itens.push({ lead: m[1] ?? '', acao: m[2] ?? '', resposta: m[3] ?? '' })
  return { blocos: (sec.match(/^Troca [A-I]\b/gm) ?? []).length, itens }
}

describe('T20: prompt 1.5.0', () => {
  it('correções da primeira medição, no prompt e no README', () => {
    for (const t of ['uma pessoa do time, se preferir', 'com 4 ou mais, o lead já foi a vendas']) {
      expect(modelo).toContain(t)
      expect(readme).toContain(t)
    }
    expect(modelo).not.toContain('atendido por alguém do time')
  })
  it('versão, seções e frases antigas', () => {
    expect(modelo.split('\n')[0]).toMatch(/versao:\s*1\.5\.0/)
    expect([...modelo.matchAll(/^## /gm)]).toHaveLength(7)
    expect(modelo).not.toContain('Que bom que escreveu')
    expect(modelo).not.toContain('Pra eu registrar certinho')
    for (const t of ['Obrigado por procurar', 'atendemos sim', 'só consigo tratar', 'instalação ou manutenção']) {
      expect(modelo).not.toContain(t)
    }
  })

  it('traz as 9 trocas, cada resposta até 400 caracteres e um único "?" nas de perguntar', () => {
    const { blocos, itens } = trocas()
    expect(blocos).toBe(9)
    expect(itens.length).toBeGreaterThanOrEqual(26)
    for (const t of itens) {
      expect(t.resposta.length).toBeLessThanOrEqual(400)
      const q = (t.resposta.match(/\?/g) ?? []).length
      if (t.acao === 'perguntar' && t.resposta !== '') expect(q).toBe(1)
      else expect(q).toBe(0)
    }
  })

  it('cada resposta de exemplo passa pelo validarResposta com o prompt e a config montados', () => {
    const montado = montarPrompt(modelo, cfg)
    expect(trocas().itens.length).toBeGreaterThanOrEqual(26)
    for (const t of trocas().itens) {
      if (t.resposta === '') continue
      const r = montarPrompt(t.resposta, cfg)
      const v = validarResposta(r, { cfg, promptMontado: montado, ultimaMsgLead: t.lead })
      expect(v.map((x) => x.regra), r).toEqual([])
    }
  })

  it('o contrato e as travas trazem ignorar, desvios, vagos e a nova trava', () => {
    for (const t of ['ignorar', 'desvios', 'vagos', 'resposta` vazia', 'Antes da sua primeira resposta', 'mais detalhes']) {
      expect(modelo).toContain(t)
    }
    expect(cfg.resposta.frases_bot).toContain('mais detalhes')
  })

  it('risada e mensagem curta ficam ao julgamento do modelo; só o ininteligível é vago', () => {
    expect(modelo).toContain('sem nenhum sentido aparente ("asdfg")')
    expect(modelo).toContain('não têm regra fixa')
    expect(modelo).not.toContain('Lead: "kkk"')
  })

  it('casos n08 e n19 não usam kkk e n08 aceita perguntar e responder_e_encerrar', () => {
    const casos = JSON.parse(readFileSync('avaliacao/casos.json', 'utf8')) as { id: string; mensagens: string[]; esperado: Record<string, unknown[]> }[]
    const n08 = casos.find((c) => c.id === 'n08')!
    const n19 = casos.find((c) => c.id === 'n19')!
    expect(JSON.stringify(n08)).not.toContain('kkk')
    expect(JSON.stringify(n19)).not.toContain('kkk')
    expect(n08.esperado.proxima_acao).toEqual(expect.arrayContaining(['perguntar', 'responder_e_encerrar']))
  })

  it('traz o período do dia, os campos email e ja_cliente e a regra de uma vez só', () => {
    for (const t of ['{{periodo_do_dia}}', '`ja_cliente`', '`email`', 'uma vez só', FATO_SILENCIO]) {
      expect(modelo).toContain(t)
    }
    expect(cfg.resposta.frases_bot).toContain('obrigado por procurar')
  })

  it('o texto fora dos exemplos não divide 36 caracteres com respostas prováveis', () => {
    const montado = montarPrompt(modelo, cfg)
    const ini = montado.indexOf('Troca A')
    const fim = montado.indexOf('## Travas')
    const semExemplos = montado.slice(0, ini) + montado.slice(fim)
    const prováveis = [
      'Nosso foco é comercial e industrial, mas vou confirmar com a equipe se há espaço na agenda. Me passa um telefone ou e-mail para retorno?',
      'Fico à disposição quando quiser falar do serviço.',
      'Boa tarde, aqui é a CentralEng, com o que posso ajudar?',
      'Não vi, e por conduta da empresa não posso falar disso. Em qual cidade fica o equipamento?',
      'Alguém do time vai entrar em contato pelo número que você passou.',
    ]
    for (const r of prováveis) {
      const v = validarResposta(r, { cfg, promptMontado: semExemplos })
      expect(v.map((x) => x.regra), r).not.toContain('resposta_vazamento_prompt')
    }
  })

  it('campo já informado persiste nos turnos seguintes', () => {
    expect(modelo).toContain('Campo que o lead já informou continua preenchido nos turnos seguintes')
    expect(modelo).toContain('lendo a conversa inteira')
  })
})

describe('periodoDoDia', () => {
  const br = (hhmm: string) => Date.parse(`2026-11-05T${hhmm}:00-03:00`)
  it('respeita os limites das faixas em Brasilia', () => {
    expect(periodoDoDia(br('04:59'))).toBe('noite')
    expect(periodoDoDia(br('05:00'))).toBe('manhã')
    expect(periodoDoDia(br('11:59'))).toBe('manhã')
    expect(periodoDoDia(br('12:00'))).toBe('tarde')
    expect(periodoDoDia(br('17:59'))).toBe('tarde')
    expect(periodoDoDia(br('18:00'))).toBe('noite')
  })
})

describe('T32: prompt 1.5.0, area por UF', () => {
  it('versao, uf no contrato e marcador de estados atendidos', () => {
    expect(modelo.split('\n')[0]).toMatch(/versao:\s*1\.5\.0/)
    expect(modelo).toContain('"uf": "sigla de duas letras | null"')
    expect(modelo).toContain('{{regiao.ufs_atendidas}}')
    expect(modelo).toContain('Infelizmente não atendemos em Manaus')
  })
})
