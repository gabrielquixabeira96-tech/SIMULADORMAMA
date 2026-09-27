// @vitest-environment jsdom
/**
 * Enforcement do DESENHO=A na UI (ADR 0005, camada a): os componentes de distâncias, volume e
 * alertas TEPID não são renderizados em A. Em B aparecem, e o volume nunca sem a faixa.
 */
import type { MedirResposta } from "@simulador/contratos";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { recursosDoDesenho } from "@/config/recursos";
import { AvisoFixo } from "@/ui/AvisoFixo";
import { FormularioTepid, valoresTepidVazios } from "@/ui/FormularioTepid";
import { PainelDistancias, PainelVolume } from "@/ui/PainelMedidas";
import type { ConfigPublica } from "@/config/publica";

afterEach(cleanup);

const medicao: MedirResposta = {
  distancias: {
    ssn_n_dir: { euclidiana_mm: 212.3, geodesica_mm: 224.1 },
    ssn_n_esq: null,
    n_imf_dir: null,
    n_imf_esq: null,
    base_dir: null,
    base_esq: null,
    intermamilar: { euclidiana_mm: 190.2, geodesica_mm: 205.3 },
  },
  volumes: { dir: { valor_ml: 288.4, incerteza_ml: 43.3, metodo: "plano_base_elipse" }, esq: null },
  quadro_anatomico: null,
  geodesica: { algoritmo: "mmp", biblioteca: "pygeodesic" },
  avisos: [],
};
const euclidianas = { ssn_n_dir: 212.3, ssn_n_esq: null, n_imf_dir: null, n_imf_esq: null, base_dir: null, base_esq: null, intermamilar: 190.2 };
const tepid: ConfigPublica["tepid"] = {
  versao: "1.0",
  status: "nao_conferido",
  nota: "conferir no texto original",
  fonte_referencia: "Tebbetts & Adams",
  campos: {
    base_mm: { rotulo: "Largura da base", unidade: "mm", min: 80, max: 200, por_lado: true, obrigatorio: true },
    apss_mm: { rotulo: "APSS", unidade: "mm", min: 5, max: 60, por_lado: true, obrigatorio: true },
    pinca_polo_superior_mm: { rotulo: "Pinça polo superior", unidade: "mm", min: 3, max: 80, por_lado: true, obrigatorio: true },
    pinca_sulco_mm: { rotulo: "Pinça sulco", unidade: "mm", min: 1, max: 40, por_lado: true, obrigatorio: true },
    n_imf_estirado_mm: { rotulo: "N-IMF estirado", unidade: "mm", min: 30, max: 160, por_lado: true, obrigatorio: true },
  },
};
const resultado = {
  alertas: [{ regra_id: "r", campo: "apss_mm", lado: "dir" as const, valor_mm: 10, alerta: "Alerta de teste", conferir_no_texto_original: true }],
  referencias: [],
};

function renderTudo(desenho: "A" | "B") {
  const recursos = recursosDoDesenho(desenho);
  return render(
    <>
      <PainelDistancias recursos={recursos} euclidianas={euclidianas} medicao={medicao} estado="ok" />
      <PainelVolume recursos={recursos} medicao={medicao} estado="ok" />
      <FormularioTepid recursos={recursos} tepid={tepid} valores={valoresTepidVazios()} onChange={() => undefined} onAvaliar={() => undefined} avaliando={false} resultado={resultado} erros={[]} />
    </>,
  );
}

describe("UI em DESENHO=A", () => {
  it("não renderiza distancias-painel, volume-painel nem tepid-alertas", () => {
    const { container } = renderTudo("A");
    for (const id of ["distancias-painel", "volume-painel", "tepid-alertas"]) expect(screen.queryByTestId(id)).toBeNull();
    // nenhum número calculado aparece na tela
    for (const n of ["212,3", "224,1", "190,2", "288,4", "43,3", "Alerta de teste"]) expect(container.textContent).not.toContain(n);
  });

  it("o formulário TEPID continua (campos digitados) com a nota de conferência", () => {
    renderTudo("A");
    expect(screen.getByTestId("tepid-form")).toBeTruthy();
    expect(screen.getByTestId("tepid-nota").textContent).toMatch(/conferir no texto original/);
    expect(screen.getByTestId("tepid-apss_mm-dir")).toBeTruthy();
  });
});

describe("UI em DESENHO=B", () => {
  it("renderiza os três painéis", () => {
    renderTudo("B");
    for (const id of ["distancias-painel", "volume-painel", "tepid-alertas"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByTestId("tepid-alertas").textContent).toContain("Alerta de teste");
  });

  it("volume sempre com faixa de incerteza", () => {
    renderTudo("B");
    const t = screen.getByTestId("volume-dir").textContent ?? "";
    expect(t).toContain("288,4 ± 43,3");
    expect(t).toMatch(/faixa 245,1–331,7/);
  });
});

describe("aviso fixo", () => {
  it("exibe 'Ilustração, não previsão de resultado'", () => {
    render(<AvisoFixo versao="0.0.1" desenho="B" />);
    expect(screen.getByTestId("aviso-fixo").textContent).toContain("Ilustração, não previsão de resultado");
  });
});
