import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Desenho } from "@simulador/contratos";
import { z } from "zod";
import { raizRepo } from "@/config/ambiente";
import { exigirRecursoEm } from "@/config/recursos";

/**
 * Catálogo (contratos §11). Nesta fase (Marco 1) só a listagem neutra e a GUARDA da
 * sugestão de implante (ADR 0005): em A a sugestão é recusada; em B ainda não existe
 * (Marco 2) e responde `nao_implementado`.
 */
const itemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    fabricante: z.string(),
    modelo: z.string(),
    forma: z.enum(["redonda", "anatomica"]),
    base_mm: z.number(),
    altura_mm: z.number(),
    projecao_mm: z.number(),
    volume_ml: z.number(),
    verificado: z.boolean(),
    exemplo_nao_clinico: z.boolean(),
    nota: z.string(),
  })
  .passthrough();
export type ItemCatalogo = z.infer<typeof itemSchema>;

const arquivoSchema = z.object({ esquema: z.literal("catalogo/1.0"), implantes: z.array(itemSchema) }).passthrough();

export function carregarCatalogo(): ItemCatalogo[] {
  const dir = process.env.CONFIG_DIR ? resolve(/*turbopackIgnore: true*/ process.env.CONFIG_DIR, "catalogo") : resolve(/*turbopackIgnore: true*/ raizRepo(), "config/catalogo");
  const itens: ItemCatalogo[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const r = arquivoSchema.safeParse(JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ dir, f), "utf8")));
    if (r.success) itens.push(...r.data.implantes);
  }
  // Ordem NEUTRA (alfabética por id): sem ranking, sem "recomendado".
  return itens.sort((a, b) => a.id.localeCompare(b.id));
}

export class NaoImplementadoError extends Error {
  readonly codigo = "nao_implementado" as const;
  constructor(o: string) {
    super(`${o} ainda não implementado`);
    this.name = "NaoImplementadoError";
  }
}

/** Guarda da sugestão de implante: A → RecursoDesligadoError; B → nao_implementado (Marco 2). */
export function sugerirImplantes(desenho: Desenho): never {
  exigirRecursoEm(desenho, "sugestao_implante");
  throw new NaoImplementadoError("sugestao_implante");
}
