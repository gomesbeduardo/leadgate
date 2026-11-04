// Gerador dos testes do promptfoo: so o conjunto de ajuste (o reservado nunca entra aqui).
// As mensagens vao como texto JSON: o promptfoo expande variavel que e lista em um teste por item.
import { readFileSync } from 'node:fs'

export function gerarTestes() {
  const casos = JSON.parse(readFileSync(new URL('../../avaliacao/casos.json', import.meta.url), 'utf8'))
  return casos
    .filter((c) => c.conjunto === 'ajuste')
    .map((c) => ({
      description: c.id,
      vars: { caso_id: c.id, mensagens: JSON.stringify(c.mensagens), esperado: c.esperado },
    }))
}

export default gerarTestes
