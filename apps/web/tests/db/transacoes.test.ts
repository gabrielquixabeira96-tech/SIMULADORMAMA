/**
 * Revisão v0.1.1, item 12: escrita e auditoria na MESMA transação. Se a auditoria falha, a
 * escrita é desfeita (nada de paciente, TEPID ou atendimento sem a linha de auditoria).
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { dbDisponivel } from "../helpers/banco";

const falhar = { ativo: false };
vi.mock("@/db/auditoria", async (original) => {
  const mod = await original<typeof import("@/db/auditoria")>();
  return {
    ...mod,
    registrarAuditoria: async (...a: Parameters<typeof mod.registrarAuditoria>) => {
      if (falhar.ativo) throw new Error("auditoria indisponível (simulada)");
      return mod.registrarAuditoria(...a);
    },
  };
});

const { POST: postPaciente } = await import("@/app/api/pacientes/route");
const { POST: postTepid } = await import("@/app/api/tepid/route");
const { POST: postAnamnese } = await import("@/app/api/llm/anamnese/route");
const { carregarTepidConfig } = await import("@/config/arquivosConfig");
const { consultar, fecharPools } = await import("@/db/pool");

afterEach(() => {
  falhar.ativo = false;
  vi.unstubAllEnvs();
});
afterAll(fecharPools);

const contar = async (tabela: string) => Number((await consultar<{ n: string }>(`select count(*)::text as n from ${tabela}`)).rows[0]!.n);
const json = (corpo: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

describe.skipIf(!dbDisponivel())("escrita + auditoria atômicas", () => {
  it("POST /api/pacientes: auditoria falha → 500 e nenhum paciente criado", async () => {
    const antes = await contar("pacientes");
    falhar.ativo = true;
    const r = await postPaciente();
    expect(r.status).toBe(500);
    expect(await contar("pacientes")).toBe(antes);
  });

  it("POST /api/tepid: auditoria falha → 500 e nenhuma linha de TEPID", async () => {
    const p = await (await postPaciente()).json();
    const c = carregarTepidConfig();
    const valores = Object.fromEntries(Object.entries(c.campos).map(([k, d]) => [k, { dir: (d.min + d.max) / 2, esq: (d.min + d.max) / 2 }]));
    const antes = await contar("tepid");
    falhar.ativo = true;
    const r = await postTepid(new Request("http://x", json({ paciente_id: p.id, valores })));
    expect(r.status).toBe(500);
    expect(await contar("tepid")).toBe(antes);
  });

  it("POST /api/llm/anamnese: auditoria falha → 500, nenhum atendimento criado e nenhuma anamnese gravada", async () => {
    const p = await (await postPaciente()).json();
    const antes = await contar("atendimentos");
    falhar.ativo = true;
    const r = await postAnamnese(new Request("http://x", json({ paciente_id: p.id, texto: "Deseja aumento moderado, nunca fumou." })));
    expect(r.status).toBe(500);
    expect(await contar("atendimentos")).toBe(antes);
  });
});
