import type { Landmarks, MedirResposta } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { escalaDaMeta, montarRegistroMedidas, type EntradaRegistro } from "@/medidas/registro";
import { metaExemplo } from "../helpers/meshMock";

const lm = (x: number, y: number, z: number) => ({ posicao: [x, y, z] as [number, number, number], vertice: 3, origem: "clique" as const });
const landmarks: Landmarks = {
  furcula: lm(0, 0, 0),
  mamilo_dir: lm(-95, -190, 90),
  mamilo_esq: lm(95, -190, 90),
  linha_media_inferior: lm(0, -260, 40),
};
const medicao: MedirResposta = {
  distancias: {
    ssn_n_dir: { euclidiana_mm: 230.83, geodesica_mm: 240 },
    ssn_n_esq: { euclidiana_mm: 230.83, geodesica_mm: 240 },
    n_imf_dir: null,
    n_imf_esq: null,
    base_dir: null,
    base_esq: null,
    intermamilar: { euclidiana_mm: 190, geodesica_mm: 199.5 },
  },
  volumes: { dir: { valor_ml: 288.4, incerteza_ml: 43.3, metodo: "plano_base_elipse" }, esq: null },
  quadro_anatomico: null,
  geodesica: { algoritmo: "mmp", biblioteca: "pygeodesic" },
  avisos: [],
};
const digitadas = {
  base_mm: { dir: 120, esq: 120 },
  apss_mm: { dir: 25, esq: 25 },
  pinca_polo_superior_mm: { dir: 22, esq: 22 },
  pinca_sulco_mm: { dir: 6, esq: 6 },
  n_imf_estirado_mm: { dir: 80, esq: 80 },
};
const base = (desenho: "A" | "B"): EntradaRegistro => ({
  medidaId: "8f14e45f-ceea-4e7a-9f1b-8e6b7a1c2d3e",
  malhaId: "c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0",
  pseudonimo: "P-7K2M9Q",
  desenho,
  versaoSoftware: "0.0.1",
  versaoConfig: { tepid: "1.0", simulacao: "1.0" },
  quadro: "scan",
  geradoEm: "2026-09-26T14:00:00-04:00",
  usuarioId: "local",
  escala: { metodo: "nenhuma", fator: 1 },
  landmarks,
  medidasDigitadas: digitadas,
  medicao,
});

describe("registro medidas/1.0", () => {
  it("B grava distâncias, volumes e geodésica", () => {
    const r = montarRegistroMedidas(base("B"));
    expect(r.distancias?.intermamilar?.geodesica_mm).toBe(199.5);
    expect(r.volumes?.dir?.valor_ml).toBe(288.4);
    expect(r.geodesica?.algoritmo).toBe("mmp");
  });

  it("A grava distancias=null e volumes=null mesmo que uma medição seja passada", () => {
    const r = montarRegistroMedidas(base("A"));
    expect(r.distancias).toBeNull();
    expect(r.volumes).toBeNull();
    expect(r.geodesica).toBeNull();
    expect(r.medidas_digitadas).toEqual(digitadas);
    // landmarks continuam (âncora da simulação) e o quadro anatômico vem da fórmula do web
    expect(Object.keys(r.landmarks)).toHaveLength(4);
    expect(r.quadro_anatomico).not.toBeNull();
  });

  it("A sem medidas digitadas é recusado pelo contrato", () => {
    expect(() => montarRegistroMedidas({ ...base("A"), medidasDigitadas: null })).toThrow();
  });

  it("escala vem do último /reescalar do meta.json", () => {
    const dir = "pacientes/P-7K2M9Q/malhas/c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0";
    expect(escalaDaMeta(metaExemplo(dir), false).metodo).toBe("nenhuma");
    expect(escalaDaMeta(metaExemplo(dir), true).metodo).toBe("gabarito");
    const e = escalaDaMeta(
      metaExemplo(dir, { escala: { historico: [{ fator: 1.0132, regua: { regua_mm: 100, pontos: [[0, 0, 0], [0, 98.7, 0]] }, aplicado_em: "2026-09-26T13:58:00-04:00" }] } }),
      false,
    );
    expect(e).toMatchObject({ metodo: "regua_2_pontos", regua_mm: 100, fator: 1.0132 });
    expect(e.pontos).toHaveLength(2);
  });
});
