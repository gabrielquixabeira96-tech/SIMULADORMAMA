/**
 * Marco 2b contra o banco de teste (modo mock, sem rede): anamnese, relatório e PDF pelas rotas,
 * gravação e AUDITORIA de toda geração, leitura e download; prosa alucinada recusada e auditada;
 * DESENHO=A sem números calculados até o PDF baixado.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postAnamnese } from "@/app/api/llm/anamnese/route";
import { GET as getPdf } from "@/app/api/pdf/[atendimentoId]/route";
import { POST as postPdf } from "@/app/api/pdf/route";
import { GET as getRelatorio } from "@/app/api/relatorio/[id]/route";
import { POST as postRelatorio } from "@/app/api/relatorio/route";
import { buscarImplante } from "@/catalogo/catalogo";
import { consultar, fecharPools } from "@/db/pool";
import { criarPaciente, inserirSimulacao, inserirTepid, upsertImplante } from "@/db/repositorio";
import { ProvedorMock } from "@/llm/mock";
import { gerarRelatorioDoPedido } from "@/llm/servicoRelatorio";
import { contarAuditoria, dbDisponivel } from "../helpers/banco";
import { extrairTextoPdf } from "../helpers/pdfTexto";

const post = (corpo: unknown) => new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const IMPLANTE = "motiva-rsd-300";
const DIGITADAS = {
  base_mm: { dir: 121, esq: 119 },
  apss_mm: { dir: 27, esq: 26 },
  pinca_polo_superior_mm: { dir: 23, esq: 22 },
  pinca_sulco_mm: { dir: 7, esq: 7 },
  n_imf_estirado_mm: { dir: 81, esq: 83 },
};
const DISTANCIAS = {
  ssn_n_dir: { euclidiana_mm: 212.34, geodesica_mm: 224.1 },
  ssn_n_esq: null,
  n_imf_dir: null,
  n_imf_esq: null,
  base_dir: null,
  base_esq: null,
  intermamilar: { euclidiana_mm: 190.2, geodesica_mm: 205.3 },
};
const VOLUMES = { dir: { valor_ml: 288.4, incerteza_ml: 43.3, metodo: "plano_base_elipse" }, esq: null };
const CALCULADOS = ["212,34", "212.34", "224,1", "190,2", "205,3", "288,4", "43,3"];

beforeEach(() => vi.stubEnv("LLM_MODO", "mock"));
afterEach(() => vi.unstubAllEnvs());
afterAll(fecharPools);

/** Paciente + malha + medida (com números calculados) + 2 simulações mostradas + TEPID digitado. */
async function cenario(desenhoMedida: "A" | "B" = "B") {
  const pac = await criarPaciente();
  const m = await consultar<{ id: string }>(
    "insert into malhas (paciente_id, malha_dir, formato_origem, unidade_origem, meta, sintetica) values ($1,$2,'obj','mm','{}'::jsonb,true) returning id",
    [pac.id, `pacientes/${pac.pseudonimo}/malhas/x`],
  );
  const malhaId = m.rows[0]!.id;
  const payload = { esquema: "medidas/1.0", malha_id: malhaId, desenho: desenhoMedida, distancias: DISTANCIAS, volumes: VOLUMES, medidas_digitadas: DIGITADAS };
  const md = await consultar<{ id: string }>("insert into medidas (malha_id, desenho, versao_software, payload) values ($1,$2,'0.0.1',$3) returning id", [malhaId, desenhoMedida, JSON.stringify(payload)]);
  const imp = buscarImplante(IMPLANTE)!;
  await upsertImplante(imp);
  for (const plano of ["dual_plane", "subglandular"] as const) {
    await inserirSimulacao({ malhaId, implanteId: IMPLANTE, plano, imf: "manter", lado: "ambos", versaoConfig: "1.1", naoCalibrado: true, previsto: null });
  }
  await inserirTepid({ pacienteId: pac.id, desenho: desenhoMedida, versaoConfig: "1.0", valores: DIGITADAS, alertas: [] });
  return { paciente: pac, malhaId, medidaId: md.rows[0]!.id, implante: imp };
}

async function linhasAuditoria(entidade: string, id: string) {
  return (await consultar<{ acao: string; detalhes: Record<string, unknown>; desenho: string }>("select acao, detalhes, desenho from auditoria where entidade = $1 and entidade_id = $2 order by id", [entidade, id])).rows;
}

