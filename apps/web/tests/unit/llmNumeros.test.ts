/**
 * Teste travado do relatório (ADR 0006 item 6; Marco 2b): QUALQUER número no texto final que
 * divirja dos dados reprova — dígitos, vírgula decimal pt-BR, milhar e números por extenso.
 * Inclui a "alucinação" injetada no mock e as guardas do DESENHO=A.
 */
import type { Distancias, MedidasDigitadas, Volumes } from "@simulador/contratos";
import { describe, expect, it } from "vitest";
import { extrairNumeros, extrairNumerosPorExtenso, valorDeDigitos } from "@/llm/extrairNumeros";
import { ProvedorMock, PROSA_MOCK } from "@/llm/mock";
import { montarDadosTravados, numerosPermitidos, representacoes, verificarNumeros, type ImplanteMostrado } from "@/llm/numeros";
import { gerarRelatorio, listasPermitidas, montarEntradaRelatorio, secoesTemplate, textoDasSecoes, type EntradaRelatorio } from "@/llm/relatorio";
import { SaidaLLMInvalidaError, type ProvedorLLM } from "@/llm/provedor";

const digitadas: MedidasDigitadas = {
  base_mm: { dir: 120, esq: 118 },
  apss_mm: { dir: 25, esq: 25 },
  pinca_polo_superior_mm: { dir: 22, esq: 21 },
  pinca_sulco_mm: { dir: 6, esq: 6 },
  n_imf_estirado_mm: { dir: 80, esq: 82 },
};
const distancias: Distancias = {
  ssn_n_dir: { euclidiana_mm: 212.34, geodesica_mm: 224.1 },
  ssn_n_esq: { euclidiana_mm: 213.9, geodesica_mm: null },
  n_imf_dir: null,
  n_imf_esq: null,
  base_dir: null,
  base_esq: null,
  intermamilar: { euclidiana_mm: 190.2, geodesica_mm: 205.3 },
};
const volumes: Volumes = { dir: { valor_ml: 288.4, incerteza_ml: 43.3, metodo: "plano_base_elipse" }, esq: { valor_ml: 301.7, incerteza_ml: 45.2, metodo: "plano_base_elipse" } };
const implantes: ImplanteMostrado[] = [
  { id: "motiva-rsd-300", rotulo: "Motiva SilkSurface Demi (RSD-300)", plano: "dual_plane", imf: "rebaixar", volume_ml: 300, base_mm: 116, projecao_mm: 38 },
];
/** Representações dos valores CALCULADOS (nunca podem aparecer em A). */
const CALCULADOS = ["212,34", "212.34", "224,1", "213,9", "190,2", "205,3", "288,4", "43,3", "301,7", "45,2"];

function entrada(desenho: "A" | "B"): EntradaRelatorio {
  return {
    relatorioId: "00000000-0000-4000-8000-000000000001",
    atendimentoId: "00000000-0000-4000-8000-000000000002",
    pseudonimo: "P-7K2M9Q",
    desenho,
    versaoSoftware: "0.0.1",
    geradoEm: "2026-09-26T10:00:00-04:00",
    parametros: { versao_config: { simulacao: "1.1", tepid: "1.0" }, envelope_rms_mm: 4.5, nao_calibrado: true, aviso: "Ilustração, não previsão de resultado" },
    dados: montarDadosTravados({ implantes, medidasDigitadas: digitadas, distancias, volumes }, desenho),
    simulacoes: [],
  };
}

const comProsa = (p: Partial<typeof PROSA_MOCK.paragrafos>) => new ProvedorMock({ prosa: p });

