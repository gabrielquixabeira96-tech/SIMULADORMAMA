import { afterEach, describe, expect, it, vi } from "vitest";
import { exigirRecurso, getDesenho, recursoAtivo, recursosAtuais } from "@/config/desenho";
import { RECURSOS, RecursoDesligadoError, recursoAtivoEm, recursosDoDesenho } from "@/config/recursos";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("flag DESENHO (ADR 0005)", () => {
  it("ausente → B (padrão local)", () => {
    vi.stubEnv("DESENHO", "");
    expect(getDesenho()).toBe("B");
  });

  it("lê A e B do ambiente do servidor", () => {
    vi.stubEnv("DESENHO", "A");
    expect(getDesenho()).toBe("A");
    vi.stubEnv("DESENHO", "B");
    expect(getDesenho()).toBe("B");
  });

  it("valor inválido lança", () => {
    vi.stubEnv("DESENHO", "X");
    expect(() => getDesenho()).toThrow(/DESENHO inválido/);
    vi.stubEnv("DESENHO", "a");
    expect(() => getDesenho()).toThrow();
  });

  it("não depende de NEXT_PUBLIC_DESENHO", () => {
    vi.stubEnv("DESENHO", "A");
    vi.stubEnv("NEXT_PUBLIC_DESENHO", "B");
    expect(getDesenho()).toBe("A");
    expect(recursoAtivo("medicao_automatica_3d")).toBe(false);
  });
});

describe("mapa de recursos", () => {
  // Tabela do ADR 0005 / contratos §13.
  const TABELA: Array<[(typeof RECURSOS)[number], boolean, boolean]> = [
    ["medicao_automatica_3d", true, false],
    ["volume_calculado", true, false],
    ["alertas_tepid", true, false],
    ["sugestao_implante", true, false],
    ["numeros_calculados_no_relatorio", true, false],
  ];

  it("cobre exatamente os 5 recursos da restrição 5", () => {
    expect([...RECURSOS].sort()).toEqual(TABELA.map((t) => t[0]).sort());
  });

  it.each(TABELA)("%s: B=%s, A=%s", (recurso, emB, emA) => {
    expect(recursoAtivoEm("B", recurso)).toBe(emB);
    expect(recursoAtivoEm("A", recurso)).toBe(emA);
  });

  it("modo A desliga TODOS os recursos calculados", () => {
    vi.stubEnv("DESENHO", "A");
    expect(Object.values(recursosAtuais()).every((v) => v === false)).toBe(true);
    for (const r of RECURSOS) {
      expect(recursoAtivo(r)).toBe(false);
      expect(() => exigirRecurso(r)).toThrow(RecursoDesligadoError);
    }
  });

  it("modo B liga todos", () => {
    vi.stubEnv("DESENHO", "B");
    for (const r of RECURSOS) {
      expect(recursoAtivo(r)).toBe(true);
      expect(() => exigirRecurso(r)).not.toThrow();
    }
  });

  it("o mapa é imutável", () => {
    const m = recursosDoDesenho("A") as Record<string, boolean>;
    expect(() => {
      m.volume_calculado = true;
    }).toThrow();
    expect(recursoAtivoEm("A", "volume_calculado")).toBe(false);
  });

  it("recurso desconhecido lança", () => {
    expect(() => recursoAtivoEm("B", "inexistente" as never)).toThrow(/desconhecido/);
  });
});
