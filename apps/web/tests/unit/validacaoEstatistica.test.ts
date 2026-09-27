/**
 * Cálculo da sessão de Bland-Altman e da planilha do art. 5º (ADR 0017) com valores conhecidos.
 * Os mesmos números são conferidos contra a referência Python em
 * services/mesh/tests/test_bland_altman_paridade.py.
 */
import { describe, expect, it } from "vitest";
import { blandAltman, embaralhar, prng, repetibilidade, resumir } from "@/validacao/estatistica";
import { COLUNAS, paraCsv, type Linha, type Planilha } from "@/validacao/planilha";
import { calcularResultado, observacaoSchema, operadorSchema, ordemItens, vistaPublica, type Sessao } from "@/validacao/sessao";

// Diferenças 1, 2, 3, 4, 5 → viés 3; DP amostral √2,5 = 1,5811388; LoA 3 ± 3,0990321.
const PARES_CONHECIDOS = [
  { medida: "a", referencia_mm: 100, medido_mm: 101 },
  { medida: "a", referencia_mm: 100, medido_mm: 102 },
  { medida: "b", referencia_mm: 50, medido_mm: 53 },
  { medida: "b", referencia_mm: 50, medido_mm: 54 },
  { medida: "b", referencia_mm: 10, medido_mm: 15 },
];

describe("Bland-Altman (paridade com services/mesh/mesh/medir/bland_altman.py)", () => {
  it("viés, DP amostral e LoA 95 % com valores conhecidos", () => {
    const r = blandAltman(PARES_CONHECIDOS);
    expect(r.n).toBe(5);
    expect(r.vies_mm).toBe(3);
    expect(r.dp_mm).toBe(1.5811);
    expect(r.loa_inferior_mm).toBe(-0.099);
    expect(r.loa_superior_mm).toBe(6.099);
    expect(r.erro_abs_max_mm).toBe(5);
    expect(r.dentro_de_2mm).toBe(false);
    expect(r.dentro_de_3mm).toBe(false);
    expect(r.por_medida.a).toEqual({ n: 2, vies_mm: 1.5, dp_mm: 0.7071, loa_inferior_mm: 0.1141, loa_superior_mm: 2.8859 });
    expect(r.por_medida.b).toMatchObject({ n: 3, vies_mm: 4, dp_mm: 1 });
  });

  it("critérios ±2 mm (Marco 1) e ±3 mm (ESTRATEGIA fase 1) nos limites", () => {
    // diferenças ±d alternadas: viés 0, LoA = ±1,96·DP
    const pares = (d: number) => [d, -d, d, -d].map((x) => ({ medida: "m", referencia_mm: 0, medido_mm: x }));
    // DP de [d,−d,d,−d] = d·√(4/3); LoA = 1,96·d·1,1547 = 2,2632·d
    const r1 = blandAltman(pares(1)); // LoA ±2,2632
    expect(r1.vies_mm).toBe(0);
    expect(r1.loa_superior_mm).toBe(2.2632);
    expect(r1.dentro_de_2mm).toBe(false);
    expect(r1.dentro_de_3mm).toBe(true);
    const r2 = blandAltman(pares(0.8)); // LoA ±1,8106
    expect(r2.dentro_de_2mm).toBe(true);
  });

  it("n = 0 e n = 1 não inventam DP nem LoA", () => {
    expect(resumir([])).toEqual({ n: 0, vies_mm: null, dp_mm: null, loa_inferior_mm: null, loa_superior_mm: null });
    expect(resumir([0.5])).toEqual({ n: 1, vies_mm: 0.5, dp_mm: null, loa_inferior_mm: null, loa_superior_mm: null });
    expect(blandAltman([]).dentro_de_2mm).toBeNull();
  });

  it("repetibilidade intra-operador: s_w = √(média das variâncias); CR = 1,96·√2·s_w", () => {
    // grupos com variâncias 0,5 e 2 → s_w = √1,25 = 1,1180; CR = 2,7719·1,1180 = 3,0990
    const r = repetibilidade([
      [10, 11],
      [20, 22],
      [5], // 1 repetição só: ignorado
    ]);
    expect(r.n_grupos).toBe(2);
    expect(r.dp_intra_mm).toBe(1.118);
    expect(r.coeficiente_repetibilidade_mm).toBe(3.099);
    expect(repetibilidade([[1]])).toEqual({ n_grupos: 0, dp_intra_mm: null, coeficiente_repetibilidade_mm: null });
  });
});

describe("ordem aleatória reprodutível", () => {
  it("mesma semente → mesma ordem; cada repetição é uma permutação; sem repetição imediata na virada", () => {
    const scans = ["S-A", "S-B", "S-C"];
    const o1 = ordemItens(scans, 3, 12345);
    expect(ordemItens(scans, 3, 12345)).toEqual(o1);
    expect(o1).toHaveLength(9);
    for (const r of [1, 2, 3]) expect(o1.filter((i) => i.repeticao === r).map((i) => i.scan_id).sort()).toEqual(scans);
    for (let i = 1; i < o1.length; i++) expect(o1[i]!.scan_id).not.toBe(o1[i - 1]!.scan_id);
    // outra semente muda a ordem em algum ponto (e o embaralhamento não altera a entrada)
    const sementes = [1, 2, 3, 4, 5].map((s) => JSON.stringify(ordemItens(scans, 3, s)));
    expect(new Set(sementes).size).toBeGreaterThan(1);
    const base = [1, 2, 3];
    embaralhar(base, prng(9));
    expect(base).toEqual([1, 2, 3]);
  });
});