describe.skipIf(!dbDisponivel())("POST /api/llm/anamnese (mock)", () => {
  it("texto livre → anamnese/1.0; texto bruto e PII não chegam ao banco; auditado", async () => {
    vi.stubEnv("DESENHO", "B");
    const { paciente } = await cenario();
    const texto = "Meu nome é Joana Prado, CPF 987.654.321-00, tel (65) 98888-7777. Deseja aumentar as mamas de forma natural. Não fuma. Tem um filho.";
    const r = await postAnamnese(post({ paciente_id: paciente.id, texto }));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.modo).toBe("mock");
    expect(j.anamnese.esquema).toBe("anamnese/1.0");
    expect(j.anamnese.texto_fonte_hash).toMatch(/^[a-f0-9]{64}$/);
    const row = (await consultar<{ anamnese: unknown }>("select anamnese from atendimentos where id = $1", [j.atendimento_id])).rows[0]!;
    const gravado = JSON.stringify(row.anamnese);
    for (const pii of ["Joana", "Prado", "987.654.321-00", "98888-7777"]) expect(gravado).not.toContain(pii);
    const aud = await linhasAuditoria("atendimentos", j.atendimento_id);
    expect(aud.map((a) => a.acao)).toEqual(["criou", "criou"]);
    expect(JSON.stringify(aud)).not.toMatch(/Joana|987\.654|Deseja aumentar/);
    // segunda anamnese no mesmo atendimento = 'alterou'
    const r2 = await postAnamnese(post({ paciente_id: paciente.id, atendimento_id: j.atendimento_id, texto: "Paciente tabagista." }));
    expect(r2.status).toBe(201);
    expect(await contarAuditoria("atendimentos", j.atendimento_id, "alterou")).toBe(1);
  });

  it("entrada inválida → 400; paciente inexistente → 404", async () => {
    expect((await postAnamnese(post({ paciente_id: "x", texto: "a" }))).status).toBe(400);
    expect((await postAnamnese(post({ paciente_id: "00000000-0000-4000-8000-000000000000", texto: "a" }))).status).toBe(404);
  });
});

