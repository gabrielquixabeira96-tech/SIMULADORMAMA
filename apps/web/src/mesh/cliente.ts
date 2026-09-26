import {
  CABECALHO_DESENHO,
  erroApiSchema,
  malhaMetaSchema,
  medirRespostaSchema,
  processarRequisicaoSchema,
  reescalarRequisicaoSchema,
  saudeRespostaSchema,
  type Desenho,
  type Landmarks,
  type MalhaMeta,
  type MedirResposta,
  type ProcessarRequisicao,
  type ReescalarRequisicao,
  type SaudeResposta,
} from "@simulador/contratos";
import type { z } from "zod";
import { meshServiceUrl, meshTimeoutMs } from "@/config/ambiente";
import { exigirRecursoEm, recursoAtivoEm } from "@/config/recursos";
import { log } from "@/log/logger";

/** Erro vindo do services/mesh (ou da comunicação com ele). */
export class ErroMesh extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = "ErroMesh";
  }
}

export interface OpcoesCliente {
  desenho: Desenho;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Cliente HTTP do services/mesh (contratos §7). Toda requisição leva `X-Desenho`.
 * Em DESENHO=A, `/medir` nunca é chamado e `incluir_volume` nunca é true (ADR 0005).
 */
export class ClienteMesh {
  readonly desenho: Desenho;
  private readonly base: string;
  private readonly timeout: number;

  constructor(op: OpcoesCliente) {
    this.desenho = op.desenho;
    this.base = (op.baseUrl ?? meshServiceUrl()).replace(/\/+$/, "");
    this.timeout = op.timeoutMs ?? meshTimeoutMs();
  }

  private async chamar<T>(metodo: "GET" | "POST", rota: string, corpo: unknown, esquema: z.ZodType<T>, timeoutMs = this.timeout): Promise<T> {
    const inicio = Date.now();
    let resp: Response;
    try {
      resp = await fetch(`${this.base}${rota}`, {
        method: metodo,
        headers: { [CABECALHO_DESENHO]: this.desenho, Accept: "application/json", ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const nome = (e as Error)?.name;
      const codigo = nome === "TimeoutError" || nome === "AbortError" ? "servico_malha_timeout" : "servico_malha_indisponivel";
      log.warn("mesh_falha_rede", { rota, codigo, desenho: this.desenho });
      throw new ErroMesh(503, codigo, "serviço de malha indisponível");
    }
    let json: unknown = null;
    const texto = await resp.text();
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    log.info("mesh_chamada", { rota, status: resp.status, ms: Date.now() - inicio, desenho: this.desenho });
    if (!resp.ok) {
      const e = erroApiSchema.safeParse(json);
      if (e.success) throw new ErroMesh(resp.status, e.data.erro.codigo, e.data.erro.mensagem ?? e.data.erro.codigo, e.data.erro.detalhes ?? {});
      throw new ErroMesh(resp.status, "servico_malha_erro", `serviço de malha respondeu ${resp.status}`);
    }
    const r = esquema.safeParse(json);
    if (!r.success) {
      throw new ErroMesh(502, "resposta_fora_do_contrato", "resposta do serviço de malha fora do contrato", {
        problemas: r.error.issues.slice(0, 5).map((i) => ({ caminho: i.path.join("."), mensagem: i.message })),
      });
    }
    return r.data;
  }

  async saude(): Promise<SaudeResposta> {
    return this.chamar("GET", "/saude", undefined, saudeRespostaSchema, 5000);
  }

  async processar(req: ProcessarRequisicao): Promise<MalhaMeta> {
    return this.chamar("POST", "/processar", processarRequisicaoSchema.parse(req), malhaMetaSchema);
  }

  async reescalar(req: ReescalarRequisicao): Promise<MalhaMeta> {
    return this.chamar("POST", "/reescalar", reescalarRequisicaoSchema.parse(req), malhaMetaSchema);
  }

  /**
   * Geodésicas (+ volume em B). Em A lança RecursoDesligadoError SEM tocar a rede.
   * `incluir_volume` é decidido aqui pela flag, nunca pelo chamador.
   */
  async medir(malhaDir: string, landmarks: Landmarks, euclidianasWeb: Record<string, number>): Promise<MedirResposta> {
    exigirRecursoEm(this.desenho, "medicao_automatica_3d");
    const corpo = {
      malha_dir: malhaDir,
      landmarks,
      distancias_euclidianas_web: euclidianasWeb,
      incluir_geodesica: true,
      incluir_volume: recursoAtivoEm(this.desenho, "volume_calculado"),
    };
    return this.chamar("POST", "/medir", corpo, medirRespostaSchema);
  }
}
