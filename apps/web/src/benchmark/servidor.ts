import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { DECIMACAO_PADRAO, IMFS, LANDMARK_IDS, PLANOS, arquivoMorph, manifestMorphsSchema, type Landmarks, type ManifestMorphs } from "@simulador/contratos";
import { caminhoEmDataDir } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { redigirPrevistoManifest } from "@/malhas/arquivos";
import { ClienteMesh } from "@/mesh/cliente";
import { modoDemoSintetica } from "@/seguranca/requisicao";

/**
 * Página /benchmark (plano A14): mede a latência de interação da simulação no hardware-alvo
 * (iPad/Safari) com o MESMO roteiro do e2e. Ligada só por variável de SERVIDOR
 * (`BENCHMARK_HABILITADO=1`; nunca NEXT_PUBLIC_*, pela lógica da flag do ADR 0005); desligada, a
 * página e as rotas dão 404. Usa só torso sintético paramétrico, processado numa pasta própria
 * (DATA_DIR/benchmark/<torso>), fora de pacientes/ e sem registro no banco: nenhum dado de
 * paciente entra ou sai. Os números previstos nunca saem (manifest redigido).
 */
export const TORSO_BENCHMARK = "t01_simetrico_300";
/** Os mesmos 2 implantes do e2e de latência (e2e/simulacao-apoio.ts). */
export const IMPLANTES_BENCHMARK = ["motiva-rsd-300", "polytech-21631-255"] as const;
const DIR = `benchmark/${TORSO_BENCHMARK}`;

/** `BENCHMARK_HABILITADO=1`, ou o modo demo sintética (ADR 0018), que liga o /benchmark junto com o resto do app. */
export function benchmarkHabilitado(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.BENCHMARK_HABILITADO === "1" || modoDemoSintetica(env);
}

/** Nomes (relativos à pasta do benchmark) que a rota de arquivo aceita: só os 4 .glb de morphs. */
export const ARQUIVOS_BENCHMARK: ReadonlySet<string> = new Set(PLANOS.flatMap((p) => IMFS.map((i) => `morphs/${arquivoMorph(p, i)}`)));

export function caminhoArquivoBenchmark(nome: string): string | null {
  return ARQUIVOS_BENCHMARK.has(nome) ? caminhoEmDataDir(`${DIR}/${nome}`) : null;
}

const existe = (abs: string) =>
  stat(abs).then(
    (s) => s.isFile(),
    () => false,
  );

/** Vértices ("v x y z") de um OBJ, em ordem. */
function verticesObj(texto: string): Float64Array {
  const xs: number[] = [];
  for (const linha of texto.split("\n")) {
    if (!linha.startsWith("v ")) continue;
    const p = linha.trim().split(/\s+/);
    xs.push(Number(p[1]), Number(p[2]), Number(p[3]));
  }
  return Float64Array.from(xs);
}

function verticeMaisProximo(v: Float64Array, p: readonly number[]): number {
  let melhor = 0;
  let d = Infinity;
  for (let i = 0; i < v.length; i += 3) {
    const dx = v[i]! - p[0]!, dy = v[i + 1]! - p[1]!, dz = v[i + 2]! - p[2]!;
    const q = dx * dx + dy * dy + dz * dz;
    if (q < d) {
      d = q;
      melhor = i / 3;
    }
  }
  return melhor;
}

let emAndamento: Promise<ManifestMorphs> | null = null;

/**
 * Garante o torso sintético processado e os morphs dos 2 implantes (uma vez; depois reusa o que
 * está em disco) e devolve o manifest SEM números previstos.
 */
export function prepararBenchmark(): Promise<ManifestMorphs> {
  emAndamento ??= preparar().finally(() => {
    emAndamento = null;
  });
  return emAndamento;
}

async function preparar(): Promise<ManifestMorphs> {
  const desenho = getDesenho();
  const mesh = new ClienteMesh({ desenho });
  const abs = (rel: string) => caminhoEmDataDir(`${DIR}/${rel}`);
  const origem = (a: string) => caminhoEmDataDir(`sinteticos/${TORSO_BENCHMARK}/${a}`);
  if (!(await existe(origem("torso.obj")))) throw new Error(`torso sintético ${TORSO_BENCHMARK} ausente (bash scripts/mesh.sh torsos)`);

  if (!(await existe(abs("processada.obj"))) || !(await existe(abs("processada.glb")))) {
    await mkdir(abs("original"), { recursive: true });
    for (const a of ["torso.obj", "torso.mtl", "textura.png"]) if (await existe(origem(a))) await copyFile(origem(a), abs(`original/${a}`));
    await mesh.processar({
      malha_dir: DIR,
      arquivo_original: "original/torso.obj",
      unidade_origem: "mm",
      recorte: { modo: "abaixo_do_pescoco", y_max_mm: null, y_min_mm: null },
      decimacao: { ...DECIMACAO_PADRAO },
    });
  }

  const manifestAbs = abs("morphs/manifest.json");
  if (await existe(manifestAbs)) {
    const m = manifestMorphsSchema.safeParse(JSON.parse(await readFile(manifestAbs, "utf8")));
    const ids = new Set(m.success ? m.data.arquivos.flatMap((a) => a.targets.map((t) => t.implante_id)) : []);
    const completos = m.success && IMPLANTES_BENCHMARK.every((i) => ids.has(i)) && (await Promise.all([...ARQUIVOS_BENCHMARK].map((n) => existe(abs(n))))).every(Boolean);
    if (m.success && completos) return redigirPrevistoManifest(m.data, false);
  }

  // landmarks do gabarito do torso sintético, no vértice mais próximo da malha processada
  const gabarito = JSON.parse(await readFile(origem("gabarito.json"), "utf8")) as { landmarks: Record<string, { posicao: [number, number, number] }> };
  const v = verticesObj(await readFile(abs("processada.obj"), "utf8"));
  const landmarks: Landmarks = {};
  for (const id of LANDMARK_IDS) {
    const g = gabarito.landmarks[id];
    if (g) landmarks[id] = { posicao: g.posicao, vertice: verticeMaisProximo(v, g.posicao), origem: "gabarito" };
  }
  const manifest = await mesh.morphs({ malha_dir: DIR, landmarks, implantes: [...IMPLANTES_BENCHMARK], planos: [...PLANOS], imfs: [...IMFS], lados: "separados" });
  return redigirPrevistoManifest(manifest, false);
}
