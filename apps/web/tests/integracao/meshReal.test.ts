/**
 * Integração web × services/mesh REAL (sem MSW) + Postgres de teste: upload de um torso
 * sintético → /processar → /medir com os landmarks do gabarito (±1 mm) → /reescalar →
 * medidas reescaladas; desenho A; contratos de erro reais. Pulado se faltar venv, torso ou banco.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as postReescalar } from "@/app/api/malhas/[id]/reescalar/route";
import { POST as postMalha } from "@/app/api/malhas/route";
import { POST as postMedidas } from "@/app/api/medidas/route";
import { POST as postMedir } from "@/app/api/medidas/medir/route";
import { POST as postPaciente } from "@/app/api/pacientes/route";
import { caminhoEmDataDir } from "@/config/ambiente";
import { carregarTepidConfig } from "@/config/arquivosConfig";
import { fecharPools } from "@/db/pool";
import { ClienteMesh, ErroMesh } from "@/mesh/cliente";
import { dbDisponivel } from "../helpers/banco";
import { SINTETICOS, lerGabarito, meshRealInstalado, subirMeshReal, torsoDisponivel, verticeMaisProximo, verticesObj, type ServidorMesh } from "../helpers/meshReal";

const TORSO = "t01_simetrico_300";
const pronto = meshRealInstalado() && torsoDisponivel(TORSO) && dbDisponivel();
const json = (corpo: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let mesh: ServidorMesh | null = null;

describe.skipIf(!pronto)("integração com o services/mesh real", () => {
  let malhaId = "";
  let malhaDir = "";
  let pacienteId = "";
  const gab = pronto ? lerGabarito(TORSO) : null!;

  beforeAll(async () => {
    mesh = await subirMeshReal(process.env.DATA_DIR!);
    vi.stubEnv("MESH_SERVICE_URL", mesh.url);
    vi.stubEnv("MESH_SERVICE_TIMEOUT_MS", "120000");
    vi.stubEnv("DESENHO", "B");
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await mesh?.parar();
    await fecharPools();
  });

  it("saúde responde com contrato 1.0", async () => {
    const s = await new ClienteMesh({ desenho: "B", baseUrl: mesh!.url }).saude();
    expect(s.contrato).toBe("1.0");
  });

  it("upload do torso sintético → /processar real → malha_meta/1.0 válido, 30–50 mil vértices", async () => {
    pacienteId = (await (await postPaciente()).json()).id;
    const fd = new FormData();
    fd.set("paciente_id", pacienteId);
    fd.set("unidade_origem", "mm");
    fd.set("sintetica", "true");
    for (const a of ["torso.obj", "torso.mtl", "textura.png"]) fd.append("arquivos", new File([readFileSync(resolve(SINTETICOS, TORSO, a))], a));
    const r = await postMalha(new Request("http://x/api/malhas", { method: "POST", body: fd }));
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(201);
    malhaId = j.malha_id;
    malhaDir = j.meta.malha_dir;
    expect(j.meta.esquema).toBe("malha_meta/1.0");
    expect(j.meta.processada.n_vertices).toBeGreaterThanOrEqual(30000);
    expect(j.meta.processada.n_vertices).toBeLessThanOrEqual(50000);
    expect(j.meta.original.tem_textura).toBe(true);
  }, 120_000);

  function landmarksDoGabarito(fator = 1) {
    const v = verticesObj(caminhoEmDataDir(`${malhaDir}/processada.obj`));
    return Object.fromEntries(
      Object.entries(gab.landmarks).map(([k, l]) => {
        const p = l.posicao.map((c) => c * fator) as [number, number, number];
        return [k, { posicao: p, vertice: verticeMaisProximo(v, p), origem: "gabarito" }];
      }),
    );
  }

  it("B: /api/medidas grava distâncias do /medir real a ±1 mm do gabarito, com volume e incerteza", async () => {
    const r = await postMedidas(new Request("http://x", json({ malha_id: malhaId, landmarks: landmarksDoGabarito() })));
    const reg = await r.json();
    expect(r.status, JSON.stringify(reg)).toBe(201);
    for (const [id, g] of Object.entries(gab.distancias)) {
      if (!g) continue;
      expect(Math.abs(reg.distancias[id].euclidiana_mm - g.euclidiana_mm), `${id} euclidiana`).toBeLessThanOrEqual(1);
      expect(Math.abs(reg.distancias[id].geodesica_mm - g.geodesica_mm), `${id} geodésica`).toBeLessThanOrEqual(1);
    }
    for (const lado of ["dir", "esq"] as const) {
      expect(reg.volumes[lado].valor_ml).toBeGreaterThan(0);
      expect(reg.volumes[lado].incerteza_ml).toBeGreaterThan(0);
    }
    expect(reg.geodesica.algoritmo).toBe("mmp");
  }, 120_000);

  it("volume sem landmarks da base → null por lado (aviso volume_X:landmarks_da_base_ausentes)", async () => {
    const lm = landmarksDoGabarito();
    for (const k of ["base_medial_dir", "base_lateral_dir", "base_medial_esq", "base_lateral_esq"]) delete lm[k];
    const r = await postMedir(new Request("http://x", json({ malha_id: malhaId, landmarks: lm })));
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    expect(j.volumes === null || (j.volumes.dir === null && j.volumes.esq === null)).toBe(true);
    expect(j.avisos).toEqual(expect.arrayContaining(["volume_dir:landmarks_da_base_ausentes", "volume_esq:landmarks_da_base_ausentes"]));
    expect(j.distancias.base_dir).toBeNull();
  }, 120_000);

  it("euclidiana divergente → 422 real do serviço", async () => {
    const lm = landmarksDoGabarito();
    const e = await new ClienteMesh({ desenho: "B", baseUrl: mesh!.url }).medir(malhaDir, lm as never, { intermamilar: 1 }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroMesh);
    expect(e.status).toBe(422);
    expect(e.codigo).toBe("euclidiana_divergente");
  }, 60_000);

  it("calibração: /reescalar real com fator 1,02 → distâncias medidas acompanham o fator", async () => {
    const p1 = gab.landmarks.mamilo_dir!.posicao;
    const p2 = gab.landmarks.mamilo_esq!.posicao;
    const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
    const r = await postReescalar(new Request("http://x", json({ regua_mm: d * 1.02, pontos: [p1, p2] })), params(malhaId));
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    expect(j.meta.fator_escala_acumulado).toBeCloseTo(1.02, 6);
    const reg = await (await postMedidas(new Request("http://x", json({ malha_id: malhaId, landmarks: landmarksDoGabarito(1.02) })))).json();
    expect(reg.escala).toMatchObject({ metodo: "regua_2_pontos" });
    expect(reg.escala.fator).toBeCloseTo(1.02, 6);
    const g = gab.distancias.intermamilar!;
    expect(Math.abs(reg.distancias.intermamilar.euclidiana_mm - g.euclidiana_mm * 1.02)).toBeLessThanOrEqual(1);
    expect(Math.abs(reg.distancias.intermamilar.geodesica_mm - g.geodesica_mm * 1.02)).toBeLessThanOrEqual(1);
  }, 120_000);

  it("A: grava só medidas digitadas; o serviço real recusa /medir com X-Desenho A (defesa em profundidade)", async () => {
    vi.stubEnv("DESENHO", "A");
    const c = carregarTepidConfig();
    const digitadas = Object.fromEntries(Object.entries(c.campos).map(([k, d]) => [k, { dir: (d.min + d.max) / 2, esq: (d.min + d.max) / 2 }]));
    const r = await postMedidas(new Request("http://x", json({ malha_id: malhaId, landmarks: landmarksDoGabarito(1.02), medidas_digitadas: digitadas })));
    const reg = await r.json();
    expect(r.status, JSON.stringify(reg)).toBe(201);
    expect(reg.distancias).toBeNull();
    expect(reg.volumes).toBeNull();
    // chamada direta, sem a guarda do cliente: o serviço também recusa
    const direto = await fetch(`${mesh!.url}/medir`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Desenho": "A" },
      body: JSON.stringify({ malha_dir: malhaDir, landmarks: {}, distancias_euclidianas_web: {}, incluir_geodesica: true, incluir_volume: false }),
    });
    expect(direto.status).toBe(403);
    vi.stubEnv("DESENHO", "B");
  }, 60_000);

  it("sem X-Desenho o serviço real responde 400 (o cliente sempre envia)", async () => {
    const r = await fetch(`${mesh!.url}/reescalar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(400);
    expect((await r.json()).erro.codigo).toBe("desenho_ausente");
  });
});
