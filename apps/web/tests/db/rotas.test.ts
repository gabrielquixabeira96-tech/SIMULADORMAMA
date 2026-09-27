/**
 * Rotas do Next.js contra o banco de teste + mock HTTP do services/mesh (MSW): upload,
 * leitura auditada de malha/arquivo, calibração, gravação de medidas em A e B e TEPID.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getMalha } from "@/app/api/malhas/[id]/route";
import { GET as getArquivo } from "@/app/api/malhas/[id]/arquivo/route";
import { POST as postReescalar } from "@/app/api/malhas/[id]/reescalar/route";
import { POST as postMalha } from "@/app/api/malhas/route";
import { GET as getMedida } from "@/app/api/medidas/[id]/route";
import { POST as postMedidas } from "@/app/api/medidas/route";
import { POST as postPaciente } from "@/app/api/pacientes/route";
import { POST as postTepid } from "@/app/api/tepid/route";
import { POST as postImportar } from "@/app/api/sinteticos/[nome]/importar/route";
import { caminhoEmDataDir } from "@/config/ambiente";
import { carregarTepidConfig } from "@/config/arquivosConfig";
import { consultar, fecharPools } from "@/db/pool";
import { contarAuditoria, dbDisponivel } from "../helpers/banco";
import { chamadas, iniciarMockMesh, pararMockMesh, resetarMockMesh, simularIndisponivel } from "../helpers/meshMock";

beforeAll(iniciarMockMesh);
afterEach(() => {
  resetarMockMesh();
  vi.unstubAllEnvs();
  vi.stubEnv("DESENHO", "B");
});
afterAll(async () => {
  pararMockMesh();
  await fecharPools();
});

const json = (corpo: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

// Tetraedro sintético mínimo (não é dado de paciente).
const OBJ = "v 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n";

async function novoPaciente(): Promise<{ id: string; pseudonimo: string }> {
  const r = await postPaciente();
  expect(r.status).toBe(201);
  return r.json();
}

async function novaMalha(pacienteId: string, nomeArquivo = "Exportacao Fulana.obj") {
  const fd = new FormData();
  fd.set("paciente_id", pacienteId);
  fd.set("unidade_origem", "mm");
  fd.append("arquivos", new File([OBJ], nomeArquivo));
  fd.append("arquivos", new File(["newmtl a\n"], "scan.mtl"));
  const r = await postMalha(new Request("http://x/api/malhas", { method: "POST", body: fd }));
  return r;
}

function valoresValidos() {
  const c = carregarTepidConfig();
  return Object.fromEntries(Object.entries(c.campos).map(([k, d]) => [k, { dir: (d.min + d.max) / 2, esq: (d.min + d.max) / 2 }]));
}

const lm = (x: number, y: number, z: number, v: number) => ({ posicao: [x, y, z], vertice: v, origem: "clique" });
const LANDMARKS = {
  furcula: lm(0, 0, 0, 0),
  mamilo_dir: lm(-95, -190, 90, 1),
  mamilo_esq: lm(95, -190, 90, 2),
  sulco_dir: lm(-95, -260, 60, 3),
  sulco_esq: lm(95, -260, 60, 1),
  linha_media_inferior: lm(0, -260, 40, 2),
};

describe.skipIf(!dbDisponivel())("rotas com banco + mock do services/mesh", () => {
  it("POST /api/pacientes cria só id + pseudônimo e audita", async () => {
    const p = await novoPaciente();
    expect(Object.keys(p).sort()).toEqual(["criado_em", "id", "pseudonimo"]);
    expect(await contarAuditoria("pacientes", p.id, "criou")).toBe(1);
  });

  it("upload → /processar → malha registrada, original em DATA_DIR, auditoria 'criou'", async () => {
    const p = await novoPaciente();
    const r = await novaMalha(p.id);
    expect(r.status).toBe(201);
    const j = await r.json();
    const proc = chamadas.find((c) => c.rota === "/processar")!;
    expect(proc.desenho).toBe("B");
    expect(proc.corpo.malha_dir).toBe(`pacientes/${p.pseudonimo}/malhas/${j.malha_id}`);
    expect(proc.corpo.arquivo_original).toBe("original/scan.obj"); // renomeado: nome de exportação não vaza
    expect(proc.corpo.decimacao).toEqual({ alvo_vertices: 40000, min_vertices: 30000, max_vertices: 50000 });
    expect(existsSync(caminhoEmDataDir(`${proc.corpo.malha_dir}/original/scan.obj`))).toBe(true);
    expect(existsSync(caminhoEmDataDir(`${proc.corpo.malha_dir}/original/scan.mtl`))).toBe(true);
    const linha = await consultar("select formato_origem, unidade_origem, sintetica, meta->>'esquema' as esquema from malhas where id = $1", [j.malha_id]);
    expect(linha.rows[0]).toMatchObject({ formato_origem: "obj", unidade_origem: "mm", sintetica: false, esquema: "malha_meta/1.0" });
    expect(await contarAuditoria("malhas", j.malha_id, "criou")).toBe(1);
    const meta = JSON.stringify((await consultar("select meta from malhas where id = $1", [j.malha_id])).rows[0]);
    expect(meta).not.toContain("Fulana");
  });

  it("upload com serviço fora do ar → 503 e nada fica gravado", async () => {
    const p = await novoPaciente();
    simularIndisponivel(true);
    const r = await novaMalha(p.id);
    expect(r.status).toBe(503);
    const n = await consultar<{ n: string }>("select count(*)::text n from malhas where paciente_id = $1", [p.id]);
    expect(n.rows[0]!.n).toBe("0");
    expect(existsSync(caminhoEmDataDir(`pacientes/${p.pseudonimo}/malhas`)) ? readdirVazio(`pacientes/${p.pseudonimo}/malhas`) : true).toBe(true);
  });

  it("GET malha e GET arquivo auditam 'visualizou'; nome fora da lista → 400", async () => {
    const p = await novoPaciente();
    const { malha_id } = await (await novaMalha(p.id)).json();
    const m = await getMalha(new Request(`http://x/api/malhas/${malha_id}`), params({ id: malha_id }));
    expect(m.status).toBe(200);
    expect(await contarAuditoria("malhas", malha_id, "visualizou")).toBe(1);

    const glb = caminhoEmDataDir(`pacientes/${p.pseudonimo}/malhas/${malha_id}/processada.glb`);
    await writeFile(glb, new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
    const a = await getArquivo(new Request(`http://x/api/malhas/${malha_id}/arquivo?nome=processada.glb`), params({ id: malha_id }));
    expect(a.status).toBe(200);
    expect(a.headers.get("cache-control")).toBe("private, no-store");
    expect(a.headers.get("content-type")).toBe("model/gltf-binary");
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
    expect(await contarAuditoria("arquivo", malha_id, "visualizou")).toBe(1);

    for (const nome of ["original/scan.obj", "../meta.json", "processada.obj"]) {
      const r = await getArquivo(new Request(`http://x/api/malhas/${malha_id}/arquivo?nome=${encodeURIComponent(nome)}`), params({ id: malha_id }));
      expect(r.status).toBe(400);
    }
    expect(await contarAuditoria("arquivo", malha_id, "visualizou")).toBe(1);
  });

  it("calibração: fator = régua / |p2 − p1| → /reescalar, meta atualizada e auditoria 'alterou'", async () => {
    const p = await novoPaciente();
    const { malha_id } = await (await novaMalha(p.id)).json();
    const r = await postReescalar(new Request("http://x", json({ regua_mm: 100, pontos: [[0, 0, 0], [0, 0.1, 0]] })), params({ id: malha_id }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.fator).toBeCloseTo(1000, 6);
    expect(chamadas.find((c) => c.rota === "/reescalar")!.corpo.fator).toBeCloseTo(1000, 6);
    const linha = await consultar<{ fator_escala_acumulado: number }>("select fator_escala_acumulado from malhas where id = $1", [malha_id]);
    expect(linha.rows[0]!.fator_escala_acumulado).toBeCloseTo(1000, 6);
    expect(await contarAuditoria("malhas", malha_id, "alterou")).toBe(1);
    // pontos coincidentes → 400
    const ruim = await postReescalar(new Request("http://x", json({ regua_mm: 100, pontos: [[1, 1, 1], [1, 1, 1]] })), params({ id: malha_id }));
    expect(ruim.status).toBe(400);
  });

  it("B: POST /api/medidas chama /medir (incluir_volume=true), grava distâncias+volumes, arquivo JSON e auditoria", async () => {
    const p = await novoPaciente();
    const { malha_id } = await (await novaMalha(p.id)).json();
    chamadas.length = 0;
    const r = await postMedidas(new Request("http://x", json({ malha_id, landmarks: LANDMARKS, medidas_digitadas: valoresValidos() })));
    expect(r.status).toBe(201);
    const reg = await r.json();
    expect(reg.desenho).toBe("B");
    expect(reg.distancias.intermamilar.euclidiana_mm).toBe(190);
    expect(reg.distancias.intermamilar.geodesica_mm).toBeGreaterThan(190);
    expect(reg.volumes.dir.incerteza_ml).toBeGreaterThan(0);
    const medir = chamadas.filter((c) => c.rota === "/medir");
    expect(medir).toHaveLength(1);
    expect(medir[0]!.desenho).toBe("B");
    expect(medir[0]!.corpo.incluir_volume).toBe(true);
    const arq = caminhoEmDataDir(`pacientes/${p.pseudonimo}/medidas/${reg.medida_id}.json`);
    expect(JSON.parse(readFileSync(arq, "utf8")).medida_id).toBe(reg.medida_id);
    expect(await contarAuditoria("medidas", reg.medida_id, "criou")).toBe(1);

    const g = await getMedida(new Request("http://x"), params({ id: reg.medida_id }));
    expect((await g.json()).distancias).not.toBeNull();
    expect(await contarAuditoria("medidas", reg.medida_id, "visualizou")).toBe(1);
  });

  it("B sem services/mesh → 503 e nada é gravado (ADR 0011)", async () => {
    const p = await novoPaciente();
    const { malha_id } = await (await novaMalha(p.id)).json();
    simularIndisponivel(true);
    const r = await postMedidas(new Request("http://x", json({ malha_id, landmarks: LANDMARKS })));
    expect(r.status).toBe(503);
    const n = await consultar<{ n: string }>("select count(*)::text n from medidas where malha_id = $1", [malha_id]);
    expect(n.rows[0]!.n).toBe("0");
  });

  it("A: POST /api/medidas NÃO chama /medir e grava distancias=null, volumes=null", async () => {
    const p = await novoPaciente();
    const { malha_id } = await (await novaMalha(p.id)).json();
    vi.stubEnv("DESENHO", "A");
    chamadas.length = 0;
    const semDigitadas = await postMedidas(new Request("http://x", json({ malha_id, landmarks: LANDMARKS })));
    expect(semDigitadas.status).toBe(400);
    const r = await postMedidas(new Request("http://x", json({ malha_id, landmarks: LANDMARKS, medidas_digitadas: valoresValidos() })));
    expect(r.status).toBe(201);
    const reg = await r.json();
    expect(reg.desenho).toBe("A");
    expect(reg.distancias).toBeNull();
    expect(reg.volumes).toBeNull();
    expect(chamadas.filter((c) => c.rota === "/medir")).toHaveLength(0);
    const linha = await consultar<{ desenho: string; payload: { distancias: unknown } }>("select desenho, payload from medidas where id = $1", [reg.medida_id]);
    expect(linha.rows[0]!.desenho).toBe("A");
    expect(linha.rows[0]!.payload.distancias).toBeNull();
    const aud = await consultar<{ desenho: string }>("select desenho from auditoria where entidade = 'medidas' and entidade_id = $1", [reg.medida_id]);
    expect(aud.rows.map((x) => x.desenho)).toEqual(["A"]);
  });

  it("A: registro gravado em B é lido com números calculados redigidos", async () => {
    const p = await novoPaciente();
    const { malha_id } = await (await novaMalha(p.id)).json();
    const reg = await (await postMedidas(new Request("http://x", json({ malha_id, landmarks: LANDMARKS })))).json();
    vi.stubEnv("DESENHO", "A");
    const j = await (await getMedida(new Request("http://x"), params({ id: reg.medida_id }))).json();
    expect(j.distancias).toBeNull();
    expect(j.volumes).toBeNull();
    expect(j.redigido_no_desenho_a).toBe(true);
  });

  it("TEPID: B grava alertas; A grava alertas=[] (coluna desenho correta)", async () => {
    const c = carregarTepidConfig();
    const regra = c.regras.find((x) => x.operador === "<")!;
    const valores = valoresValidos();
    valores[regra.campo] = { dir: (regra.limiar_mm as number) - 1, esq: (regra.limiar_mm as number) - 1 };
    const p = await novoPaciente();
    const rb = await (await postTepid(new Request("http://x", json({ paciente_id: p.id, valores })))).json();
    expect(rb.alertas.length).toBeGreaterThan(0);
    vi.stubEnv("DESENHO", "A");
    const ra = await (await postTepid(new Request("http://x", json({ paciente_id: p.id, valores })))).json();
    expect(ra.alertas).toEqual([]);
    const linhas = await consultar<{ desenho: string; alertas: unknown[] }>("select desenho, alertas from tepid where paciente_id = $1 order by criado_em", [p.id]);
    expect(linhas.rows.map((x) => [x.desenho, x.alertas.length > 0])).toEqual([
      ["B", true],
      ["A", false],
    ]);
    expect(await contarAuditoria("tepid", ra.id, "criou")).toBe(1);
  });

  it("importar torso sintético: mesmo caminho do upload (sintetica=true); gabarito sem distâncias em A", async () => {
    const dir = caminhoEmDataDir("sinteticos/tx_teste");
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/torso.obj`, OBJ);
    writeFileSync(
      `${dir}/gabarito.json`,
      JSON.stringify({ esquema: "gabarito/1.0", landmarks: { furcula: { posicao: [0, 0, 0], vertice: 0 } }, distancias: { intermamilar: { euclidiana_mm: 190, geodesica_mm: 205 } } }),
    );
    const p = await novoPaciente();
    const rb = await postImportar(new Request("http://x", json({ paciente_id: p.id })), params({ nome: "tx_teste" }));
    const jb = await rb.json();
    expect(rb.status, JSON.stringify(jb)).toBe(201);
    expect(jb.gabarito.distancias.intermamilar.euclidiana_mm).toBe(190);
    expect(chamadas.find((c) => c.rota === "/processar")!.corpo.unidade_origem).toBe("mm");
    const linha = await consultar<{ sintetica: boolean }>("select sintetica from malhas where id = $1", [jb.malha_id]);
    expect(linha.rows[0]!.sintetica).toBe(true);
    const aud = await consultar<{ detalhes: { origem: string } }>("select detalhes from auditoria where entidade = 'malhas' and entidade_id = $1", [jb.malha_id]);
    expect(aud.rows[0]!.detalhes.origem).toBe("sintetico");
    vi.stubEnv("DESENHO", "A");
    const ja = await (await postImportar(new Request("http://x", json({ paciente_id: p.id })), params({ nome: "tx_teste" }))).json();
    expect(ja.gabarito.distancias).toBeNull();
    expect(ja.gabarito.landmarks.furcula.posicao).toEqual([0, 0, 0]);
    const inexistente = await postImportar(new Request("http://x", json({ paciente_id: p.id })), params({ nome: "nao_existe" }));
    expect(inexistente.status).toBe(404);
    const ruim = await postImportar(new Request("http://x", json({ paciente_id: p.id })), params({ nome: "../x" }));
    expect(ruim.status).toBe(400);
  });
});

function readdirVazio(rel: string): boolean {
  return readdirSync(caminhoEmDataDir(rel)).length === 0;
}

/** Revisão v0.1.1, item 8: o flag `sintetica` não vem do cliente; scan real nunca pula a régua. */
describe.skipIf(!dbDisponivel())("sintetica é decidido no servidor", () => {
  it("upload com sintetica=true do cliente → gravado false; GET da malha e escala do registro tratam como scan real", async () => {
    const p = await novoPaciente();
    const fd = new FormData();
    fd.set("paciente_id", p.id);
    fd.set("unidade_origem", "mm");
    fd.set("sintetica", "true");
    fd.append("arquivos", new File([OBJ], "scan.obj"));
    const r = await postMalha(new Request("http://x/api/malhas", { method: "POST", body: fd }));
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(201);
    const linha = await consultar<{ sintetica: boolean }>("select sintetica from malhas where id = $1", [j.malha_id]);
    expect(linha.rows[0]!.sintetica).toBe(false);
    const aud = await consultar<{ detalhes: { sintetica: boolean; origem: string } }>("select detalhes from auditoria where entidade = 'malhas' and entidade_id = $1", [j.malha_id]);
    expect(aud.rows[0]!.detalhes).toMatchObject({ sintetica: false, origem: "upload" });
    const g = await (await getMalha(new Request("http://x"), params({ id: j.malha_id }))).json();
    expect(g.sintetica).toBe(false);
    // sem régua, o registro de medidas marca escala "nenhuma" (não "gabarito", que só vale para sintético)
    const m = await postMedidas(new Request("http://x", json({ malha_id: j.malha_id, landmarks: LANDMARKS })));
    const jm = await m.json();
    expect(m.status, JSON.stringify(jm)).toBe(201);
    expect(jm.escala.metodo).toBe("nenhuma");
  });
});
