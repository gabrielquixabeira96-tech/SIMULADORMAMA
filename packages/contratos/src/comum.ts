import { z } from "zod";

/** Versão do contrato de dados (docs/contratos.md). */
export const VERSAO_CONTRATO = "1.0" as const;

/** UUID em texto minúsculo (contratos §1.2). */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "uuid minúsculo esperado");

/** Pseudônimo `P-XXXXXX`, alfabeto sem I e O (contratos §1.2). */
export const PSEUDONIMO_REGEX = /^P-[0-9A-HJ-NP-Z]{6}$/;
export const pseudonimoSchema = z.string().regex(PSEUDONIMO_REGEX, "pseudônimo inválido");

/** Vetor 3D em mm: [x, y, z]. +X esquerda da paciente, +Y cranial, +Z anterior. */
export const vetor3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vetor3 = z.infer<typeof vetor3Schema>;

export const desenhoSchema = z.enum(["A", "B"]);
export type Desenho = z.infer<typeof desenhoSchema>;

export const versaoSoftwareSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

/** ISO 8601 com fuso (Z ou ±hh:mm). */
export const dataHoraSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, "data-hora ISO 8601 com fuso");

/** Caminho relativo a DATA_DIR: sem barra inicial, sem `..` (contratos §5.4). */
export const caminhoRelativoSchema = z
  .string()
  .min(1)
  .refine((s) => !s.startsWith("/") && !s.split(/[\\/]/).includes("..") && !/^[A-Za-z]:/.test(s), {
    message: "caminho deve ser relativo a DATA_DIR, sem '..'",
  });

/** Formato de erro comum (API do mesh e do web). */
export const erroApiSchema = z.object({
  erro: z.object({
    codigo: z.string(),
    mensagem: z.string().optional(),
    detalhes: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErroApi = z.infer<typeof erroApiSchema>;
