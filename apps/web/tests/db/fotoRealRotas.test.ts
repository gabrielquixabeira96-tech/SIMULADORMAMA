/**
 * Rotas da malha reconstruída de fotos (plano "foto → 3D", ADR 0021) contra o banco de teste + mock do
 * services/mesh (MSW), nas regras que valem no SERVIDOR (não só na tela):
 *  - sem foto de perfil, nenhum `previsto` sai nem é gravado, nem em B (/morphs, morphs/manifest.json,
 *    POST/GET /simulacoes); com perfil, sai como antes;
 *  - fotos (`original/foto_<vista>.*`) e `observado.png` só saem de malha reconstruída de fotos (um scan
 *    com uma textura chamada foto_frente.jpg → 400);
 *  - cegamento da sessão de Bland-Altman (ADR 0017): com sessão aberta/arquivo inválido, /foto-real não
 *    devolve o erro contra o gabarito e importar-foto não copia o avaliacao.json.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getArquivo } from "@/app/api/malhas/[id]/arquivo/route";
import { GET as getFotoReal } from "@/app/api/malhas/[id]/foto-real/route";
import { POST as postMorphs } from "@/app/api/malhas/[id]/morphs/route";
import { GET as getSimulacoes, POST as postSimulacao } from "@/app/api/malhas/[id]/simulacoes/route";
import { POST as postMalha } from "@/app/api/malhas/route";
import { POST as postPaciente } from "@/app/api/pacientes/route";
import { POST as postImportarFoto } from "@/app/api/sinteticos/[nome]/importar-foto/route";
import { caminhoEmDataDir } from "@/config/ambiente";
import { carregarConfigSimulacaoUI } from "@/config/arquivosConfig";
import { fecharPools } from "@/db/pool";
import { dbDisponivel } from "../helpers/banco";
import { iniciarMockMesh, pararMockMesh, resetarMockMesh } from "../helpers/meshMock";

beforeAll(iniciarMockMesh);
afterEach(() => {
  resetarMockMesh();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  pararMockMesh();
  await fecharPools();
});

const C1_FRENTE = JSON.parse(readFileSync(join(__dirname, "../fixtures/foto3d/reconstrucao_t01_frente.json"), "utf8"));
const R_PERFIL = [0, 0, -1, 0, -1, 0, -1, 0, 0]; // câmera olhando o flanco (rotação própria, coluna-major)
const C1_COM_PERFIL = { ...C1_FRENTE, fotos: [...C1_FRENTE.fotos, { ...C1_FRENTE.fotos[0], vista: "perfil_dir", arquivo: "original/foto_perfil_dir.png", R: R_PERFIL }] };
const AVALIACAO = { esquema: "avaliacao_reconstrucao/1.0", torso: "tx_foto", rms_mm: { x: 0.3, y: 0.2, z: 0.3 }, volume_erro_pct: { dir: -1.5, esq: 0 }, landmarks_erro_mm: { medio: 0.3, max: 0.7 }, reprojecao_rms_px: 0.6 };

const IMPLANTE = "motiva-rsd-300";
const VERSAO_CONFIG = carregarConfigSimulacaoUI().versao;
const json = (corpo: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const lm = (x: number, y: number, z: number, v: number) => ({ posicao: [x, y, z], vertice: v, origem: "foto" });
const LANDMARKS = {
  furcula: lm(0, 0, 0, 0),
  mamilo_dir: lm(-95, -190, 90, 1),
  mamilo_esq: lm(95, -190, 90, 2),
  sulco_dir: lm(-95, -260, 60, 3),
  sulco_esq: lm(95, -260, 60, 1),
  linha_media_inferior: lm(0, -260, 40, 2),
  base_medial_dir: lm(-30, -190, 60, 0),
  base_lateral_dir: lm(-150, -190, 30, 1),
  base_medial_esq: lm(30, -190, 60, 2),
  base_lateral_esq: lm(150, -190, 30, 3),
};
const PREVISTO = { delta_projecao_mamilo_mm: { dir: 29.1, esq: 29.1 }, delta_y_sulco_mm: { dir: 0, esq: 0 }, delta_y_mamilo_mm: { dir: 3.4, esq: 3.4 } };

function escrever(rel: string, conteudo: string | Buffer) {
  const abs = caminhoEmDataDir(rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, conteudo);
}

/** Malha enviada (upload, mock do /processar); devolve id e malha_dir. */
async function novaMalha(): Promise<{ id: string; dir: string }> {
  const p = await (await postPaciente()).json();
  const fd = new FormData();
  fd.set("paciente_id", p.id);
  fd.set("unidade_origem", "mm");
  fd.append("arquivos", new File(["v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"], "t.obj"));
  const j = await (await postMalha(new Request("http://x/api/malhas", { method: "POST", body: fd }))).json();
  return { id: j.malha_id, dir: j.meta.malha_dir };
}

