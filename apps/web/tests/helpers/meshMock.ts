/**
 * Mock do contrato HTTP do services/mesh (contratos §7) com MSW. Valida as REQUISIÇÕES contra
 * os esquemas zod do contrato (um erro aqui = o web violou o contrato) e responde no formato
 * do contrato. Registra cada chamada (rota, cabeçalho X-Desenho, corpo) para as asserções A/B.
 */
import {
  DISTANCIAS,
  medirRequisicaoSchema,
  morphsRequisicaoSchema,
  processarRequisicaoSchema,
  reescalarRequisicaoSchema,
  type DistanciaId,
  type MalhaMeta,
} from "@simulador/contratos";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const MESH = "http://mesh.mock:8765";

export interface ChamadaMesh {
  rota: string;
  desenho: string | null;
  corpo: any;
}

export const chamadas: ChamadaMesh[] = [];
let indisponivel = false;
const metas = new Map<string, MalhaMeta>();

export function simularIndisponivel(v: boolean) {
  indisponivel = v;
}

export function metaExemplo(malhaDir: string, extra: Partial<MalhaMeta> = {}): MalhaMeta {
  const malhaId = malhaDir.split("/").pop()!;
  return {
    esquema: "malha_meta/1.0",
    malha_id: malhaId,
    malha_dir: malhaDir,
    unidade_origem: "mm",
    unidade_inferida: null,
    fator_unidade: 1,
    fator_escala_acumulado: 1,
    quadro: "scan",
    original: { arquivo: "original/scan.obj", n_vertices: 4, n_faces: 4, sha256: "a".repeat(64), tem_textura: false },
    processada: { obj: "processada.obj", glb: "processada.glb", n_vertices: 4, n_faces: 4, sha256_glb: "b".repeat(64), caixa_mm: { min: [0, 0, 0], max: [100, 100, 100] } },
    recorte: { modo: "abaixo_do_pescoco", y_corte_mm: null, aplicado: false },
    avisos: ["malha com menos que min_vertices; não decimada"],
    versao_software: "0.0.1",
    gerado_em: "2026-09-26T14:00:00-04:00",
    ...extra,
  };
}

function erro(status: number, codigo: string, mensagem: string) {
  return HttpResponse.json({ erro: { codigo, mensagem, detalhes: {} } }, { status });
}

async function registrar(rota: string, request: Request) {
  const corpo = request.method === "POST" ? await request.json() : null;
  chamadas.push({ rota, desenho: request.headers.get("X-Desenho"), corpo });
  return corpo;
}

