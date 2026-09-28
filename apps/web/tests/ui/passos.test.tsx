// @vitest-environment jsdom
/**
 * Pacote P3: barra dos 3 passos (✓, Próximo com motivo do bloqueio), figura-guia dos pontos (um `li`
 * por ponto, "✓" sem índice de vértice), mensagem local ("Salvo ✓", "alterações não salvas") e a
 * base do TEPID pré-preenchida só em DESENHO=B.
 */
import { DEFINICOES_LANDMARKS, type Landmarks } from "@simulador/contratos";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigPublica } from "@/config/publica";
import { recursosDoDesenho } from "@/config/recursos";
import { FormularioTepid, valoresTepidVazios } from "@/ui/FormularioTepid";
import { GuiaLandmarks } from "@/ui/GuiaLandmarks";
import { Mensagem } from "@/ui/Mensagem";
import { Passos, type PassoInfo } from "@/ui/Passos";

afterEach(cleanup);

const passos = (motivo1: string | null, feito1 = false): PassoInfo[] => [
  { n: 1, titulo: "Captura", feito: feito1, motivo: motivo1 },
  { n: 2, titulo: "Medidas", feito: false, motivo: "Marque os 10 pontos (faltam 10)." },
  { n: 3, titulo: "Simulação", feito: false, motivo: null },
];

describe("Passos", () => {
  it("mostra os 3 passos; Próximo bloqueado diz o motivo em uma linha", () => {
    render(<Passos passos={passos("Comece com “Nova simulação”.")} />);
    expect(screen.getByTestId("passo-1").textContent).toContain("Captura");
    expect(screen.getByTestId("passo-2").textContent).toContain("Medidas");
    expect(screen.getByTestId("passo-3").textContent).toContain("Simulação");
    expect(screen.getByTestId("passo-motivo").textContent).toBe("Comece com “Nova simulação”.");
    expect((screen.getByTestId("passo-proximo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("passo concluído ganha ✓; sem motivo, Próximo rola até a seção seguinte e foca o primeiro controle", () => {
    const secao = document.createElement("section");
    secao.setAttribute("data-passo", "2");
    const botao = document.createElement("button");
    secao.appendChild(botao);
    document.body.appendChild(secao);
    const rolar = vi.fn();
    secao.scrollIntoView = rolar;
    render(<Passos passos={passos(null, true)} />);
    expect(screen.getByTestId("passo-1").getAttribute("data-feito")).toBe("1");
    expect(screen.getByTestId("passo-1").textContent).toContain("✓");
    expect(screen.queryByTestId("passo-motivo")).toBeNull();
    fireEvent.click(screen.getByTestId("passo-proximo"));
    expect(rolar).toHaveBeenCalled();
    expect(document.activeElement).toBe(botao);
    secao.remove();
  });
});

describe("GuiaLandmarks", () => {
  it("um li por ponto com o rótulo do contrato; ✓ quando marcado, sem índice de vértice", () => {
    const lm: Landmarks = { furcula: { posicao: [0, 0, 0], vertice: 19823, origem: "clique" } };
    render(<GuiaLandmarks landmarks={lm} ativo="mamilo_dir" onAtivar={() => undefined} onApagar={() => undefined} />);
    const guia = screen.getByTestId("landmarks-guia");
    const itens = guia.querySelectorAll("li");
    expect(itens).toHaveLength(DEFINICOES_LANDMARKS.length);
    expect(itens[0]!.textContent).toMatch(/^Fúrcula \(SSN\) \*✓/);
    expect(guia.textContent).not.toMatch(/v19823|vértice/);
    expect(guia.querySelector("svg")?.getAttribute("role")).toBe("img");
  });
});

describe("Mensagem local", () => {
  it("sucesso com hora e aviso de alteração não salva; erro vira alert", () => {
    const { rerender } = render(<Mensagem msg={{ tipo: "ok", texto: "TEPID gravado. ✓", hora: "14:32" }} naoSalvo />);
    expect(screen.getByRole("status").textContent).toBe("TEPID gravado. ✓ · 14:32 · alterações não salvas");
    rerender(<Mensagem msg={{ tipo: "erro", texto: "falhou" }} />);
    expect(screen.getByRole("alert").textContent).toBe("falhou");
  });
});

const tepid: ConfigPublica["tepid"] = {
  versao: "1.0",
  status: "nao_conferido",
  nota: "conferir no texto original",
  fonte_referencia: "Tebbetts & Adams",
  campos: {
    base_mm: { rotulo: "Largura da base", unidade: "mm", min: 80, max: 200, por_lado: true, obrigatorio: true },
    apss_mm: { rotulo: "APSS", unidade: "mm", min: 5, max: 60, por_lado: true, obrigatorio: true },
  },
} as ConfigPublica["tepid"];

describe("TEPID: base pré-preenchida pelo 3D", () => {
  const comBase = () => {
    const v = valoresTepidVazios();
    v.base_mm = { dir: "113.5", esq: "112" };
    return v;
  };

  it("B: marca a base pré-preenchida para confirmar", () => {
    render(<FormularioTepid recursos={recursosDoDesenho("B")} tepid={tepid} valores={comBase()} onChange={() => undefined} onAvaliar={() => undefined} avaliando={false} resultado={null} erros={[]} basePreenchida={{ dir: "113.5", esq: "110" }} />);
    expect(screen.getByTestId("tepid-base-pre-dir").textContent).toBe("pré-preenchida pelo 3D — confirme");
    // o lado esquerdo foi alterado pelo cirurgião: sem a marca
    expect(screen.queryByTestId("tepid-base-pre-esq")).toBeNull();
  });

  it("A: a prop é ignorada — nenhum texto de pré-preenchimento", () => {
    const { container } = render(
      <FormularioTepid recursos={recursosDoDesenho("A")} tepid={tepid} valores={comBase()} onChange={() => undefined} onAvaliar={() => undefined} avaliando={false} resultado={null} erros={[]} basePreenchida={{ dir: "113.5", esq: "112" }} />,
    );
    expect(container.textContent).not.toMatch(/pré-preenchid/i);
    expect(screen.queryByTestId("tepid-base-pre-dir")).toBeNull();
  });

  it("nota de conferência sempre visível; a fonte técnica fica recolhida", () => {
    render(<FormularioTepid recursos={recursosDoDesenho("B")} tepid={tepid} valores={valoresTepidVazios()} onChange={() => undefined} onAvaliar={() => undefined} avaliando={false} resultado={null} erros={[]} />);
    expect(screen.getByTestId("tepid-nota").textContent).toMatch(/conferir no texto original/);
    expect(screen.getByTestId("tepid-nota").textContent).not.toMatch(/config\/tepid/);
    expect(screen.getByText("config/tepid.json").closest("details")).not.toBeNull();
  });
});
