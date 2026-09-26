import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NaoImplementadoError } from "@/catalogo/catalogo";
import { CaminhoInvalidoError } from "@/config/ambiente";
import { RecursoDesligadoError, type Recurso } from "@/config/recursos";
import { recursoAtivo } from "@/config/desenho";
import { BancoIndisponivelError } from "@/db/pool";
import { EscalaInvalidaError } from "@/medidas/geometria";
import { ErroMesh } from "@/mesh/cliente";
import { log } from "@/log/logger";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

export function json(corpo: unknown, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: SEM_CACHE });
}

export function erro(status: number, codigo: string, mensagem?: string, detalhes?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ erro: { codigo, ...(mensagem ? { mensagem } : {}), ...(detalhes ? { detalhes } : {}) } }, { status, headers: SEM_CACHE });
}

/** 403 padronizado do ADR 0005. */
export function desligadoNoDesenhoA(recurso: Recurso): NextResponse {
  return erro(403, "desligado_no_desenho_a", `recurso '${recurso}' desligado no desenho A`, { recurso });
}

/** Retorna a resposta 403 se o recurso estiver desligado; `null` se pode seguir. */
export function bloquearSeDesligado(recurso: Recurso): NextResponse | null {
  return recursoAtivo(recurso) ? null : desligadoNoDesenhoA(recurso);
}

function ehErroConexaoBanco(e: unknown): boolean {
  const c = (e as { code?: string })?.code;
  return c === "ECONNREFUSED" || c === "ENOTFOUND" || c === "3D000" || c === "28P01" || c === "57P03" || /timeout exceeded when trying to connect/i.test(String((e as Error)?.message));
}

export function tratarErro(e: unknown, contexto: string): NextResponse {
  if (e instanceof RecursoDesligadoError) return desligadoNoDesenhoA(e.recurso);
  if (e instanceof NaoImplementadoError) return erro(501, e.codigo, e.message);
  if (e instanceof CaminhoInvalidoError) return erro(400, "caminho_invalido", e.message);
  if (e instanceof EscalaInvalidaError) return erro(400, "escala_invalida", e.message);
  if (e instanceof ZodError) {
    return erro(400, "entrada_invalida", "entrada fora do contrato", {
      problemas: e.issues.slice(0, 10).map((i) => ({ caminho: i.path.join("."), mensagem: i.message })),
    });
  }
  if (e instanceof ErroMesh) {
    const status = e.status === 503 ? 503 : e.status >= 500 ? 502 : e.status;
    return erro(status, e.codigo, e.message, e.detalhes);
  }
  if (e instanceof BancoIndisponivelError || ehErroConexaoBanco(e)) {
    log.error("banco_indisponivel", { contexto });
    return erro(503, "banco_indisponivel", "banco de dados indisponível");
  }
  log.error("erro_interno", { contexto, erro: e });
  return erro(500, "erro_interno", "erro interno");
}

export async function lerJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ZodError([{ code: "custom", path: [], message: "corpo JSON inválido", input: undefined }]);
  }
}