export const handlers = [
  http.get(`${MESH}/saude`, async ({ request }) => {
    await registrar("/saude", request);
    if (indisponivel) return HttpResponse.error();
    return HttpResponse.json({ status: "ok", versao_software: "0.0.1", contrato: "1.0", geodesica: { biblioteca: "pygeodesic", versao: "0.1.0" } });
  }),
  http.post(`${MESH}/processar`, async ({ request }) => {
    const corpo = await registrar("/processar", request);
    if (indisponivel) return HttpResponse.error();
    const r = processarRequisicaoSchema.safeParse(corpo);
    if (!r.success) return erro(422, "contrato_violado", r.error.message);
    const meta = metaExemplo(r.data.malha_dir, {
      unidade_origem: r.data.unidade_origem,
      original: { arquivo: r.data.arquivo_original, n_vertices: 4, n_faces: 4, sha256: "a".repeat(64), tem_textura: false },
      recorte: { modo: r.data.recorte.modo, y_corte_mm: null, aplicado: false },
    });
    metas.set(r.data.malha_dir, meta);
    return HttpResponse.json(meta);
  }),
  http.post(`${MESH}/reescalar`, async ({ request }) => {
    const corpo = await registrar("/reescalar", request);
    if (indisponivel) return HttpResponse.error();
    const r = reescalarRequisicaoSchema.safeParse(corpo);
    if (!r.success) return erro(422, "contrato_violado", r.error.message);
    const anterior = metas.get(r.data.malha_dir) ?? metaExemplo(r.data.malha_dir);
    const meta: MalhaMeta = {
      ...anterior,
      fator_escala_acumulado: anterior.fator_escala_acumulado * r.data.fator,
      escala: { historico: [...(anterior.escala?.historico ?? []), { fator: r.data.fator, regua: r.data.regua, aplicado_em: "2026-09-26T14:05:00-04:00" }] },
    };
    metas.set(r.data.malha_dir, meta);
    return HttpResponse.json(meta);
  }),
  http.post(`${MESH}/medir`, async ({ request }) => {
    const corpo = await registrar("/medir", request);
    if (indisponivel) return HttpResponse.error();
    const r = medirRequisicaoSchema.safeParse(corpo);
    if (!r.success) return erro(422, "contrato_violado", r.error.message);
    const lm = r.data.landmarks;
    const distancias = {} as Record<DistanciaId, { euclidiana_mm: number; geodesica_mm: number } | null>;
    for (const [id, [de, para]] of Object.entries(DISTANCIAS) as Array<[DistanciaId, readonly [keyof typeof lm, keyof typeof lm]]>) {
      const a = lm[de];
      const b = lm[para];
      if (!a || !b) {
        distancias[id] = null;
        continue;
      }
      const e = Math.round(Math.hypot(a.posicao[0] - b.posicao[0], a.posicao[1] - b.posicao[1], a.posicao[2] - b.posicao[2]) * 100) / 100;
      const web = r.data.distancias_euclidianas_web[id];
      if (web === undefined || Math.abs(web - e) > 0.01) return erro(422, "euclidiana_divergente", `${id}: web ${web} vs ${e}`);
      distancias[id] = { euclidiana_mm: e, geodesica_mm: Math.round(e * 1.05 * 100) / 100 };
    }
    const volumes = r.data.incluir_volume
      ? { dir: { valor_ml: 288.4, incerteza_ml: 43.3, metodo: "plano_base_elipse" as const }, esq: null }
      : null;
    return HttpResponse.json({ distancias, volumes, quadro_anatomico: null, geodesica: { algoritmo: "mmp", biblioteca: "pygeodesic", versao: "0.1.0" }, avisos: [] });
  }),
];

handlers.push(
  http.post(`${MESH}/morphs`, async ({ request }) => {
    const corpo = await registrar("/morphs", request);
    if (indisponivel) return HttpResponse.error();
    const r = morphsRequisicaoSchema.safeParse(corpo);
    if (!r.success) return erro(422, "contrato_violado", r.error.message);
    const previsto = { delta_projecao_mamilo_mm: { dir: 29.1, esq: 29.1 }, delta_y_sulco_mm: { dir: 0, esq: 0 }, delta_y_mamilo_mm: { dir: 3.4, esq: 3.4 } };
    const arquivos = r.data.planos.flatMap((plano) =>
      r.data.imfs.map((imf) => ({
        arquivo: `${plano}__${imf}.glb`,
        plano,
        imf,
        sha256: "c".repeat(64),
        targets: r.data.implantes.flatMap((id, k) =>
          (["ambos", "dir", "esq"] as const).map((lado, j) => ({ nome: `mt__${id}__${plano}__${imf}${lado === "ambos" ? "" : `__${lado}`}`, implante_id: id, lado, indice: k * 3 + j, previsto })),
        ),
      })),
    );
    return HttpResponse.json({
      esquema: "morphs/1.0",
      malha_id: r.data.malha_dir.split("/").pop(),
      sha256_malha_base: "d".repeat(64),
      versao_software: "0.0.1",
      versao_config_simulacao: JSON.parse(readFileSync(resolve(__dirname, "../../../../config/simulacao.json"), "utf8")).versao as string,
      nao_calibrado: true,
      gerado_em: "2026-09-26T14:10:00-04:00",
      lados: r.data.lados,
      arquivos,
    });
  }),
);

export const servidorMesh = setupServer(...handlers);

export function iniciarMockMesh() {
  servidorMesh.listen({ onUnhandledRequest: "error" });
}
export function resetarMockMesh() {
  chamadas.length = 0;
  indisponivel = false;
  servidorMesh.resetHandlers();
}
export function pararMockMesh() {
  servidorMesh.close();
}
