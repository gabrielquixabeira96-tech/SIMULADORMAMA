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
import { CODIGO_DESLIGADO_NA_DEMO } from "@/seguranca/requisicao";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

export function json(corpo: unknown, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: SEM_CACHE });
}

export function erro(status: number, codigo: string, mensagem?: string, detalhes?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ erro: { codigo, ...(mensagem ? { mensagem } : {}), ...(detalhes ? { detalhes } : {}) } }, { status, headers: SEM_CACHE });
}

/** 403 das rotas fechadas no modo demo sintética (a mesma resposta do proxy; ADR 0018). */
export function desligadoNaDemo(): NextResponse {
  return erro(403, CODIGO_DESLIGADO_NA_DEMO, "desligado na demonstração sintética: só torsos sintéticos, sem upload de malha nem anamnese em texto livre");
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
  if (e instanceof CorpoGrandeDemaisError) return erro(413, "corpo_grande_demais", e.message);
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

/** Limite do corpo das rotas JSON (revisão v0.1.1). O maior corpo legítimo (landmarks) tem poucos KB. */
export const LIMITE_JSON_BYTES = 1024 * 1024;

export class CorpoGrandeDemaisError extends Error {
  constructor(readonly limite: number) {
    super(`corpo acima do limite de ${Math.round(limite / 1024)} KB`);
    this.name = "CorpoGrandeDemaisError";
  }
}

/**
 * Envolve o corpo num stream que CONTA os bytes e aborta ao passar do limite. Vale também para
 * `Transfer-Encoding: chunked` (sem Content-Length), que antes contornava o limite.
 */
export function limitarCorpo(corpo: ReadableStream<Uint8Array>, limite: number, aoExceder?: () => void): ReadableStream<Uint8Array> {
  let total = 0;
  return corpo.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(pedaco, ctl) {
        total += pedaco.byteLength;
        if (total > limite) {
          aoExceder?.();
          ctl.error(new CorpoGrandeDemaisError(limite));
        } else ctl.enqueue(pedaco);
      },
    }),
  );
}

/** Lê o corpo inteiro com limite (lança CorpoGrandeDemaisError → 413). */
export async function lerCorpoLimitado(req: Request, limite: number): Promise<Uint8Array> {
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > limite) throw new CorpoGrandeDemaisError(limite);
  if (!req.body) return new Uint8Array(0);
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      throw new CorpoGrandeDemaisError(limite);
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export async function lerJson(req: Request, limite = LIMITE_JSON_BYTES): Promise<unknown> {
  const bytes = await lerCorpoLimitado(req, limite);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ZodError([{ code: "custom", path: [], message: "corpo JSON inválido", input: undefined }]);
  }
}
