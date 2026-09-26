import { DECIMACAO_PADRAO, type Landmarks } from "@simulador/contratos";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RecursoDesligadoError } from "@/config/recursos";
import { distanciasEuclidianas } from "@/medidas/geometria";
import { ClienteMesh, ErroMesh } from "@/mesh/cliente";
import { chamadas, iniciarMockMesh, pararMockMesh, resetarMockMesh, simularIndisponivel } from "../helpers/meshMock";

beforeAll(iniciarMockMesh);
afterEach(resetarMockMesh);
afterAll(pararMockMesh);

const lm = (x: number, y: number, z: number, v = 1) => ({ posicao: [x, y, z] as [number, number, number], vertice: v, origem: "clique" as const });
const landmarks: Landmarks = {
  furcula: lm(0, 0, 0),
  mamilo_dir: lm(-95.12, -190.4, 88.2),
  mamilo_esq: lm(95.12, -190.4, 88.2),
  sulco_dir: lm(-95, -262, 60),
  sulco_esq: lm(95, -262, 60),
  linha_media_inferior: lm(0, -262, 40),
};
const euclidianas = Object.fromEntries(Object.entries(distanciasEuclidianas(landmarks)).filter(([, v]) => v !== null)) as Record<string, number>;
const DIR = "pacientes/P-7K2M9Q/malhas/c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0";

describe("cliente do services/mesh (contratos §7)", () => {
  it("envia X-Desenho em toda requisição", async () => {
    await new ClienteMesh({ desenho: "A" }).saude();
    await new ClienteMesh({ desenho: "B" }).processar({
      malha_dir: DIR,
      arquivo_original: "original/scan.obj",
      unidade_origem: "m",
      recorte: { modo: "abaixo_do_pescoco", y_max_mm: null, y_min_mm: null },
      decimacao: { ...DECIMACAO_PADRAO },
    });
    expect(chamadas.map((c) => [c.rota, c.desenho])).toEqual([
      ["/saude", "A"],
      ["/processar", "B"],
    ]);
  });

  it("B: /medir com incluir_volume=true e euclidianas conferidas pelo mock (≤ 0,01 mm)", async () => {
    const r = await new ClienteMesh({ desenho: "B" }).medir(DIR, landmarks, euclidianas);
    const c = chamadas.find((x) => x.rota === "/medir")!;
    expect(c.desenho).toBe("B");
    expect(c.corpo.incluir_volume).toBe(true);
    expect(c.corpo.incluir_geodesica).toBe(true);
    expect(r.distancias.intermamilar?.euclidiana_mm).toBe(190.24);
    expect(r.volumes?.dir?.incerteza_ml).toBeGreaterThan(0);
  });

  it("A: medir lança RecursoDesligadoError SEM nenhuma chamada de rede", async () => {
    await expect(new ClienteMesh({ desenho: "A" }).medir(DIR, landmarks, euclidianas)).rejects.toBeInstanceOf(RecursoDesligadoError);
    expect(chamadas).toHaveLength(0);
  });

  it("erro do contrato vira ErroMesh com código", async () => {
    const e = await new ClienteMesh({ desenho: "B" }).medir(DIR, landmarks, { ...euclidianas, intermamilar: 999 }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroMesh);
    expect(e.status).toBe(422);
    expect(e.codigo).toBe("euclidiana_divergente");
  });

  it("serviço fora do ar → 503 servico_malha_indisponivel", async () => {
    simularIndisponivel(true);
    const e = await new ClienteMesh({ desenho: "B" }).saude().catch((x) => x);
    expect(e).toBeInstanceOf(ErroMesh);
    expect(e.status).toBe(503);
    expect(e.codigo).toBe("servico_malha_indisponivel");
  });

  it("recusa requisição fora do contrato antes de enviar (caminho com ..)", async () => {
    await expect(
      new ClienteMesh({ desenho: "B" }).reescalar({ malha_dir: "../fora", fator: 1.01, regua: { regua_mm: 100, pontos: [[0, 0, 0], [0, 99, 0]] } }),
    ).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
});
