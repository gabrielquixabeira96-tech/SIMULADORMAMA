import type { Distancias, MedidasDigitadas, Volumes } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { montarDadosTravados, numerosPermitidos, representacoes, verificarNumeros } from "@/llm/numeros";

const digitadas: MedidasDigitadas = {
  base_mm: { dir: 120, esq: 118 },
  apss_mm: { dir: 25, esq: 25 },
  pinca_polo_superior_mm: { dir: 22, esq: 21 },
  pinca_sulco_mm: { dir: 6, esq: 6 },
  n_imf_estirado_mm: { dir: 80, esq: 82 },
};
const distancias: Distancias = {
  ssn_n_dir: { euclidiana_mm: 212.34, geodesica_mm: 224.1 },
  ssn_n_esq: null,
  n_imf_dir: null,
  n_imf_esq: null,
  base_dir: null,
  base_esq: null,
  intermamilar: { euclidiana_mm: 190.2, geodesica_mm: 205.3 },
};
const volumes: Volumes = { dir: { valor_ml: 288.4, incerteza_ml: 43.3, metodo: "plano_base_elipse" }, esq: null };
const implantes = [{ id: "exemplo-redondo-moderado-300", rotulo: "Exemplo 300 mL", plano: "dual_plane" as const, imf: "manter" as const, volume_ml: 300, base_mm: 116, projecao_mm: 38 }];

describe("números calculados no texto do LLM (guarda do Marco 2b)", () => {
  it("B: dados travados incluem distâncias e volumes", () => {
    const d = montarDadosTravados({ implantes, medidasDigitadas: digitadas, distancias, volumes }, "B");
    expect(d.distancias).not.toBeNull();
    expect(d.volumes).not.toBeNull();
    const p = numerosPermitidos(d);
    expect(p).toEqual(expect.arrayContaining(["212,34", "288,4", "300", "116"]));
  });

  it("A: distâncias e volumes calculados são removidos e nenhum número deles é permitido", () => {
    const d = montarDadosTravados({ implantes, medidasDigitadas: digitadas, distancias, volumes }, "A");
    expect(d.distancias).toBeNull();
    expect(d.volumes).toBeNull();
    const p = numerosPermitidos(d);
    for (const calculado of ["212,34", "212.34", "224,1", "190,2", "205,3", "288,4", "43,3"]) expect(p).not.toContain(calculado);
    expect(p).toEqual(expect.arrayContaining(["120", "25", "300", "116"]));
    // Uma prosa que cita volume calculado é recusada em A
    const v = verificarNumeros({ introducao: "O volume estimado foi de 288,4 mL." }, p);
    expect(v.ok).toBe(false);
    expect(v.intrusos).toEqual(["288,4"]);
  });

  it("verificarNumeros aceita só números da lista (teste travado)", () => {
    const p = ["300", "4,5"];
    expect(verificarNumeros({ a: "Implante de 300 mL, envelope de 4,5 mm." }, p).ok).toBe(true);
    expect(verificarNumeros({ a: "Implante de 310 mL." }, p).ok).toBe(false);
    expect(verificarNumeros({ a: "Sem números." }, p).ok).toBe(true);
  });

  it("representações sem perda de precisão", () => {
    expect(representacoes(4.5)).toEqual(expect.arrayContaining(["4,5", "4.5", "4,50"]));
    expect(representacoes(4.5)).not.toContain("5");
    expect(representacoes(300)).toEqual(expect.arrayContaining(["300", "300,0"]));
  });
});
