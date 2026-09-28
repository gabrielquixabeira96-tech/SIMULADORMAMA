// @vitest-environment jsdom
/**
 * Catálogo na simulação (ADR 0019 item 9; ADR 0005): ordem neutra por id com os "EXEMPLO NÃO
 * CLÍNICO" no fim; com a base medida (só quando a medição automática existe, desenho B) abre
 * filtrado pela base ±10 mm e o filtro desliga com um toque; sem base (desenho A), nenhum chip.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ImplanteCatalogo } from "@simulador/contratos";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EscolhaImplante, TOLERANCIA_BASE_MM, faixaDaBase } from "@/catalogo/EscolhaImplante";

afterEach(cleanup);

const RAIZ = resolve(__dirname, "../../../..");
const doArquivo = (arq: string, ids: string[]) =>
  (JSON.parse(readFileSync(resolve(RAIZ, "config/catalogo", arq), "utf8")).implantes as ImplanteCatalogo[]).filter((i) => ids.includes(i.id));
// ordem neutra por id, como o servidor entrega; o exemplo (id "exemplo-…") vem antes de "motiva-…"
const IMPLANTES = [...doArquivo("exemplo.json", ["exemplo-redondo-moderado-300"]), ...doArquivo("motiva.json", ["motiva-rsd-245", "motiva-rsd-300", "motiva-rsd-625"])].sort((a, b) => a.id.localeCompare(b.id));

const linhas = () => within(screen.getByTestId("catalogo-lista")).getAllByRole("row").slice(1).map((r) => r.getAttribute("data-testid")!.replace("catalogo-item-", ""));

describe("escolha do implante na simulação", () => {
  it("ordem neutra por id, com os exemplos não clínicos no fim; sem base medida, sem chip", () => {
    expect(IMPLANTES.map((i) => i.id)).toEqual(["exemplo-redondo-moderado-300", "motiva-rsd-245", "motiva-rsd-300", "motiva-rsd-625"]);
    render(<EscolhaImplante implantes={IMPLANTES} selecionado={null} onEscolher={() => undefined} />);
    expect(linhas()).toEqual(["motiva-rsd-245", "motiva-rsd-300", "motiva-rsd-625", "exemplo-redondo-moderado-300"]);
    expect(screen.queryByTestId("catalogo-filtro-base")).toBeNull();
    render(<EscolhaImplante implantes={IMPLANTES} selecionado={null} onEscolher={() => undefined} baseMedidaMm={null} />);
    expect(screen.queryByTestId("catalogo-filtro-base")).toBeNull();
  });

  it("base medida: filtra ±10 mm (sem ranking) e desliga com um toque", () => {
    render(<EscolhaImplante implantes={IMPLANTES} selecionado={null} onEscolher={() => undefined} baseMedidaMm={{ dir: 113.05, esq: 112.95 }} />);
    const chip = screen.getByTestId("catalogo-filtro-base");
    expect(chip.textContent).toContain("Filtrado pela base medida (113,0 mm ±10)");
    // 107,5 e 115 ficam; 150 sai; o exemplo (116) fica, no fim
    expect(linhas()).toEqual(["motiva-rsd-245", "motiva-rsd-300", "exemplo-redondo-moderado-300"]);
    fireEvent.click(screen.getByTestId("catalogo-filtro-base-desligar"));
    expect(linhas()).toEqual(["motiva-rsd-245", "motiva-rsd-300", "motiva-rsd-625", "exemplo-redondo-moderado-300"]);
    fireEvent.click(screen.getByTestId("catalogo-filtro-base-ligar"));
    expect(linhas()).toHaveLength(3);
  });

  it("faixa da base: min − 10 a max + 10; valores ausentes ou inválidos → sem filtro", () => {
    expect(TOLERANCIA_BASE_MM).toBe(10);
    expect(faixaDaBase({ dir: 110, esq: 118 })).toEqual({ min: 100, max: 128, media: 114 });
    for (const b of [null, undefined, { dir: Number.NaN, esq: 110 }, { dir: 0, esq: 110 }, { dir: -3, esq: 110 }]) expect(faixaDaBase(b)).toBeNull();
  });
});
