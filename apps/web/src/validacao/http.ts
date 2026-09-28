import type { NextResponse } from "next/server";
import { erro, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { ErroSessao } from "./sessao";

/** Recurso do mapa A/B que governa a validação de medidas (ADR 0017: mesma regra da medição 3D). */
export const RECURSO_VALIDACAO = "medicao_automatica_3d" as const;

export function erroValidacao(e: unknown, contexto: string): NextResponse {
  if (e instanceof ErroSessao) return erro(e.status, e.codigo, e.message);
  return tratarErro(e, contexto);
}

export async function auditarSessao(acao: "criou" | "alterou" | "visualizou" | "exportou", entidadeId: string, detalhes: Record<string, unknown>, entidade = "validacao_sessoes"): Promise<void> {
  await registrarAuditoria({ usuarioId: usuarioAtual(), acao, entidade, entidadeId, desenho: getDesenho(), detalhes });
}

export const indiceDeParam = (s: string): number => (/^\d{1,4}$/.test(s) ? Number(s) : -1);