describe("extração de números em pt-BR", () => {
  it("dígitos: vírgula decimal, ponto decimal e milhar", () => {
    expect(valorDeDigitos("4,5")).toBe(4.5);
    expect(valorDeDigitos("4.5")).toBe(4.5);
    expect(valorDeDigitos("1.000")).toBe(1000);
    expect(valorDeDigitos("1.234,56")).toBe(1234.56);
    expect(extrairNumeros("De 212,34 mm para 1.000,5 mL e ±4.5").map((n) => n.valor)).toEqual([212.34, 1000.5, 4.5]);
  });

  it("por extenso: inteiros compostos, decimais, milhar e 'e meio'", () => {
    const v = (t: string) => extrairNumerosPorExtenso(t).map((n) => n.valor);
    expect(v("implante de trezentos mililitros")).toEqual([300]);
    expect(v("trezentos e cinquenta")).toEqual([350]);
    expect(v("duzentos e oitenta e oito vírgula quatro")).toEqual([288.4]);
    expect(v("quatro vírgula cinco milímetros")).toEqual([4.5]);
    expect(v("zero vírgula zero cinco")).toEqual([0.05]);
    expect(v("mil e duzentos")).toEqual([1200]);
    expect(v("dois mil trezentos e quarenta e cinco")).toEqual([2345]);
    expect(v("trezentos e meio")).toEqual([300.5]);
    expect(v("TRÊS implantes e duas mamas")).toEqual([3, 2]);
  });

  it("artigo 'um/uma', 'por cento' isolado e ordinais não são números", () => {
    expect(extrairNumerosPorExtenso("Uma simulação de um implante, na primeira consulta, por cento")).toEqual([]);
    expect(extrairNumerosPorExtenso("vinte e um").map((n) => n.valor)).toEqual([21]);
    expect(extrairNumerosPorExtenso("um vírgula cinco").map((n) => n.valor)).toEqual([1.5]);
  });

  it("palavras que contêm numerais não são confundidas (setembro, dezembro, milímetros, cemitério)", () => {
    expect(extrairNumerosPorExtenso("setembro dezembro milímetros cemitério tridimensional seiscentista")).toEqual([]);
  });
});

describe("verificarNumeros — teste travado", () => {
  const p = numerosPermitidos(montarDadosTravados({ implantes, medidasDigitadas: digitadas, distancias, volumes }, "B"), [4.5]);

  it("aceita os números dos dados em qualquer representação sem perda", () => {
    const v = verificarNumeros({ a: "Implante de 300 mL (300,0 mL), base 116 mm, envelope ±4,5 mm (4.50), SSN-N 212,34 mm." }, p);
    expect(v).toMatchObject({ ok: true, intrusos: [] });
  });

  it("recusa número divergente em dígitos, com vírgula, arredondado ou por extenso", () => {
    const casos: Array<[string, string]> = [
      ["O volume ficou em 310 mL.", "310"],
      ["Projeção de 38,5 mm.", "38,5"],
      ["SSN-N de 212,3 mm.", "212,3"], // arredondar não vale
      ["Cerca de 1.000 mL.", "1.000"],
      ["Implante de trezentos e cinquenta mililitros.", "trezentos e cinquenta"],
      ["Envelope de quatro vírgula oito milímetros.", "quatro virgula oito"],
      ["Foram mostrados dois implantes.", "dois"],
    ];
    for (const [texto, intruso] of casos) {
      const v = verificarNumeros({ introducao: texto }, p);
      expect(v.ok, texto).toBe(false);
      expect(v.intrusos, texto).toContain(intruso);
      expect(v.detalhes[0]?.secao).toBe("introducao");
    }
  });

  it("aceita por extenso quando o valor está nos dados (trezentos = 300)", () => {
    expect(verificarNumeros({ a: "Implante de trezentos mililitros." }, p).ok).toBe(true);
  });

  it("compatível com a representação textual exata da lista", () => {
    expect(representacoes(212.34)).toContain("212,34");
    expect(verificarNumeros({ a: "212,34" }, ["212,34"]).ok).toBe(true);
  });
});

