import { describe, expect, it } from 'vitest'
import { extrairTelefones } from '../src/validacao/telefone'

describe('extrairTelefones', () => {
  it.each([
    ['48 99999-0001 200 m2', 1],
    ['48 99999-0001 48 98888-0002', 2],
    ['(48) 99999-0001', 1],
    ['55 3307 7010', 1],
    ['+55 (48) 3364.9840', 1],
    ['123.456.789-00', 0],
    ['tenho 10 12 15 20 30 aparelhos', 0],
    ['1234', 0],
  ])('%s -> %i', (texto, n) => {
    expect(extrairTelefones(texto)).toHaveLength(n)
  })
})
