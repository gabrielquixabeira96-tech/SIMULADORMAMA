/**
 * PDF do atendimento (Marco 2b): o texto EXTRAÍDO do PDF contém versão, parâmetros (desenho,
 * versões de config, implantes, plano, IMF, envelope, selo não calibrado), simulações mostradas,
 * aviso ilustrativo e placeholder de assinatura ICP-Brasil; sem link/anotação; em A sem
 * nenhum número calculado.
 */
import type { Distancias, MedidasDigitadas, Volumes } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { ProvedorMock } from "@/llm/mock";
import { montarDadosTravados, type ImplanteMostrado } from "@/llm/numeros";
import { gerarRelatorio, type RelatorioFinal } from "@/llm/relatorio";
import { gerarPdfAtendimento, paraWinAnsi, PLACEHOLDER_ASSINATURA, SELO_NAO_CALIBRADO } from "@/pdf/gerarPdf";
import { extrairTextoPdf } from "../helpers/pdfTexto";

const digitadas: MedidasDigitadas = {
  base_mm: { dir: 121, esq: 119 },
  apss_mm: { dir: 27, esq: 26 },
  pinca_polo_superior_mm: { dir: 23, esq: 22 },
  pinca_sulco_mm: { dir: 7, esq: 7 },
  n_imf_estirado_mm: { dir: 81, esq: 83 },
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
const implantes: ImplanteMostrado[] = [
  { id: "motiva-rsd-300", rotulo: "Motiva SilkSurface™ Demi (RSD-300)", plano: "dual_plane", imf: "rebaixar", volume_ml: 300, base_mm: 116, projecao_mm: 38 },
  { id: "exemplo-anatomico-alto-350", rotulo: "GC Exemplo Anatômico", plano: "subglandular", imf: "manter", volume_ml: 350, base_mm: 111, projecao_mm: 46 },
];

async function relatorio(desenho: "A" | "B"): Promise<RelatorioFinal> {
  return gerarRelatorio(
    {
      relatorioId: "11111111-1111-4111-8111-111111111111",
      atendimentoId: "22222222-2222-4222-8222-222222222222",
      pseudonimo: "P-7K2M9Q",
      desenho,
      versaoSoftware: "9.8.7",
      geradoEm: "2026-09-26T10:00:00-04:00",
      parametros: { versao_config: { simulacao: "1.1", tepid: "1.0" }, envelope_rms_mm: 4.5, nao_calibrado: true, aviso: "Ilustração, não previsão de resultado" },
      dados: montarDadosTravados({ implantes, medidasDigitadas: digitadas, distancias, volumes }, desenho),
      simulacoes: [
        { id: "33333333-3333-4333-8333-333333333333", implante_id: "motiva-rsd-300", rotulo: implantes[0]!.rotulo, plano: "dual_plane", imf: "rebaixar", lado: "ambos", versao_config_simulacao: "1.1", nao_calibrado: true, mostrada_em: "2026-09-26T09:41:00-04:00" },
        { id: "44444444-4444-4444-8444-444444444444", implante_id: "exemplo-anatomico-alto-350", rotulo: implantes[1]!.rotulo, plano: "subglandular", imf: "manter", lado: "ambos", versao_config_simulacao: "1.1", nao_calibrado: true, mostrada_em: "2026-09-26T09:47:00-04:00" },
      ],
    },
    new ProvedorMock(),
  );
}

const sem = (s: string) => s.replace(/\s+/g, " ");

describe("PDF do atendimento — conteúdo extraído", () => {
  it("B: versão, parâmetros, simulações, relatório, aviso e placeholder de assinatura", async () => {
    const r = await relatorio("B");
    const bytes = await gerarPdfAtendimento(r, "2026-09-26T10:05:00-04:00");
    const { texto, links } = await extrairTextoPdf(bytes);
    const t = sem(texto);
    expect(t).toContain("Versão do software: 9.8.7");
    expect(t).toContain("Ilustração, não previsão de resultado");
    expect(t).toContain(PLACEHOLDER_ASSINATURA);
    expect(t).toContain("ICP-Brasil");
    expect(t).toContain(`Selo: ${SELO_NAO_CALIBRADO}`);
    expect(t).toMatch(/Desenho: B/);
    expect(t).toContain("Configuração da simulação: versão 1.1");
    expect(t).toContain("Configuração TEPID: versão 1.0");
    expect(t).toContain("±4,5 mm (RMS)");
    expect(t).toContain("Paciente: P-7K2M9Q");
    // implantes, plano e IMF
    expect(t).toContain("Motiva SilkSurface™ Demi (RSD-300)");
    expect(t).toMatch(/plano: dual plane \(plano duplo\) — IMF: rebaixar o sulco inframamário/);
    expect(t).toMatch(/plano: subglandular — IMF: manter o sulco inframamário/);
    // simulações mostradas com horário
    expect(t).toContain("Simulações mostradas");
    expect(t).toContain("26/09/2026 09:41");
    expect(t).toContain("26/09/2026 09:47");
    // relatório: template + prosa
    expect(t).toContain("Relatório para a paciente");
    expect(t).toContain("212,34 mm");
    expect(t).toContain("288,4 mL");
    expect(t).toContain("Limitações");
    // sem link, anotação ou compartilhamento
    expect(links).toBe(0);
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).not.toMatch(/\/URI|\/Link|\/Annots|\/JavaScript|\/EmbeddedFile|\/Launch|https?:\/\//);
    expect(t).not.toMatch(/compartilh|whatsapp|instagram|facebook/i);
    // sem imagem embutida (nenhum snapshot real)
    expect(raw).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("A: nenhum número calculado aparece no PDF; digitados e catálogo aparecem", async () => {
    const r = await relatorio("A");
    const { texto } = await extrairTextoPdf(await gerarPdfAtendimento(r, "2026-09-26T10:05:00-04:00"));
    const t = sem(texto);
    expect(t).toMatch(/Desenho: A/);
    for (const calc of ["212,34", "212.34", "224,1", "190,2", "205,3", "288,4", "43,3"]) expect(t).not.toContain(calc);
    expect(t).not.toMatch(/\(calculad[oa]s?\)/);
    expect(t).toContain("direita 121 mm; esquerda 119 mm");
    expect(t).toContain("300 mL");
    expect(t).toContain(PLACEHOLDER_ASSINATURA);
    expect(t).toContain("Ilustração, não previsão de resultado");
    expect(t).toContain("Versão do software: 9.8.7");
  });

  it("caracteres fora do WinAnsi não quebram a geração", () => {
    expect(paraWinAnsi("≥ 4,5 mm → ok ✓ ±")).toBe(">= 4,5 mm -> ok ? ±");
  });
});
