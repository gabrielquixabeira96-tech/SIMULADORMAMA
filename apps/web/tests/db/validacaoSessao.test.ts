/**
 * Sessão de Bland-Altman com operador humano e planilha do art. 5º (ADR 0017), pelas rotas, com
 * banco de teste + mock do services/mesh (MSW). Foco: a API NÃO vaza o gabarito (nem o torso, nem
 * as distâncias medidas) antes do encerramento; ordem e imutabilidade dos itens; resultado; planilha
 * sem dado identificável; auditoria; desenho A desliga tudo antes de tocar banco ou rede.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DISTANCIAS, LANDMARK_IDS, type DistanciaId } from "@simulador/contratos";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getPlanilha } from "@/app/api/validacao/planilha/route";
import { GET as getSessao } from "@/app/api/validacao/sessoes/[id]/route";
import { POST as postCancelar } from "@/app/api/validacao/sessoes/[id]/cancelar/route";
import { POST as postEncerrar } from "@/app/api/validacao/sessoes/[id]/encerrar/route";
import { POST as postItem } from "@/app/api/validacao/sessoes/[id]/itens/[indice]/route";
import { GET as getMalhaItem } from "@/app/api/validacao/sessoes/[id]/itens/[indice]/malha/route";
import { GET as listarSessoes, POST as postSessao } from "@/app/api/validacao/sessoes/route";
import { GET as getArquivoSintetico } from "@/app/api/sinteticos/[nome]/[arquivo]/route";
import { POST as postImportar } from "@/app/api/sinteticos/[nome]/importar/route";
import { POST as postPaciente } from "@/app/api/pacientes/route";
import { caminhoEmDataDir, dataDir } from "@/config/ambiente";
import { malhaDirDoTorso } from "@/validacao/scans";
import { consultar, fecharPools } from "@/db/pool";
import { distanciasEuclidianas } from "@/medidas/geometria";
import { contarAuditoria, dbDisponivel } from "../helpers/banco";
import { chamadas, iniciarMockMesh, pararMockMesh, resetarMockMesh } from "../helpers/meshMock";

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

const post = (corpo: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const get = (url = "http://x/api") => new Request(url);
const p = <T extends Record<string, string>>(x: T) => ({ params: Promise.resolve(x) });

// ------------------------------------------------------------------ fixtures (torsos sintéticos mínimos)

const lm = (x: number, y: number, z: number) => ({ posicao: [x, y, z] as [number, number, number], vertice: 0, origem: "clique" as const });
const LANDMARKS = {
  furcula: lm(0, 0, 0),
  mamilo_dir: lm(-95.3, -190.1, 90.2),
  mamilo_esq: lm(95.4, -191.2, 89.7),
  sulco_dir: lm(-95.1, -262.3, 60.5),
  sulco_esq: lm(96, -260.8, 61.1),
  linha_media_inferior: lm(0, -260, 40),
  base_medial_dir: lm(-40.2, -190, 70),
  base_lateral_dir: lm(-160.7, -192, 40),
  base_medial_esq: lm(41, -189, 70.3),
  base_lateral_esq: lm(158.9, -191, 41.2),
};
const r2 = (v: number) => Math.round(v * 100) / 100;
// O mock do /medir devolve euclidiana e geodésica = round2(1,05·e). Gabarito = medido − 0,5 mm.
const EUCLID = distanciasEuclidianas(LANDMARKS) as Record<DistanciaId, number>;
const DESVIO = 0.5;
const gabarito = (nome: string) => ({
  esquema: "gabarito/1.0",
  nome,
  landmarks: Object.fromEntries(LANDMARK_IDS.map((id) => [id, { posicao: LANDMARKS[id].posicao }])),
  distancias: Object.fromEntries(
    (Object.keys(DISTANCIAS) as DistanciaId[]).map((d) => [d, { euclidiana_mm: r2(EUCLID[d] - DESVIO), geodesica_mm: r2(r2(EUCLID[d] * 1.05) - DESVIO) }]),
  ),
});
const TORSOS = ["tx_alfa", "tx_beta", "tx_gama"];
const OBJ = "v 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n";

function criarTorsos() {
  for (const t of TORSOS) {
    const d = caminhoEmDataDir(`sinteticos/${t}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "torso.obj"), OBJ);
    writeFileSync(join(d, "gabarito.json"), JSON.stringify(gabarito(t)));
  }
}

/** Números que NÃO podem aparecer em nenhuma resposta antes do encerramento. */
const numerosProibidos = () => {
  const g = gabarito("x").distancias as Record<string, { euclidiana_mm: number; geodesica_mm: number }>;
  const out = new Set<string>();
  for (const d of Object.keys(g)) {
    out.add(String(g[d]!.euclidiana_mm));
    out.add(String(g[d]!.geodesica_mm));
    out.add(String(EUCLID[d as DistanciaId]));
    out.add(String(r2(EUCLID[d as DistanciaId] * 1.05)));
  }
  return [...out];
};

