import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MedidasDigitadas, TepidConfig } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { carregarTepidConfig } from "@/config/arquivosConfig";
import { avaliarTepid, consultarTabela, validarValoresTepid } from "@/tepid/avaliar";

const config = carregarTepidConfig();

/** Valores válidos gerados A PARTIR da config (nenhum número clínico neste teste). */
function valoresNoMeioDaFaixa(c: TepidConfig): MedidasDigitadas {
  const out = {} as MedidasDigitadas;
  for (const [campo, def] of Object.entries(c.campos)) {
    const meio = (def.min + def.max) / 2;
    (out as Record<string, { dir: number; esq: number }>)[campo] = { dir: meio, esq: meio };
  }
  return out;
}

describe("config/tepid.json", () => {
  it("todo limiar e tabela exige conferência no texto original", () => {
    expect(config.fonte.nota).toMatch(/conferir no texto original/i);
    expect(config.regras.length).toBeGreaterThan(0);
    for (const r of config.regras) expect(r.conferir_no_texto_original).toBe(true);
    for (const t of config.tabelas) expect(t.conferir_no_texto_original).toBe(true);
  });

  it("nenhum limiar da config aparece hard-coded no código do TEPID", () => {
    const fonte = readFileSync(resolve(__dirname, "../../src/tepid/avaliar.ts"), "utf8");
    for (const r of config.regras) {
      const limiar = r.limiar_mm ?? r.limiar_min_mm;
      expect(fonte).not.toMatch(new RegExp(`[<>=]\\s*${limiar}\\b`));
    }
  });
});

describe("validação de faixa (A e B)", () => {
  it("aceita valores dentro das faixas da config", () => {
    const r = validarValoresTepid(valoresNoMeioDaFaixa(config), config);
    expect(r.ok).toBe(true);
  });

  it("recusa fora da faixa, vazio e campo desconhecido", () => {
    const v = valoresNoMeioDaFaixa(config) as unknown as Record<string, { dir: unknown; esq: unknown }>;
    v.apss_mm = { dir: config.campos.apss_mm.max + 1, esq: "" };
    const r = validarValoresTepid({ ...v, idade: { dir: 30, esq: 30 } }, config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.map((e) => `${e.campo}:${e.lado}`)).toEqual(expect.arrayContaining(["apss_mm:dir", "apss_mm:esq", "idade:dir"]));
    }
  });

  it("aceita vírgula decimal", () => {
    const v = valoresNoMeioDaFaixa(config) as unknown as Record<string, { dir: unknown; esq: unknown }>;
    const meio = (config.campos.base_mm.min + config.campos.base_mm.max) / 2;
    v.base_mm = { dir: `${meio},5`, esq: meio };
    const r = validarValoresTepid(v, config);
    expect(r.ok && r.valores.base_mm.dir).toBe(meio + 0.5);
  });
});

describe("regras TEPID só em B", () => {
  // Valor que dispara a primeira regra, derivado da própria config.
  const regra = config.regras.find((r) => r.operador === "<" && r.campo !== "volume_ml")!;
  const valores = valoresNoMeioDaFaixa(config);
  const campo = regra.campo as keyof MedidasDigitadas;
  const disparador: MedidasDigitadas = { ...valores, [campo]: { dir: (regra.limiar_mm as number) - 1, esq: valores[campo].esq } };

  it("B gera alerta (lado certo, com nota de conferência)", () => {
    const r = avaliarTepid(disparador, config, "B");
    const a = r.alertas.find((x) => x.regra_id === regra.id);
    expect(a).toBeDefined();
    expect(a!.lado).toBe("dir");
    expect(a!.conferir_no_texto_original).toBe(true);
    expect(r.referencias.length).toBeGreaterThan(0);
  });

  it("A NUNCA gera alertas nem referências de tabela", () => {
    const r = avaliarTepid(disparador, config, "A");
    expect(r.alertas).toEqual([]);
    expect(r.referencias).toEqual([]);
  });
});

describe("tabelas", () => {
  const linear = { id: "t", entrada: "base_mm", saida: "volume_ml", pontos: [[100, 200], [120, 300]], interpolar: "linear", conferir_no_texto_original: true, fonte_pagina: null } as const;
  it("interpola linearmente e não extrapola", () => {
    expect(consultarTabela({ ...linear, pontos: [[100, 200], [120, 300]] }, 110)).toBe(250);
    expect(consultarTabela({ ...linear, pontos: [[100, 200], [120, 300]] }, 99)).toBeNull();
    expect(consultarTabela({ ...linear, pontos: [[100, 200], [120, 300]], interpolar: "degrau" }, 119)).toBe(200);
  });
  it("faixas em ordem, 'ate' inclusivo", () => {
    const t = { id: "f", entrada: "apss_mm", saida: "delta_volume_ml", faixas: [{ ate: 20, valor: -1 }, { ate: 30, valor: 0 }, { acima: 30, valor: 1 }], conferir_no_texto_original: true, fonte_pagina: null } as const;
    expect(consultarTabela({ ...t, faixas: [...t.faixas] }, 20)).toBe(-1);
    expect(consultarTabela({ ...t, faixas: [...t.faixas] }, 25)).toBe(0);
    expect(consultarTabela({ ...t, faixas: [...t.faixas] }, 31)).toBe(1);
  });
});
