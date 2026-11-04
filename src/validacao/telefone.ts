// Telefone brasileiro: +55 opcional, DDD (com ou sem parenteses), 9 opcional, 4+4 digitos.
// Nao pode vir colado em outro digito, ponto ou hifen-digito (evita CPF, CNPJ e listas de numeros).
const TELEFONE =
  /(?<!\d)(?<!\d[.-])(?:\+?55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)(?![.-]\d)/g

export function extrairTelefones(texto: string): string[] {
  return texto.match(TELEFONE) ?? []
}

/** Digitos do telefone sem o +55, para comparar duas grafias do mesmo numero. */
export function digitosTelefone(trecho: string): string {
  const d = trecho.replace(/\D/g, '')
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d
}