describe("relatório: template travado + prosa verificada", () => {
  it("mock sem alucinação: prosa aceita (origem mock) e o texto final inteiro confere", async () => {
    const r = await gerarRelatorio(entrada("B"), new ProvedorMock());
    expect(r.prosa_origem).toBe("mock");
    expect(r.prosa_rejeitada).toBeNull();
    expect(r.verificacao.ok).toBe(true);
    // a prosa-padrão não tem número nenhum
    expect(verificarNumeros(PROSA_MOCK.paragrafos, []).ok).toBe(true);
  });

  it("ALUCINAÇÃO injetada no mock (dígitos) é pega: prosa descartada e substituída", async () => {
    const r = await gerarRelatorio(entrada("B"), comProsa({ o_que_foi_simulado: "Simulamos um implante de 350 mL que deve dar projeção de 42 mm." }));
    expect(r.prosa_origem).toBe("mock_substituto");
    expect(r.prosa_rejeitada).toEqual({ motivo: "numero_fora_da_lista", intrusos: ["350", "42"] });
    expect(r.prosa).toEqual(PROSA_MOCK);
    const texto = Object.values(textoDasSecoes(r.secoes)).join("\n");
    expect(texto).not.toMatch(/350|42 mm/);
  });

  it("ALUCINAÇÃO por extenso e com vírgula decimal também é pega", async () => {
    for (const alucinacao of ["O resultado terá trezentos e cinquenta mililitros.", "A mama ficará com 212,9 mm de distância.", "A margem é de quatro vírgula oito milímetros."]) {
      const r = await gerarRelatorio(entrada("B"), comProsa({ limitacoes: alucinacao }));
      expect(r.prosa_origem, alucinacao).toBe("mock_substituto");
    }
  });

  it("saída do provedor fora do contrato → prosa-padrão (nunca texto livre)", async () => {
    const quebrado: ProvedorLLM = {
      modo: "anthropic",
      registrarAnamnese: () => Promise.reject(new Error("não usado")),
      redigirProsaRelatorio: () => Promise.reject(new SaidaLLMInvalidaError("sem tool_use")),
    };
    const r = await gerarRelatorio(entrada("B"), quebrado);
    expect(r.prosa_origem).toBe("mock_substituto");
    expect(r.prosa_rejeitada?.motivo).toBe("saida_llm_invalida");
  });

  it("B: seções calculadas presentes e marcadas; números no template exatamente como nos dados", async () => {
    const r = await gerarRelatorio(entrada("B"), new ProvedorMock());
    const calc = r.secoes.filter((s) => s.calculado).map((s) => s.id);
    expect(calc).toEqual(["distancias", "volumes"]);
    const texto = Object.values(textoDasSecoes(r.secoes)).join("\n");
    for (const n of ["212,34", "224,1", "288,4", "43,3", "300", "116", "38", "4,5", "120", "118"]) expect(texto).toContain(n);
  });
});

describe("guardas do DESENHO=A no relatório", () => {
  it("dados travados e lista da prosa sem nada calculado (nem o envelope)", () => {
    const e = entrada("A");
    expect(e.dados.distancias).toBeNull();
    expect(e.dados.volumes).toBeNull();
    const l = listasPermitidas(e.dados, "A", 4.5);
    for (const c of CALCULADOS) expect(l.prosa).not.toContain(c);
    expect(l.prosa).not.toContain("4,5");
    expect(l.prosa).toEqual(expect.arrayContaining(["120", "118", "25", "300", "116", "38"]));
  });

  it("entrada ao LLM em A não contém nenhum número calculado", () => {
    const e = entrada("A");
    const l = listasPermitidas(e.dados, "A", 4.5);
    const s = JSON.stringify(montarEntradaRelatorio(e.dados, "A", e.pseudonimo, l.prosa));
    for (const c of ["212.34", "224.1", "190.2", "288.4", "43.3", "301.7"]) expect(s).not.toContain(c);
    expect(s).toContain('"distancias":null');
    expect(s).toContain('"volumes":null');
  });

  it("template em A: nenhuma seção calculada, mesmo recebendo distâncias/volumes", () => {
    const secoes = secoesTemplate({ implantes_mostrados: implantes, medidas_digitadas: digitadas, distancias, volumes }, "A", 4.5);
    expect(Object.values(secoes).some((s) => s.calculado)).toBe(false);
    expect(secoes.distancias).toBeUndefined();
    expect(secoes.volumes).toBeUndefined();
  });

  it("prosa com número calculado (volume estimado) é recusada em A; texto final sem calculados", async () => {
    const r = await gerarRelatorio(entrada("A"), comProsa({ o_que_foi_simulado: "O volume estimado da mama direita foi de 288,4 mL." }));
    expect(r.prosa_origem).toBe("mock_substituto");
    expect(r.prosa_rejeitada?.intrusos).toEqual(["288,4"]);
    const texto = Object.values(textoDasSecoes(r.secoes)).join("\n");
    for (const c of CALCULADOS) expect(texto).not.toContain(c);
    expect(texto).toContain("120"); // digitado entra
    expect(texto).toContain("300"); // catálogo entra
  });

  it("em A a prosa não pode citar nem o envelope (só digitados + catálogo)", async () => {
    const r = await gerarRelatorio(entrada("A"), comProsa({ limitacoes: "A incerteza é de 4,5 mm." }));
    expect(r.prosa_origem).toBe("mock_substituto");
  });
});