describe("entradas do operador sem dado identificável", () => {
  it("operador é código pseudônimo; nome com espaço ou e-mail é recusado", () => {
    expect(operadorSchema.parse(" op-01 ")).toBe("OP-01");
    expect(operadorSchema.safeParse("Maria Silva").success).toBe(false);
    expect(operadorSchema.safeParse("maria@hospital.br").success).toBe(false);
    expect(observacaoSchema.safeParse("contato: fulano@x.com").success).toBe(false);
    expect(observacaoSchema.safeParse("luz fraca na sala").success).toBe(true);
  });
});

// ------------------------------------------------------------------ resultado da sessão

const GAB = {
  tA: { distancias: { ssn_n_dir: { euclidiana_mm: 200, geodesica_mm: 210 }, n_imf_dir: { euclidiana_mm: 70, geodesica_mm: 75 }, base_dir: null } },
  tB: { distancias: { ssn_n_dir: { euclidiana_mm: 190, geodesica_mm: null }, n_imf_dir: { euclidiana_mm: 60, geodesica_mm: 64 } } },
};
const item = (indice: number, scan_id: string, repeticao: number, d: Record<string, { euclidiana_mm: number; geodesica_mm: number | null } | null>) => ({
  indice,
  scan_id,
  repeticao,
  registrado_em: "2026-09-27T10:00:00-04:00",
  landmarks: {},
  distancias: d,
  avisos: [],
});
const SESSAO_FECHADA = {
  tipo_operador: "humano" as const,
  scans: [
    { scan_id: "S-1111", torso: "tA", sha256_gabarito: "x" },
    { scan_id: "S-2222", torso: "tB", sha256_gabarito: "y" },
  ],
  itens: [
    item(0, "S-1111", 1, { ssn_n_dir: { euclidiana_mm: 201, geodesica_mm: 211 }, n_imf_dir: { euclidiana_mm: 71, geodesica_mm: 77 }, base_dir: { euclidiana_mm: 100, geodesica_mm: 101 } }),
    item(1, "S-2222", 1, { ssn_n_dir: { euclidiana_mm: 189, geodesica_mm: 199 }, n_imf_dir: { euclidiana_mm: 61, geodesica_mm: 65 } }),
    item(2, "S-1111", 2, { ssn_n_dir: { euclidiana_mm: 202, geodesica_mm: 212 }, n_imf_dir: { euclidiana_mm: 70, geodesica_mm: 75 } }),
    item(3, "S-2222", 2, { ssn_n_dir: { euclidiana_mm: 190, geodesica_mm: 200 }, n_imf_dir: { euclidiana_mm: 60, geodesica_mm: 64 } }),
  ],
};

describe("calcularResultado", () => {
  const r = calcularResultado(SESSAO_FECHADA, GAB, "2026-09-27T11:00:00-04:00");

  it("pares só onde há gabarito e medida (geodésica nula do gabarito e base sem gabarito ficam fora)", () => {
    // tA: 2 distâncias × 2 tipos × 2 reps = 8; tB: ssn só euclidiana + n_imf × 2 tipos = 3 × 2 reps = 6
    expect(r.pares).toHaveLength(14);
    expect(r.pares.some((p) => p.distancia === "base_dir")).toBe(false);
    expect(r.pares.find((p) => p.scan_id === "S-1111" && p.repeticao === 1 && p.medida === "n_imf_dir:geodesica")).toMatchObject({ referencia_mm: 75, medido_mm: 77, desvio_mm: 2, torso: "tA" });
  });

  it("geral, N-IMF à parte e critérios", () => {
    // desvios: tA r1 [1,1,1,2], tB r1 [-1,1,1], tA r2 [2,2,0,0], tB r2 [0,0,0]
    const dif = [1, 1, 1, 2, -1, 1, 1, 2, 2, 0, 0, 0, 0, 0];
    const m = dif.reduce((a, b) => a + b) / dif.length;
    expect(r.geral.n).toBe(14);
    expect(r.geral.vies_mm).toBeCloseTo(m, 4);
    expect(r.n_imf.n).toBe(8);
    expect(r.sem_n_imf.n).toBe(6);
    expect(r.n_imf.n + r.sem_n_imf.n).toBe(r.geral.n);
    expect(r.euclidiana.n + r.geodesica.n).toBe(r.geral.n);
    expect(r.criterios).toMatchObject({ n_pares: 14, n_pares_min_30: false, n_imf_relatado_a_parte: true, scans_distintos: 2, vale_para_fase1: false });
    expect(r.criterios.motivo_fase1).toMatch(/sintétic/);
  });

  it("intra-operador: rep. 2 − rep. 1 por (scan, medida)", () => {
    // pares rep1→rep2 (a geodésica SSN de tB não tem gabarito): tA ssn e +1, ssn g +1, nimf e −1, nimf g −2; tB ssn e +1, nimf e −1, nimf g −1
    const ba = r.intra_operador.bland_altman_rep2_rep1!;
    expect(ba.n).toBe(7);
    expect(ba.vies_mm).toBe(Math.round((-2 / 7) * 1e4) / 1e4);
    expect(r.intra_operador.n_grupos).toBe(7);
    // variâncias dos grupos: 0,5 ×6 (diferença 1) e 2 (77→75) → média 5/7
    expect(r.intra_operador.dp_intra_mm).toBe(Math.round(Math.sqrt(5 / 7) * 1e4) / 1e4);
  });
});

