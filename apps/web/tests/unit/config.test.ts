import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isoComFuso, versaoSoftware } from "@/config/ambiente";
import { carregarConfigSimulacaoUI } from "@/config/arquivosConfig";
import { AVISO_FIXO, configPublica } from "@/config/publica";
import { ehIdentidade, validarAssetGlb } from "@/viewer/validarGlb";

afterEach(() => vi.unstubAllEnvs());

describe("configuração pública", () => {
  it("aviso fixo do código = config/simulacao.json", () => {
    expect(AVISO_FIXO).toBe("Ilustração, não previsão de resultado");
    expect(carregarConfigSimulacaoUI().aviso_fixo).toBe(AVISO_FIXO);
  });

  it("envelope de incerteza vem da config e é sobrescrevível por ENVELOPE_RMS_MM", () => {
    expect(carregarConfigSimulacaoUI().envelope_rms_mm).toBe(4.5);
    vi.stubEnv("ENVELOPE_RMS_MM", "6");
    expect(carregarConfigSimulacaoUI().envelope_rms_mm).toBe(6);
  });

  it("versão do software = arquivo VERSION", () => {
    const v = readFileSync(resolve(process.env.REPO_ROOT!, "VERSION"), "utf8").trim();
    expect(versaoSoftware()).toBe(v);
  });

  it("DESENHO=A entrega ao cliente todos os recursos desligados", () => {
    vi.stubEnv("DESENHO", "A");
    const c = configPublica();
    expect(c.desenho).toBe("A");
    expect(Object.values(c.recursos)).toEqual([false, false, false, false, false]);
    // o cliente recebe só os campos do TEPID; nenhuma regra/limiar
    expect(JSON.stringify(c.tepid)).not.toMatch(/limiar|regras|tabelas/);
    expect(c.tepid.nota).toMatch(/conferir no texto original/i);
  });

  it("data-hora ISO com fuso", () => {
    expect(isoComFuso(new Date("2026-09-26T18:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

describe("carregador GLB (contratos §5.3)", () => {
  it("rejeita GLB sem asset.extras.unidade == 'mm'", () => {
    expect(validarAssetGlb({ version: "2.0" }).ok).toBe(false);
    expect(validarAssetGlb({ extras: { unidade: "m", quadro: "scan" } }).ok).toBe(false);
    expect(validarAssetGlb({ extras: { unidade: "mm" } }).ok).toBe(false);
    expect(validarAssetGlb({ extras: { unidade: "mm", quadro: "anatomico" } })).toMatchObject({ ok: true, quadro: "anatomico" });
    expect(validarAssetGlb({ extras: { unidade: "mm", quadro: "scan", esquema: "x" } }, "morphs/1.0").ok).toBe(false);
  });
  it("detecta nó com transformação (escala proibida)", () => {
    expect(ehIdentidade([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toBe(true);
    expect(ehIdentidade([1000, 0, 0, 0, 0, 1000, 0, 0, 0, 0, 1000, 0, 0, 0, 0, 1])).toBe(false);
  });
});
