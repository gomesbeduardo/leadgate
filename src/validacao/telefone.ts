// Telefone brasileiro: +55 opcional, DDD (com ou sem parenteses), 9 opcional (colado ou separado), 4+4 digitos.
// Nao pode vir colado em outro digito, ponto ou hifen-digito (evita CPF, CNPJ e listas de numeros).
const TELEFONE =
  /(?<!\d)(?<!\d[.-])(?:\+?55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)(?![.-]\d)/g

const DDDS_VALIDOS = new Set(
  '11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '),
)

/** Numero colado, sem separador: so vale com DDD real e nono digito (9), senao e CPF ou lixo. */
const colado11Invalido = (trecho: string) =>
  /^\d{11}$/.test(trecho) && !(DDDS_VALIDOS.has(trecho.slice(0, 2)) && trecho[2] === '9')

export function extrairTelefones(texto: string): string[] {
  const achados: string[] = []
  for (const m of texto.matchAll(TELEFONE)) {
    const antes = texto.slice(Math.max(0, (m.index ?? 0) - 12), m.index)
    if (/cpf[\s:.\-nº°]*$/i.test(antes)) continue
    if (colado11Invalido(m[0])) continue
    achados.push(m[0])
  }
  return achados
}

/** Digitos do telefone sem o +55, para comparar duas grafias do mesmo numero. */
export function digitosTelefone(trecho: string): string {
  const d = trecho.replace(/\D/g, '')
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d
}