describe("vista pública (cegueira ao gabarito)", () => {
  const aberta: Sessao = {
    esquema: "sessao_bland_altman/1.0",
    id: "11111111-2222-4333-8444-555555555555",
    versao_software: "0.1.1",
    desenho: "B",
    operador: "OP-01",
    tipo_operador: "humano",
    repeticoes: 2,
    semente: 7,
    estado: "aberta",
    criada_em: "2026-09-27T10:00:00-04:00",
    encerrada_em: null,
    scans: SESSAO_FECHADA.scans,
    itens: SESSAO_FECHADA.itens.map((i, k) => (k < 2 ? i : { ...i, registrado_em: null, distancias: null, landmarks: null })),
    observacoes: null,
    resultado: null,
  };

  it("aberta: sem torso, sem distâncias, sem landmarks, sem sha do gabarito", () => {
    const v = vistaPublica(aberta);
    const txt = JSON.stringify(v);
    expect(txt).not.toMatch(/tA|tB|distancias|landmarks"|sha256|posicao|euclidiana|geodesica|resultado/);
    expect(v.proximo_indice).toBe(2);
    expect(v.itens.map((i) => i.concluido)).toEqual([true, true, false, false]);
    // só números inteiros de índice/repetição (nenhum mm)
    const { esquema: _e, versao_software: _v, criada_em: _c, ...resto } = v;
    void [_e, _v, _c];
    expect(JSON.stringify(resto).match(/\d+\.\d+/g) ?? []).toEqual([]);
  });

  it("cancelada continua cega; encerrada revela scans e resultado", () => {
    expect(JSON.stringify(vistaPublica({ ...aberta, estado: "cancelada" }))).not.toMatch(/tA|tB|resultado/);
    const fechada = vistaPublica({ ...aberta, estado: "encerrada", itens: SESSAO_FECHADA.itens, resultado: calcularResultado(SESSAO_FECHADA, GAB) });
    expect(fechada.scans?.map((s) => s.torso)).toEqual(["tA", "tB"]);
    expect(fechada.resultado).toBeTruthy();
  });
});

describe("CSV da planilha", () => {
  const linha = (extra: Partial<Linha>): Linha => ({
    versao_software: "0.1.1",
    data: "2026-09-27",
    fonte: "sessao_bland_altman",
    registro: "sessao:x",
    commit: null,
    desenho: "B",
    operador: "OP-01",
    tipo_operador: "humano",
    scan_id: "sintetico:t01_simetrico_300",
    sintetico: "sim",
    repeticao: 1,
    medida: "n_imf_dir",
    tipo_distancia: "geodesica",
    n_imf: "sim",
    referencia_mm: 70.12,
    medido_mm: 69.5,
    desvio_mm: -0.62,
    observacoes: "sessão cega",
    ...extra,
  });
  const p = (linhas: Linha[]): Planilha => ({ esquema: "planilha_validacao_art5/1.0", gerada_em: "", versao_software: "0.1.1", colunas: COLUNAS, linhas, resumo: [], notas: [] });

  it("cabeçalho exato, BOM, CRLF; número negativo não vira texto", () => {
    const csv = paraCsv(p([linha({})]));
    expect(csv.startsWith("﻿")).toBe(true);
    const [cab, l1] = csv.slice(1).split("\r\n");
    expect(cab).toBe(COLUNAS.join(","));
    expect(l1).toBe('0.1.1,2026-09-27,sessao_bland_altman,sessao:x,,B,OP-01,humano,sintetico:t01_simetrico_300,sim,1,n_imf_dir,geodesica,sim,70.12,69.5,-0.62,"sessão cega"');
  });

  it("separador ; usa vírgula decimal; texto com fórmula é neutralizado e com aspas escapado", () => {
    const csv = paraCsv(p([linha({ observacoes: '=HYPERLINK("x")', operador: "OP;2" })]), { separador: ";" });
    const l1 = csv.slice(1).split("\r\n")[1]!;
    expect(l1).toContain(";70,12;69,5;-0,62;");
    expect(l1).toContain(`"'=HYPERLINK(""x"")"`);
    expect(l1).toContain('"OP;2"');
  });
});
