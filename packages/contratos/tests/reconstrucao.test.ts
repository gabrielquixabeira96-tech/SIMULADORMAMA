import { describe, expect, it } from "vitest";
import { avaliacaoDeExtras, kColunaMajorValido, reconstrucaoDeExtras, reconstrucaoSchema, rotacaoValida } from "../src";

/** C1 mínimo (sintético): 1 foto frontal, câmera olhando para −z anatômico. */
const foto = {
  vista: "frente",
  arquivo: "original/foto_frente.jpg",
  largura_px: 960,
  altura_px: 720,
  // coluna-major: fx=2700, fy=2700, cx=479.5, cy=359.5
  K: [2700, 0, 0, 0, 2700, 0, 479.5, 359.5, 1],
  // R = diag(1, −1, −1)
  R: [1, 0, 0, 0, -1, 0, 0, 0, -1],
  t: [0, -120, 1300],
  rms_px: 0.4,
};
const c1 = { esquema: "reconstrucao/1.0", fotos: [foto], incerteza_por_eixo_mm: { x: 1.8, y: 2, z: 12 }, qualidade: "boa", avisos: [] };

describe("reconstrucao/1.0 (C1)", () => {
  it("aceita o mínimo e mantém campos extras (passthrough)", () => {
    const r = reconstrucaoSchema.parse({ ...c1, campo_novo: 1 });
    expect(r.fotos[0]!.vista).toBe("frente");
    expect((r as Record<string, unknown>).campo_novo).toBe(1);
  });

  it("recusa K linha-major, R que não é rotação, arquivo fora da lista e vista repetida", () => {
    expect(reconstrucaoSchema.safeParse({ ...c1, fotos: [{ ...foto, K: [2700, 0, 479.5, 0, 2700, 359.5, 0, 0, 1] }] }).success).toBe(false);
    expect(reconstrucaoSchema.safeParse({ ...c1, fotos: [{ ...foto, R: [1, 0, 0, 0, 1, 0, 0, 0, -1] }] }).success).toBe(false);
    expect(reconstrucaoSchema.safeParse({ ...c1, fotos: [{ ...foto, arquivo: "../foto.jpg" }] }).success).toBe(false);
    expect(reconstrucaoSchema.safeParse({ ...c1, fotos: [foto, foto] }).success).toBe(false);
  });

  it("validadores de K e R", () => {
    expect(kColunaMajorValido(foto.K)).toBe(true);
    expect(rotacaoValida(foto.R)).toBe(true);
    expect(rotacaoValida([-1, 0, 0, 0, -1, 0, 0, 0, -1])).toBe(false);
  });

  it("lê do asset.extras do .glb só com origem 'foto'", () => {
    expect(reconstrucaoDeExtras({ origem: "foto", reconstrucao: c1 })?.fotos).toHaveLength(1);
    expect(reconstrucaoDeExtras({ origem: "foto", ...c1 })?.qualidade).toBe("boa");
    expect(reconstrucaoDeExtras({ origem: "upload", reconstrucao: c1 })).toBeNull();
    expect(reconstrucaoDeExtras({ origem: "foto", reconstrucao: { fotos: [] } })).toBeNull();
    expect(avaliacaoDeExtras({ avaliacao: { rms_mm: { x: 1, y: 1, z: 2 }, volume_erro_pct: -4 } })?.rms_mm.z).toBe(2);
    expect(avaliacaoDeExtras({ reconstrucao: { avaliacao: { rms_mm: { x: 1, y: 1, z: 2 }, volume_erro_pct: { dir: 1, esq: 2 } } } })).not.toBeNull();
    expect(avaliacaoDeExtras({})).toBeNull();
  });
});