function semVazamento(texto: string) {
  expect(texto).not.toMatch(/tx_alfa|tx_beta|tx_gama|gabarito|distancias|euclidiana|geodesica|referencia|resultado|posicao|validacao\/malhas/);
  for (const n of numerosProibidos()) expect(texto, `número ${n} vazou`).not.toContain(n);
}

describe.skipIf(!dbDisponivel())("sessão de Bland-Altman (rotas + banco + mock do mesh)", () => {
  beforeAll(criarTorsos);

  it("sessão completa: cega até o encerramento, ordem imposta, resultado e planilha", async () => {
    // ---- abrir
    const rCria = await postSessao(post({ operador: "op-07", repeticoes: 2, torsos: ["tx_alfa", "tx_beta"], semente: 42 }));
    expect(rCria.status).toBe(201);
    const txtCria = await rCria.text();
    semVazamento(txtCria);
    const s = JSON.parse(txtCria);
    expect(s).toMatchObject({ estado: "aberta", operador: "OP-07", tipo_operador: "humano", repeticoes: 2, proximo_indice: 0 });
    expect(s.itens).toHaveLength(4);
    expect(s.itens.every((i: any) => /^S-[0-9A-HJ-NP-Z]{4}$/.test(i.scan_id))).toBe(true);
    expect(await contarAuditoria("validacao_sessoes", s.id, "criou")).toBe(1);
    const id = s.id as string;

    // ---- o gabarito fica oculto nas rotas dos torsos da sessão (e só neles)
    const gOculto = await getArquivoSintetico(get(), p({ nome: "tx_alfa", arquivo: "gabarito.json" }));
    expect(gOculto.status).toBe(403);
    expect((await gOculto.json()).erro.codigo).toBe("gabarito_oculto_sessao_aberta");
    expect((await getArquivoSintetico(get(), p({ nome: "tx_gama", arquivo: "gabarito.json" }))).status).toBe(200);
    const pac = await (await postPaciente()).json();
    const imp = await postImportar(post({ paciente_id: pac.id }), p({ nome: "tx_beta" }));
    expect(imp.status).toBe(201);
    expect((await imp.json()).gabarito).toBeNull();
    resetarMockMesh();

    // ---- malha do item: preparada uma vez por torso, fora de pacientes/, sem o nome do torso no endereço
    expect((await getMalhaItem(get(), p({ id, indice: "0" }))).status).toBe(404); // o mock não grava o .glb
    const sessaoDisco = JSON.parse(readFileSync(caminhoEmDataDir(`validacao/sessoes/${id}.json`), "utf8"));
    const torso0 = sessaoDisco.scans.find((x: any) => x.scan_id === s.itens[0].scan_id).torso as string;
    writeFileSync(caminhoEmDataDir(`${malhaDirDoTorso(torso0)}/processada.glb`), Buffer.from("glTF-falso"));
    const glb = await getMalhaItem(get(), p({ id, indice: "0" }));
    expect(glb.status).toBe(200);
    expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
    expect(chamadas.filter((c) => c.rota === "/processar")).toHaveLength(1);
    expect(chamadas[0]!.corpo).toMatchObject({ malha_dir: malhaDirDoTorso(torso0), unidade_origem: "mm" });
    expect(malhaDirDoTorso(torso0)).toMatch(/^validacao\/malhas\/[0-9a-f-]{36}$/);

    // ---- ordem e validação da marcação
    const fora = await postItem(post({ landmarks: LANDMARKS }), p({ id, indice: "1" }));
    expect(fora.status).toBe(409);
    expect((await fora.json()).erro.codigo).toBe("fora_de_ordem");
    const { base_lateral_esq: _b, ...incompletos } = LANDMARKS;
    void _b;
    expect((await postItem(post({ landmarks: incompletos }), p({ id, indice: "0" }))).status).toBe(422);
    const doGabarito = { ...LANDMARKS, furcula: { ...LANDMARKS.furcula, origem: "gabarito" } };
    expect((await postItem(post({ landmarks: doGabarito }), p({ id, indice: "0" }))).status).toBe(422);
    const encCedo = await postEncerrar(post({}), p({ id }));
    expect(encCedo.status).toBe(409);
    expect((await encCedo.json()).erro.codigo).toBe("sessao_incompleta");

    // ---- marcar os 4 itens: nenhuma resposta traz número medido ou do gabarito
    for (let i = 0; i < 4; i++) {
      const r = await postItem(post({ landmarks: LANDMARKS }), p({ id, indice: String(i) }));
      expect(r.status).toBe(200);
      const txt = await r.text();
      semVazamento(txt);
      expect(JSON.parse(txt).itens[i].concluido).toBe(true);
    }
    const medir = chamadas.filter((c) => c.rota === "/medir");
    expect(medir).toHaveLength(4);
    expect(medir.every((c) => c.desenho === "B" && c.corpo.malha_dir.startsWith("validacao/malhas/"))).toBe(true);
    const repetido = await postItem(post({ landmarks: LANDMARKS }), p({ id, indice: "0" }));
    expect(repetido.status).toBe(409);
    expect((await repetido.json()).erro.codigo).toBe("item_ja_registrado");
    const lida = await getSessao(get(), p({ id }));
    const txtLida = await lida.text();
    semVazamento(txtLida);
    expect(JSON.parse(txtLida).proximo_indice).toBeNull();
    expect(await contarAuditoria("validacao_sessoes", id, "alterou")).toBe(4);

    // ---- encerrar: resultado com o gabarito revelado
    const enc = await postEncerrar(post({ observacoes: "sessão de teste automatizado" }), p({ id }));
    expect(enc.status).toBe(200);
    const fechada = await enc.json();
    expect(fechada.estado).toBe("encerrada");
    expect(fechada.scans.map((x: any) => x.torso).sort()).toEqual(["tx_alfa", "tx_beta"]);
    const r = fechada.resultado;
    expect(r.criterios).toMatchObject({ n_pares: 56, n_pares_min_30: true, n_imf_relatado_a_parte: true, scans_distintos: 2, vale_para_fase1: false });
    expect(r.geral).toMatchObject({ n: 56, vies_mm: DESVIO, dp_mm: 0, loa_inferior_mm: DESVIO, loa_superior_mm: DESVIO, dentro_de_2mm: true, dentro_de_3mm: true });
    expect(r.n_imf.n).toBe(16);
    expect(r.sem_n_imf.n).toBe(40);
    expect(r.intra_operador).toMatchObject({ n_grupos: 28, dp_intra_mm: 0, coeficiente_repetibilidade_mm: 0 });
    // gravado em DATA_DIR/validacao (fora de pacientes/)
    expect(existsSync(caminhoEmDataDir(`validacao/sessoes/${id}.json`))).toBe(true);
    expect(JSON.parse(readFileSync(caminhoEmDataDir(`validacao/sessoes/${id}.json`), "utf8")).estado).toBe("encerrada");
    // o gabarito volta a ser servido; nova tentativa de encerrar é recusada
    expect((await getArquivoSintetico(get(), p({ nome: "tx_alfa", arquivo: "gabarito.json" }))).status).toBe(200);
    expect((await postEncerrar(post({}), p({ id }))).status).toBe(409);

    // ---- planilha CSV: cabeçalho exato; linhas dos registros versionados + desta sessão; nada identificável
    const antes = await consultar<{ n: string }>("select count(*)::text as n from auditoria where entidade = 'validacao_planilha' and acao = 'exportou'");
    const csvResp = await getPlanilha(get("http://x/api/validacao/planilha?formato=csv"));
    expect(csvResp.status).toBe(200);
    expect(csvResp.headers.get("content-type")).toContain("text/csv");
    expect(csvResp.headers.get("content-disposition")).toMatch(/attachment; filename="planilha-art5-v\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = (await csvResp.text()).replace(/^﻿/, "");
    const linhas = csv.trim().split("\r\n");
    expect(linhas[0]).toBe(
      "versao_software,data,fonte,registro,commit,desenho,operador,tipo_operador,scan_id,sintetico,repeticao,medida,tipo_distancia,n_imf,referencia_mm,medido_mm,desvio_mm,observacoes",
    );
    const daSessao = linhas.filter((l) => l.includes(`sessao:${id}`));
    expect(daSessao).toHaveLength(56);
    expect(daSessao.every((l) => l.includes(",OP-07,humano,sintetico:tx_") && l.includes(`,${DESVIO},`))).toBe(true);
    expect(daSessao.filter((l) => l.includes(",n_imf_")).length).toBe(16);
    // registros versionados do e2e (operador simulado) entram também
    expect(linhas.some((l) => l.includes("registro_e2e,v0.1.1-web-marcos-0-1.json"))).toBe(true);
    expect(csv).not.toContain("@");
    expect(csv).not.toContain("/home/");
    expect(csv).not.toContain(dataDir());
    expect(csv).not.toMatch(/P-[0-9A-HJ-NP-Z]{6}/); // nenhum pseudônimo de paciente
    const depois = await consultar<{ n: string }>("select count(*)::text as n from auditoria where entidade = 'validacao_planilha' and acao = 'exportou'");
    expect(Number(depois.rows[0]!.n)).toBe(Number(antes.rows[0]!.n) + 1);

    // ---- JSON com resumo por grupo (N-IMF à parte)
    const js = await (await getPlanilha(get("http://x/api/validacao/planilha?formato=json"))).json();
    expect(js.esquema).toBe("planilha_validacao_art5/1.0");
    const grupo = js.resumo.find((g: any) => g.registro === `sessao:${id}`);
    expect(grupo).toMatchObject({ operador: "OP-07", tipo_operador: "humano", geral: { n: 56 }, n_imf: { n: 16 }, sem_n_imf: { n: 40 } });
    expect((await getPlanilha(get("http://x/api/validacao/planilha?formato=xls"))).status).toBe(400);
    const pv = await (await getPlanilha(get("http://x/api/validacao/planilha?separador=ponto-e-virgula"))).text();
    expect(pv.split("\r\n")[0]).toContain("versao_software;data;fonte");
  });

  it("cancelar: sessão fica sem resultado, continua cega e libera o gabarito", async () => {
    const s = await (await postSessao(post({ operador: "OP-08", torsos: ["tx_gama"] }))).json();
    expect((await getArquivoSintetico(get(), p({ nome: "tx_gama", arquivo: "gabarito.json" }))).status).toBe(403);
    const c = await postCancelar(post({}), p({ id: s.id }));
    expect(c.status).toBe(200);
    const txt = await c.text();
    semVazamento(txt);
    expect(JSON.parse(txt).estado).toBe("cancelada");
    expect((await getArquivoSintetico(get(), p({ nome: "tx_gama", arquivo: "gabarito.json" }))).status).toBe(200);
    expect((await postItem(post({ landmarks: LANDMARKS }), p({ id: s.id, indice: "0" }))).status).toBe(409);
    const lista = await (await listarSessoes()).json();
    expect(lista.sessoes.find((x: any) => x.id === s.id).estado).toBe("cancelada");
    // a planilha não inclui sessão cancelada
    const csv = await (await getPlanilha(get("http://x/api/validacao/planilha"))).text();
    expect(csv).not.toContain(`sessao:${s.id}`);
  });

  it("entradas inválidas: operador com nome, torso inexistente, id desconhecido", async () => {
    expect((await postSessao(post({ operador: "Maria Souza" }))).status).toBe(400);
    const inex = await postSessao(post({ operador: "OP-09", torsos: ["nao_existe"] }));
    expect(inex.status).toBe(422);
    expect((await inex.json()).erro.codigo).toBe("torso_inelegivel");
    expect((await getSessao(get(), p({ id: "00000000-0000-4000-8000-000000000000" }))).status).toBe(404);
    expect((await getSessao(get(), p({ id: "../../etc" }))).status).toBe(404);
  });
});

describe("DESENHO=A desliga a validação de medidas (ADR 0005/0017)", () => {
  it("todas as rotas → 403 desligado_no_desenho_a, sem tocar o services/mesh", async () => {
    vi.stubEnv("DESENHO", "A");
    const ID = "11111111-2222-4333-8444-555555555555";
    const respostas = [
      await postSessao(post({ operador: "OP-01" })),
      await listarSessoes(),
      await getSessao(get(), p({ id: ID })),
      await postItem(post({ landmarks: LANDMARKS }), p({ id: ID, indice: "0" })),
      await getMalhaItem(get(), p({ id: ID, indice: "0" })),
      await postEncerrar(post({}), p({ id: ID })),
      await postCancelar(post({}), p({ id: ID })),
      await getPlanilha(get("http://x/api/validacao/planilha")),
    ];
    for (const r of respostas) {
      expect(r.status).toBe(403);
      expect((await r.json()).erro).toMatchObject({ codigo: "desligado_no_desenho_a", detalhes: { recurso: "medicao_automatica_3d" } });
    }
    expect(chamadas).toHaveLength(0);
  });
});