/** Revisão v0.1.1, item 4: numerais Unicode, romanos e palavras de quantidade não escapam do verificador. */
describe("verificarNumeros — numerais não ASCII, romanos e palavras de quantidade", () => {
  const permitidos = ["300", "320"];
  const recusa = (texto: string) => {
    const v = verificarNumeros({ p: texto }, permitidos);
    expect(v.ok, texto).toBe(false);
    return v;
  };

  it("dígitos de largura total são normalizados (NFKC) e conferidos pelo valor: ３２０ passa se 320 é permitido, ３３０ não", () => {
    expect(verificarNumeros({ p: "prótese de ３２０ mL" }, permitidos).ok).toBe(true);
    expect(recusa("prótese de ３３０ mL").intrusos).toEqual(["330"]);
  });

  it("numeral não ASCII (árabe-índico, devanágari) é sempre recusado, mesmo com valor permitido", () => {
    expect(recusa("prótese de ٣٢٠ mL").detalhes[0]).toMatchObject({ forma: "nao_ascii" });
    expect(recusa("prótese de ३२० mL").detalhes[0]).toMatchObject({ forma: "nao_ascii" });
  });

  it("numeral romano (≥ 2 letras) é recusado; D/E isolados (direita/esquerda) não", () => {
    expect(recusa("volume de CCCXX mL").detalhes[0]).toMatchObject({ forma: "romano", valor: 320 });
    expect(recusa("grau XIV").detalhes[0]).toMatchObject({ forma: "romano", valor: 14 });
    expect(recusa("prótese Ⅻ").detalhes[0]).toMatchObject({ forma: "romano" }); // Ⅻ → XII pelo NFKC
    expect(verificarNumeros({ p: "mamas D e E simétricas; DM ausente" }, permitidos).ok).toBe(true);
  });

  it("palavras de quantidade são recusadas: dezenas, dobro, metade, dúzia, centenas, milhares, um terço", () => {
    for (const t of ["algumas dezenas de mililitros", "o dobro do volume", "metade da projeção", "uma dúzia de pontos", "centenas de casos", "milhares de pacientes", "um terço da base", "três quartos"]) {
      expect(recusa(t).detalhes.some((d) => d.forma === "quantidade"), t).toBe(true);
    }
    // termos anatômicos/comuns sem numeral antes não contam
    expect(verificarNumeros({ p: "no terço inferior do polo, com curativo no quarto dia" }, permitidos).ok).toBe(true);
  });

  it("extrairNumeros expõe a forma de cada achado", () => {
    const f = extrairNumeros("٣ CCCXX dobro 320").map((n) => n.forma).sort();
    expect(f).toEqual(["digitos", "nao_ascii", "quantidade", "romano"]);
  });
});
