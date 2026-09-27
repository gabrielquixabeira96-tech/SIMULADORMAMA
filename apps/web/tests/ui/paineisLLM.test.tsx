// @vitest-environment jsdom
/**
 * PainelAnamnese e PainelRelatorio (Marco 2b): chamam as rotas certas, mostram o resultado,
 * nunca exibem seção calculada em A (defesa em profundidade), sempre mostram o aviso e não têm
 * botão de compartilhar.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PainelAnamnese } from "@/ui/PainelAnamnese";
import { PainelRelatorio } from "@/ui/PainelRelatorio";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function stubFetch(rotas: Record<string, unknown>) {
  const chamadas: Array<{ url: string; corpo: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rotas[url];
      return new Response(JSON.stringify(r ?? { erro: { codigo: "nao_encontrado" } }), { status: r ? 201 : 404 });
    }),
  );
  return chamadas;
}

const secao = (id: string, calculado: boolean, linhas: string[]) => ({ id, titulo: id, origem: "template", calculado, linhas });
const relatorioResposta = (desenho: "A" | "B", secoes: unknown[]) => ({
  relatorio: {
    relatorio_id: REL,
    atendimento_id: AT,
    desenho,
    versao_software: "0.0.1",
    prosa_origem: "mock",
    prosa_rejeitada: null,
    parametros: { versao_config: { simulacao: "1.1", tepid: "1.0" }, envelope_rms_mm: 4.5, nao_calibrado: true, aviso: "Ilustração, não previsão de resultado" },
    simulacoes_mostradas: [],
    secoes,
  },
});

describe("PainelAnamnese", () => {
  it("envia texto, mostra a anamnese estruturada e limpa o texto bruto", async () => {
    const onRegistrada = vi.fn();
    const chamadas = stubFetch({
      "/api/llm/anamnese": {
        atendimento_id: AT,
        modo: "mock",
        anamnese: {
          esquema: "anamnese/1.0",
          queixa_principal: "Deseja aumento discreto.",
          objetivo_estetico: "aumento_discreto",
          tamanho_desejado_descricao: null,
          gestacoes: { numero: null, amamentou: null, planeja: "nao_informado" },
          cirurgias_mamarias_previas: [],
          comorbidades_relatadas: [],
          tabagismo: "nunca",
          medicamentos: [],
          alergias: [],
          expectativas_irreais_sinalizadas: false,
          campos_nao_informados: ["alergias"],
          texto_fonte_hash: "a".repeat(64),
        },
      },
    });
    render(<PainelAnamnese pacienteId={PAC} onRegistrada={onRegistrada} />);
    const area = screen.getByTestId("anamnese-texto") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Deseja aumento discreto. Não fuma." } });
    fireEvent.click(screen.getByTestId("anamnese-enviar"));
    await waitFor(() => expect(screen.getByTestId("anamnese-resultado")).toBeTruthy());
    expect(chamadas[0]).toEqual({ url: "/api/llm/anamnese", corpo: { paciente_id: PAC, atendimento_id: null, texto: "Deseja aumento discreto. Não fuma." } });
    expect(screen.getByTestId("anamnese-objetivo").textContent).toBe("Aumento discreto");
    expect(screen.getByTestId("anamnese-modo").textContent).toMatch(/mock/);
    expect(area.value).toBe("");
    expect(onRegistrada).toHaveBeenCalledWith(expect.objectContaining({ atendimentoId: AT, modo: "mock" }));
  });

  it("mostra o erro do servidor", async () => {
    stubFetch({});
    render(<PainelAnamnese pacienteId={PAC} />);
    fireEvent.change(screen.getByTestId("anamnese-texto"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("anamnese-enviar"));
    await waitFor(() => expect(screen.getByTestId("anamnese-erro").textContent).toBe("nao_encontrado"));
  });
});

describe("PainelRelatorio", () => {
  const secoesB = [secao("implantes", false, ["Motiva: volume 300 mL"]), secao("distancias", true, ["SSN-N: 212,34 mm"]), secao("volumes", true, ["Mama direita: 288,4 mL"]), secao("aviso", false, ["Ilustração, não previsão de resultado."])];

  it("B: gera relatório, mostra seções calculadas com data-testid e gera o PDF (abrir/baixar)", async () => {
    const onAtendimento = vi.fn();
    const chamadas = stubFetch({ "/api/relatorio": relatorioResposta("B", secoesB), "/api/pdf": { atendimento_id: AT, relatorio_id: REL, sha256: "f".repeat(64) } });
    render(<PainelRelatorio pacienteId={PAC} desenho="B" malhaId="dddddddd-dddd-4ddd-8ddd-dddddddddddd" onAtendimento={onAtendimento} />);
    expect(screen.getByTestId("relatorio-aviso").textContent).toBe("Ilustração, não previsão de resultado");
    fireEvent.click(screen.getByTestId("relatorio-gerar"));
    await waitFor(() => expect(screen.getByTestId("relatorio-conteudo")).toBeTruthy());
    expect(chamadas[0]!.corpo).toEqual({ paciente_id: PAC, malha_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", medida_id: null, atendimento_id: null });
    expect(screen.getAllByTestId("relatorio-numero-calculado")).toHaveLength(2);
    expect(onAtendimento).toHaveBeenCalledWith(AT);
    fireEvent.click(screen.getByTestId("relatorio-pdf-gerar"));
    await waitFor(() => expect(screen.getByTestId("relatorio-pdf-pronto")).toBeTruthy());
    expect(chamadas[1]).toEqual({ url: "/api/pdf", corpo: { atendimento_id: AT, relatorio_id: REL } });
    expect(screen.getByTestId("relatorio-pdf-abrir").getAttribute("href")).toBe(`/api/pdf/${AT}`);
    expect(screen.getByTestId("relatorio-pdf-baixar").getAttribute("href")).toBe(`/api/pdf/${AT}?download=1`);
  });

  it("A: nenhuma seção calculada é renderizada, mesmo se o servidor mandasse", async () => {
    stubFetch({ "/api/relatorio": relatorioResposta("A", secoesB) });
    render(<PainelRelatorio pacienteId={PAC} desenho="A" />);
    fireEvent.click(screen.getByTestId("relatorio-gerar"));
    await waitFor(() => expect(screen.getByTestId("relatorio-conteudo")).toBeTruthy());
    expect(screen.queryByTestId("relatorio-numero-calculado")).toBeNull();
    expect(document.body.textContent).not.toMatch(/212,34|288,4/);
    expect(screen.getByTestId("relatorio-secao-implantes")).toBeTruthy();
  });

  it("sem botão ou link de compartilhar", async () => {
    stubFetch({ "/api/relatorio": relatorioResposta("B", secoesB), "/api/pdf": { atendimento_id: AT, relatorio_id: REL, sha256: "f".repeat(64) } });
    render(<PainelRelatorio pacienteId={PAC} desenho="B" />);
    fireEvent.click(screen.getByTestId("relatorio-gerar"));
    await waitFor(() => expect(screen.getByTestId("relatorio-conteudo")).toBeTruthy());
    fireEvent.click(screen.getByTestId("relatorio-pdf-gerar"));
    await waitFor(() => expect(screen.getByTestId("relatorio-pdf-pronto")).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/compartilh|whatsapp|instagram|facebook|e-mail/i);
    for (const a of Array.from(document.querySelectorAll("a"))) expect(a.getAttribute("href")).toMatch(/^\/api\/pdf\//);
  });
});
