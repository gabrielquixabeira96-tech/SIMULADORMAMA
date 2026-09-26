/**
 * Rotas da simulação (Marco 2) contra o banco de teste + mock do services/mesh (MSW):
 * /api/catalogo (escolha manual e filtro), /api/malhas/<id>/morphs e /api/malhas/<id>/simulacoes, A e B.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getCatalogo } from "@/app/api/catalogo/route";
import { POST as postMorphs } from "@/app/api/malhas/[id]/morphs/route";
import { GET as getSimulacoes, POST as postSimulacao } from "@/app/api/malhas/[id]/simulacoes/route";
import { POST as postMalha } from "@/app/api/malhas/route";
import { POST as postPaciente } from "@/app/api/pacientes/route";
import { consultar, fecharPools } from "@/db/pool";
import { contarAuditoria, dbDisponivel } from "../helpers/banco";
import { chamadas, iniciarMockMesh, pararMockMesh, resetarMockMesh } from "../helpers/meshMock";

beforeAll(iniciarMockMesh);
afterEach(() => {
  resetarMockMesh();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  pararMockMesh();
  await fecharPools();
});

const IMPLANTE = "motiva-rsd-300";
const json = (corpo: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const lm = (x: number, y: number, z: number, v: number) => ({ posicao: [x, y, z], vertice: v, origem: "gabarito" });
const LANDMARKS = {
  furcula: lm(0, 0, 0, 0),
  mamilo_dir: lm(-95, -190, 90, 1),
  mamilo_esq: lm(95, -190, 90, 2),
  sulco_dir: lm(-95, -260, 60, 3),
  sulco_esq: lm(95, -260, 60, 1),
  linha_media_inferior: lm(0, -260, 40, 2),
  base_medial_dir: lm(-30, -190, 60, 0),
  base_lateral_dir: lm(-150, -190, 30, 1),
  base_medial_esq: lm(30, -190, 60, 2),
  base_lateral_esq: lm(150, -190, 30, 3),
};

async function novaMalha(): Promise<string> {
  const p = await (await postPaciente()).json();
  const fd = new FormData();
  fd.set("paciente_id", p.id);
  fd.set("unidade_origem", "mm");
  fd.append("arquivos", new File(["v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"], "t.obj"));
  const r = await postMalha(new Request("http://x/api/malhas", { method: "POST", body: fd }));
  return (await r.json()).malha_id;
}

describe("GET /api/catalogo — escolha manual (A e B)", () => {
  for (const desenho of ["A", "B"] as const) {
    it(`${desenho}: filtra pela query, ordem neutra, sem ranking`, async () => {
      vi.stubEnv("DESENHO", desenho);
      const r = await getCatalogo(new Request("http://x/api/catalogo?fabricante=Motiva&volume_min=280&volume_max=320"));
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j.ordem).toBe("neutra_por_id");
      expect(j.implantes.length).toBeGreaterThan(0);
      expect(j.implantes.every((i: any) => i.fabricante === "Motiva" && i.volume_ml >= 280 && i.volume_ml <= 320)).toBe(true);
      const ids = j.implantes.map((i: any) => i.id);
      expect(ids).toEqual([...ids].sort((a: string, b: string) => a.localeCompare(b)));
      expect(JSON.stringify(j)).not.toMatch(/recomendad|ranking|pontua/i);
    });
  }
  it("filtro inválido → 400", async () => {
    const r = await getCatalogo(new Request("http://x/api/catalogo?volume_min=400&volume_max=100"));
    expect(r.status).toBe(400);
    expect((await r.json()).erro.codigo).toBe("entrada_invalida");
  });
});

describe.skipIf(!dbDisponivel())("morphs e simulações mostradas", () => {
  it("B: /morphs pede os 2 planos × 2 IMF, lados separados, só os implantes escolhidos; auditado", async () => {
    vi.stubEnv("DESENHO", "B");
    const id = await novaMalha();
    chamadas.length = 0;
    const r = await postMorphs(new Request("http://x", json({ landmarks: LANDMARKS, implantes: [IMPLANTE], pinca_polo_superior_mm: { dir: 22, esq: 21 } })), params(id));
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    expect(j.esquema).toBe("morphs/1.0");
    const c = chamadas.find((x) => x.rota === "/morphs")!;
    expect(c.desenho).toBe("B");
    expect(c.corpo).toMatchObject({ implantes: [IMPLANTE], planos: ["subglandular", "dual_plane"], imfs: ["manter", "rebaixar"], lados: "separados", pinca_polo_superior_mm: { dir: 22, esq: 21 } });
    expect(await contarAuditoria("arquivo", id, "criou")).toBe(1);
  });

  it("A: simulação continua permitida (implante escolhido pelo cirurgião)", async () => {
    vi.stubEnv("DESENHO", "A");
    const id = await novaMalha();
    chamadas.length = 0;
    const r = await postMorphs(new Request("http://x", json({ landmarks: LANDMARKS, implantes: [IMPLANTE] })), params(id));
    expect(r.status).toBe(200);
    expect(chamadas.find((x) => x.rota === "/morphs")!.desenho).toBe("A");
  });

  it("implante fora do catálogo → 422 sem chamar o serviço; mais de 2 → 400", async () => {
    const id = await novaMalha();
    chamadas.length = 0;
    const r = await postMorphs(new Request("http://x", json({ landmarks: LANDMARKS, implantes: ["nao-existe-999"] })), params(id));
    expect(r.status).toBe(422);
    expect((await r.json()).erro.codigo).toBe("implante_desconhecido");
    expect(chamadas.filter((x) => x.rota === "/morphs")).toHaveLength(0);
    const r3 = await postMorphs(new Request("http://x", json({ landmarks: LANDMARKS, implantes: [IMPLANTE, "motiva-rsd-320", "motiva-rsd-340"] })), params(id));
    expect(r3.status).toBe(400);
  });

  it("simulação mostrada vira linha em `simulacoes` (implante em cache) e auditoria 'simulou'; em A a listagem não traz `previsto`", async () => {
    vi.stubEnv("DESENHO", "B");
    const id = await novaMalha();
    const previsto = { delta_projecao_mamilo_mm: { dir: 29.1, esq: 29.1 }, delta_y_sulco_mm: { dir: 0, esq: 0 }, delta_y_mamilo_mm: { dir: 3.4, esq: 3.4 } };
    const r = await postSimulacao(new Request("http://x", json({ implante_id: IMPLANTE, plano: "dual_plane", imf: "rebaixar", lado: "ambos", versao_config_simulacao: "1.1", nao_calibrado: true, previsto })), params(id));
    expect(r.status).toBe(201);
    const { id: simId } = await r.json();
    expect(await contarAuditoria("simulacoes", simId, "simulou")).toBe(1);
    const imp = await consultar<{ verificado: boolean }>("select verificado from implantes where id = $1", [IMPLANTE]);
    expect(imp.rows[0]!.verificado).toBe(false);
    const b = await (await getSimulacoes(new Request("http://x"), params(id))).json();
    expect(b.simulacoes[0]).toMatchObject({ implante_id: IMPLANTE, plano: "dual_plane", imf: "rebaixar", nao_calibrado: true });
    expect(b.simulacoes[0].previsto).not.toBeNull();
    vi.stubEnv("DESENHO", "A");
    const a = await (await getSimulacoes(new Request("http://x"), params(id))).json();
    expect(a.simulacoes[0].previsto).toBeNull();
    const ruim = await postSimulacao(new Request("http://x", json({ implante_id: IMPLANTE, plano: "submuscular", imf: "manter", lado: "ambos", versao_config_simulacao: "1.1", nao_calibrado: true })), params(id));
    expect(ruim.status).toBe(400);
  });
});