/** Uma sessão de Bland-Altman ilegível bloqueia todos os gabaritos (fail closed, ADR 0017). */
function comBloqueio<T>(f: () => Promise<T>): Promise<T> {
  const lixo = caminhoEmDataDir("validacao/sessoes/00000000-0000-4000-8000-0000000f0f0f.json");
  mkdirSync(dirname(lixo), { recursive: true });
  writeFileSync(lixo, "{ corrompido");
  return f().finally(() => rmSync(lixo));
}

const arquivo = (id: string, nome: string) => getArquivo(new Request(`http://x/api/malhas/${id}/arquivo?nome=${encodeURIComponent(nome)}`), params(id));

describe.skipIf(!dbDisponivel())("malha reconstruída de fotos: regras no servidor", () => {
  it("N7: foto e observado.png só saem de malha reconstruída de fotos (scan com textura foto_frente.jpg → 400)", async () => {
    const m = await novaMalha();
    escrever(`${m.dir}/original/foto_frente.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    escrever(`${m.dir}/observado.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    for (const nome of ["original/foto_frente.jpg", "observado.png"]) expect((await arquivo(m.id, nome)).status, nome).toBe(400);
    escrever(`${m.dir}/reconstrucao.json`, JSON.stringify(C1_FRENTE));
    for (const nome of ["original/foto_frente.jpg", "observado.png"]) expect((await arquivo(m.id, nome)).status, nome).toBe(200);
    // o C1 e a avaliação nunca saem pela rota de arquivo
    for (const nome of ["reconstrucao.json", "avaliacao.json"]) expect((await arquivo(m.id, nome)).status, nome).toBe(400);
  });

  it("N2: sem perfil, nenhum previsto sai nem é gravado em B; com perfil, sai", async () => {
    vi.stubEnv("DESENHO", "B");
    for (const [c1, esperaPrevisto] of [[C1_FRENTE, false], [C1_COM_PERFIL, true]] as const) {
      const m = await novaMalha();
      escrever(`${m.dir}/reconstrucao.json`, JSON.stringify(c1));
      const r = await postMorphs(new Request("http://x", json({ landmarks: LANDMARKS, implantes: [IMPLANTE] })), params(m.id));
      expect(r.status).toBe(200);
      const alvos = (await r.json()).arquivos.flatMap((a: any) => a.targets);
      expect(alvos.length).toBeGreaterThan(0);
      expect(alvos.every((t: any) => (t.previsto === null) === !esperaPrevisto), `morphs, perfil=${esperaPrevisto}`).toBe(true);
      // o manifest em disco (gerado em B, com previsto) passa pela mesma regra na rota de arquivo
      escrever(`${m.dir}/morphs/manifest.json`, JSON.stringify({ esquema: "morphs/1.0", arquivos: [{ plano: "subglandular", imf: "manter", targets: [{ implante_id: IMPLANTE, lado: "ambos", previsto: PREVISTO }] }] }));
      const man = await (await arquivo(m.id, "morphs/manifest.json")).json();
      expect(man.arquivos[0].targets[0].previsto === null, `manifest, perfil=${esperaPrevisto}`).toBe(!esperaPrevisto);
      const corpo = { implante_id: IMPLANTE, plano: "subglandular", imf: "manter", lado: "ambos", versao_config_simulacao: VERSAO_CONFIG, nao_calibrado: true, previsto: PREVISTO };
      const s = await postSimulacao(new Request("http://x", json(corpo)), params(m.id));
      if (esperaPrevisto) expect(s.status).toBe(201);
      else {
        expect(s.status).toBe(422);
        expect((await s.json()).erro.codigo).toBe("previsto_sem_perfil");
        // sem previsto a simulação mostrada continua sendo registrada
        expect((await postSimulacao(new Request("http://x", json({ ...corpo, previsto: null })), params(m.id))).status).toBe(201);
      }
      const lista = (await (await getSimulacoes(new Request("http://x"), params(m.id))).json()).simulacoes;
      expect(lista).toHaveLength(1);
      expect(lista[0].previsto === null).toBe(!esperaPrevisto);
    }
  });

  it("N3: com sessão de Bland-Altman aberta (bloqueio), /foto-real não devolve o erro contra o gabarito", async () => {
    vi.stubEnv("DESENHO", "B");
    const m = await novaMalha();
    escrever(`${m.dir}/reconstrucao.json`, JSON.stringify(C1_FRENTE));
    escrever(`${m.dir}/avaliacao.json`, JSON.stringify(AVALIACAO));
    const ler = async () => (await getFotoReal(new Request("http://x"), params(m.id))).json();
    expect((await ler()).erro_gabarito).toMatchObject({ rms_mm: { x: 0.3 } });
    await comBloqueio(async () => {
      const f = await ler();
      expect(f.erro_gabarito).toBeNull();
      expect(f.numeros).not.toBeNull(); // a incerteza continua (não é gabarito)
    });
    expect((await ler()).erro_gabarito).not.toBeNull();
  });

  it("N3: importar-foto com o torso bloqueado não copia o avaliacao.json (nem devolve o erro)", async () => {
    vi.stubEnv("DESENHO", "B");
    const base = "sinteticos/tx_foto";
    escrever(`${base}/gabarito.json`, JSON.stringify({ esquema: "gabarito/1.0", landmarks: {}, distancias: {} }));
    escrever(`${base}/foto/reconstrucao.json`, JSON.stringify(C1_FRENTE));
    escrever(`${base}/foto/original/foto_frente.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    escrever(`${base}/foto/processada.obj`, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
    escrever(`${base}/foto/avaliacao.json`, JSON.stringify(AVALIACAO));
    const importar = async () => {
      const p = await (await postPaciente()).json();
      const r = await postImportarFoto(new Request("http://x", json({ paciente_id: p.id })), { params: Promise.resolve({ nome: "tx_foto" }) });
      expect(r.status).toBe(201);
      return r.json();
    };
    try {
      const livre = await importar();
      expect(existsSync(caminhoEmDataDir(`${livre.meta.malha_dir}/avaliacao.json`))).toBe(true);
      expect(livre.foto.erro_gabarito).not.toBeNull();
      await comBloqueio(async () => {
        const cego = await importar();
        expect(cego.gabarito_bloqueado).toBe(true);
        expect(cego.foto.erro_gabarito).toBeNull();
        expect(existsSync(caminhoEmDataDir(`${cego.meta.malha_dir}/reconstrucao.json`))).toBe(true);
        expect(existsSync(caminhoEmDataDir(`${cego.meta.malha_dir}/avaliacao.json`))).toBe(false);
      });
    } finally {
      rmSync(caminhoEmDataDir(base), { recursive: true, force: true });
    }
  });
});
