import { z } from 'zod'

const textos = z.array(z.string().min(1))

export const ConfigSchema = z
  .object({
    empresa: z.object({ nome: z.string().min(1), contato: z.string().min(1), horario: z.string().min(1) }),
    atendente: z.object({ nome: z.string().min(1) }),
    servicos: textos.min(1),
    segmentos: textos.min(1),
    segmentos_aceitos: textos,
    regiao: z.object({ cidades: textos.min(1) }),
    conversa: z.object({
      teto_perguntas: z.number().int().positive(),
      perguntas_curtas: textos,
    }),
    ia: z.object({
      modelo: z.string().min(1),
      effort: z.string().min(1),
      limiar_confianca: z.number().min(0).max(1),
      max_regeracoes: z.number().int().min(0),
      max_tokens: z.number().int().positive(),
    }),
    resposta: z.object({
      max_chars: z.number().int().positive(),
      frases_bot: textos,
      promessas_proibidas: textos,
      negacoes_ia: textos.default([
        'sou humano', 'sou humana', 'sou uma pessoa', 'não sou um robô', 'não sou robô',
        'não sou uma ia', 'não sou ia', 'sou uma atendente de verdade', 'sou um atendente de verdade',
      ]),
    }),
    prompt: z.object({ canario: z.string().min(1) }),
    textos: z.object({ aviso_lgpd: z.string().min(1), falha_tecnica: z.string().min(1) }),
    lgpd: z.object({ retencao_dias: z.number().int().positive() }),
    tela: z.object({ titulo: z.string().min(1), cor_primaria: z.string().min(1), cor_destaque: z.string().min(1) }),
  })
  .superRefine((cfg, ctx) => {
    const fora = cfg.segmentos_aceitos.filter((s) => !cfg.segmentos.includes(s))
    if (fora.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['segmentos_aceitos'],
        message: `segmentos_aceitos fora de segmentos: ${fora.join(', ')}`,
      })
    }
  })

export type Config = z.infer<typeof ConfigSchema>

export function carregarConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}