describe.skipIf(!dbDisponivel())("relatório + PDF pelas rotas", () => {
  it("B: gera relatório (dados do banco), PDF, leitura e download — tudo auditado", async () => {
    vi.stubEnv("DESENHO", "B");
    const c = await cenario("B");
    const r = await postRelatorio(post({ paciente_id: c.paciente.id, malha_id: c.malhaId }));
    expect(r.status).toBe(201);
    const { relatorio } = await r.json();
    expect(relatorio.esquema).toBe("relatorio/1.0");
    expect(relatorio.prosa_origem).toBe("mock");
    expect(relatorio.verificacao.ok).toBe(true);
    expect(relatorio.simulacoes_mostradas).toHaveLength(2);
    expect(relatorio.dados_travados.implantes_mostrados.map((i: any) => i.plano)).toEqual(["dual_plane", "subglandular"]);
    expect(relatorio.secoes.filter((s: any) => s.calculado).map((s: any) => s.id)).toEqual(["distancias", "volumes"]);
    expect(await contarAuditoria("relatorios", relatorio.relatorio_id, "criou")).toBe(1);

    const lido = await getRelatorio(new Request("http://x"), { params: Promise.resolve({ id: relatorio.relatorio_id }) });
    expect(lido.status).toBe(200);
    expect((await lido.json()).relatorio.secoes).toEqual(relatorio.secoes);
    expect(await contarAuditoria("relatorios", relatorio.relatorio_id, "visualizou")).toBe(1);

    const p = await postPdf(post({ atendimento_id: relatorio.atendimento_id }));
    expect(p.status).toBe(201);
    const pj = await p.json();
    expect(pj.sha256).toMatch(/^[a-f0-9]{64}$/);
    const at = (await consultar<{ pdf_caminho: string; pdf_sha256: string }>("select pdf_caminho, pdf_sha256 from atendimentos where id = $1", [relatorio.atendimento_id])).rows[0]!;
    expect(at.pdf_caminho.startsWith("/")).toBe(false);
    expect(at.pdf_sha256).toBe(pj.sha256);

    const ctx = { params: Promise.resolve({ atendimentoId: relatorio.atendimento_id }) };
    const leitura = await getPdf(new Request(`http://x/api/pdf/${relatorio.atendimento_id}`), ctx);
    expect(leitura.status).toBe(200);
    expect(leitura.headers.get("content-type")).toBe("application/pdf");
    expect(leitura.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(leitura.headers.get("cache-control")).toBe("private, no-store");
    const download = await getPdf(new Request(`http://x/api/pdf/${relatorio.atendimento_id}?download=1`), { params: Promise.resolve({ atendimentoId: relatorio.atendimento_id }) });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="atendimento-P-[0-9A-HJ-NP-Z]{6}\.pdf"/);
    const { texto, links } = await extrairTextoPdf(new Uint8Array(await download.arrayBuffer()));
    expect(links).toBe(0);
    expect(texto).toContain("Ilustração, não previsão de resultado");
    expect(texto).toContain("ICP-Brasil");
    expect(texto).toContain("212,34 mm");

    const aud = await linhasAuditoria("arquivo", relatorio.atendimento_id);
    expect(aud.map((a) => a.acao)).toEqual(["criou", "visualizou", "exportou"]);
    expect(aud.map((a) => a.detalhes.modo)).toEqual([undefined, "leitura", "download"]);
    expect(JSON.stringify(aud)).not.toMatch(/\/tmp|\/home|DATA_DIR/);
  });

  it("A: relatório e PDF sem nenhum número calculado, mesmo com medida antiga que os tinha", async () => {
    vi.stubEnv("DESENHO", "A");
    const c = await cenario("B");
    const r = await postRelatorio(post({ paciente_id: c.paciente.id, malha_id: c.malhaId, medida_id: c.medidaId }));
    expect(r.status).toBe(201);
    const { relatorio } = await r.json();
    expect(relatorio.desenho).toBe("A");
    expect(relatorio.dados_travados.distancias).toBeNull();
    expect(relatorio.dados_travados.volumes).toBeNull();
    expect(relatorio.secoes.some((s: any) => s.calculado)).toBe(false);
    const s = JSON.stringify(relatorio);
    for (const calc of ["212.34", "224.1", "190.2", "288.4", "43.3", ...CALCULADOS]) expect(s).not.toContain(calc);
    await postPdf(post({ atendimento_id: relatorio.atendimento_id }));
    const pdf = await getPdf(new Request("http://x"), { params: Promise.resolve({ atendimentoId: relatorio.atendimento_id }) });
    const { texto } = await extrairTextoPdf(new Uint8Array(await pdf.arrayBuffer()));
    for (const calc of CALCULADOS) expect(texto).not.toContain(calc);
    expect(texto).toContain("direita 121 mm");
    expect(await contarAuditoria("arquivo", relatorio.atendimento_id)).toBe(2);
  });

  it("prosa alucinada (mock injetado) é recusada, substituída e a recusa vai à auditoria", async () => {
    const c = await cenario("B");
    const rel = await gerarRelatorioDoPedido(
      { pacienteId: c.paciente.id, malhaId: c.malhaId },
      "B",
      new ProvedorMock({ prosa: { o_que_foi_simulado: "O implante de trezentos e vinte mililitros dará 45,5 mm de projeção." } }),
    );
    expect(rel.prosa_origem).toBe("mock_substituto");
    expect(rel.prosa_rejeitada?.intrusos).toEqual(["45,5", "trezentos e vinte"]);
    const aud = await linhasAuditoria("relatorios", rel.relatorio_id);
    expect(aud.map((a) => a.acao)).toEqual(["criou", "alterou"]);
    expect(aud[1]!.detalhes).toMatchObject({ evento: "prosa_llm_rejeitada", motivo: "numero_fora_da_lista", intrusos: ["45,5", "trezentos e vinte"] });
    const row = (await consultar<{ prosa_origem: string; numeros_ok: boolean }>("select prosa_origem, numeros_ok from relatorios where id = $1", [rel.relatorio_id])).rows[0]!;
    expect(row).toEqual({ prosa_origem: "mock_substituto", numeros_ok: true });
  });

  it("guardas: PDF sem relatório → 409; desenho divergente → 409; atendimento de outro paciente → 422", async () => {
    vi.stubEnv("DESENHO", "B");
    const c = await cenario();
    const an = await (await postAnamnese(post({ paciente_id: c.paciente.id, texto: "Deseja aumento discreto." }))).json();
    expect((await postPdf(post({ atendimento_id: an.atendimento_id }))).status).toBe(409);
    const outro = await criarPaciente();
    const r = await postRelatorio(post({ paciente_id: outro.id, atendimento_id: an.atendimento_id }));
    expect(r.status).toBe(422);
    vi.stubEnv("DESENHO", "A");
    expect((await postRelatorio(post({ paciente_id: c.paciente.id, atendimento_id: an.atendimento_id }))).status).toBe(409);
    expect((await getPdf(new Request("http://x"), { params: Promise.resolve({ atendimentoId: an.atendimento_id }) })).status).toBe(409);
  });

  it("PDF adulterado em disco → 500 (SHA-256 não confere) e nada é servido", async () => {
    vi.stubEnv("DESENHO", "B");
    const c = await cenario();
    const { relatorio } = await (await postRelatorio(post({ paciente_id: c.paciente.id, malha_id: c.malhaId }))).json();
    await postPdf(post({ atendimento_id: relatorio.atendimento_id }));
    await consultar("update atendimentos set pdf_sha256 = $2 where id = $1", [relatorio.atendimento_id, "0".repeat(64)]);
    const r = await getPdf(new Request("http://x"), { params: Promise.resolve({ atendimentoId: relatorio.atendimento_id }) });
    expect(r.status).toBe(500);
    expect((await r.json()).erro.codigo).toBe("pdf_corrompido");
  });
});
