import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  catalogoArquivoSchema,
  filtrarCatalogo,
  problemasDoImplante,
  type Desenho,
  type FiltroCatalogo,
  type ImplanteCatalogo,
} from "@simulador/contratos";
import { raizRepo } from "@/config/ambiente";
import { exigirRecursoEm } from "@/config/recursos";
import { log } from "@/log/logger";

/**
 * Catálogo de implantes (contratos §11; ADR 0015). Lê `config/catalogo/*.json` (ou
 * `$CONFIG_DIR/catalogo`), valida cada arquivo com o zod de `@simulador/contratos` e as regras
 * semânticas (`problemasDoImplante`). Arquivo inválido é pulado com aviso (como o Python);
 * id repetido entre arquivos é erro (id é único global).
 *
 * A ESCOLHA MANUAL (listar + filtrar) vale nos desenhos A e B (ADR 0005). Ordem sempre neutra
 * (alfabética por id): sem ranking, sem "recomendado". A SUGESTÃO continua atrás da guarda.
 */
export type ItemCatalogo = ImplanteCatalogo;

export interface AvisoCatalogo {
  arquivo: string;
  erro: string;
}

export class CatalogoInvalidoError extends Error {
  readonly codigo = "catalogo_invalido" as const;
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CatalogoInvalidoError";
  }
}

function dirCatalogo(): string {
  return process.env.CONFIG_DIR
    ? resolve(/*turbopackIgnore: true*/ process.env.CONFIG_DIR, "catalogo")
    : resolve(/*turbopackIgnore: true*/ raizRepo(), "config/catalogo");
}

/** Lê e valida todos os arquivos; devolve os implantes (ordem neutra por id) e os avisos dos arquivos pulados. */
export function carregarCatalogoDetalhado(): { implantes: ItemCatalogo[]; avisos: AvisoCatalogo[] } {
  const dir = dirCatalogo();
  const porId = new Map<string, string>();
  const implantes: ItemCatalogo[] = [];
  const avisos: AvisoCatalogo[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    let bruto: unknown;
    try {
      bruto = JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ dir, f), "utf8"));
    } catch (e) {
      avisos.push({ arquivo: f, erro: `json_invalido: ${(e as Error).message}` });
      continue;
    }
    const r = catalogoArquivoSchema.safeParse(bruto);
    if (!r.success) {
      avisos.push({ arquivo: f, erro: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    const problemas = r.data.implantes.flatMap(problemasDoImplante);
    if (problemas.length > 0) {
      avisos.push({ arquivo: f, erro: problemas.slice(0, 3).join("; ") });
      continue;
    }
    for (const it of r.data.implantes) {
      const outro = porId.get(it.id);
      if (outro) throw new CatalogoInvalidoError(`id de implante repetido: ${it.id} (${outro} e ${f})`);
      porId.set(it.id, f);
      implantes.push(it);
    }
  }
  for (const a of avisos) log.warn("catalogo_ignorado", { arquivo: a.arquivo, erro: a.erro });
  implantes.sort((a, b) => a.id.localeCompare(b.id));
  return { implantes, avisos };
}

/** Todos os implantes válidos, em ordem neutra (alfabética por id). */
export function carregarCatalogo(): ItemCatalogo[] {
  return carregarCatalogoDetalhado().implantes;
}

/** Listagem para escolha manual (A e B): filtra sem reordenar. */
export function listarParaEscolhaManual(filtro: FiltroCatalogo = {}): ItemCatalogo[] {
  return filtrarCatalogo(carregarCatalogo(), filtro);
}

/** Implante pelo id, ou null. */
export function buscarImplante(id: string): ItemCatalogo | null {
  return carregarCatalogo().find((i) => i.id === id) ?? null;
}

export class NaoImplementadoError extends Error {
  readonly codigo = "nao_implementado" as const;
  constructor(o: string) {
    super(`${o} ainda não implementado`);
    this.name = "NaoImplementadoError";
  }
}

/** Guarda da sugestão de implante: A → RecursoDesligadoError (403); B → nao_implementado (501). */
export function sugerirImplantes(desenho: Desenho): never {
  exigirRecursoEm(desenho, "sugestao_implante");
  throw new NaoImplementadoError("sugestao_implante");
}
