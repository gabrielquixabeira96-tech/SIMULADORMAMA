import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { reconstrucaoSchema, uuidSchema, type Reconstrucao } from "@simulador/contratos";
import { z } from "zod";
import { erro, json, lerJson, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir } from "@/config/ambiente";
import { carregarConfigSimulacaoUI } from "@/config/arquivosConfig";
import { torsoUtilizavel } from "@/config/demo";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { pacientePorId } from "@/db/repositorio";
import { fotoRealPublica } from "@/foto/publica";
import { ARQUIVO_AVALIACAO, ARQUIVO_OBSERVADO, ARQUIVO_RECONSTRUCAO, lerReconstrucao } from "@/foto/servidor";
import { registrarMalha } from "@/malhas/registrar";
import { ErroUpload, prepararUpload, type ArquivoUpload } from "@/malhas/upload";
import { bloqueioGabarito, gabaritoBloqueado } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.strictObject({ paciente_id: uuidSchema });
const gabaritoSchema = z
  .object({
    esquema: z.literal("gabarito/1.0"),
    landmarks: z.record(z.string(), z.object({ posicao: z.tuple([z.number(), z.number(), z.number()]) }).passthrough()),
    distancias: z.record(z.string(), z.object({ euclidiana_mm: z.number(), geodesica_mm: z.number().nullable() }).nullable()),
  })
  .passthrough();

/** Pasta das "fotos de exemplo" de um torso sintético, preparada pelo pipeline do services/mesh (P1/P2/P4). */
const PASTA_FOTO = "foto";
/** Malha reconstruída (OBJ + MTL + textura projetada), na ordem de preferência. */
const MALHAS_RECONSTRUIDAS = [
  ["torso.obj", "torso.mtl"],
  ["processada.obj", "processada.mtl"],
] as const;

const existe = (abs: string) =>
  stat(abs)
    .then((s) => s.isFile())
    .catch(() => false);

/**
 * POST /api/sinteticos/<nome>/importar-foto — "Foto de exemplo" (plano "foto → 3D", P4-lite): a
 * reconstrução JÁ PREPARADA pelo pipeline em `DATA_DIR/sinteticos/<nome>/foto/` (fotos sintéticas
 * do torso, `reconstrucao.json` C1, malha do template ajustado com a foto projetada, `observado.png`
 * e `avaliacao.json` contra o gabarito) entra pelo MESMO caminho de uma malha enviada (ADR 0003
 * item 9: original/ + /processar + registro + auditoria); as fotos, o C1, o observado e a avaliação
 * são copiados para a pasta da malha. Nada é reconstruído aqui (a rota `/reconstruir` com
 * `/reconstruir-foto` é do P3 completo). Devolve o gabarito (âncora dos landmarks) e o resumo da
 * reconstrução redigido por desenho (erro contra o gabarito só em B).
 */
export async function POST(req: Request, ctx: { params: Promise<{ nome: string }> }) {
  try {
    const desenho = getDesenho();
    const { nome } = await ctx.params;
    if (!/^[a-z0-9_]+$/.test(nome)) return erro(400, "nome_invalido", "nome de torso inválido");
    if (!(await torsoUtilizavel(nome))) return erro(404, "torso_nao_encontrado", "torso sintético não encontrado");
    const corpo = corpoSchema.parse(await lerJson(req));
    const paciente = await pacientePorId(corpo.paciente_id);
    if (!paciente) return erro(404, "paciente_nao_encontrado", "paciente não encontrado");

    const pasta = `sinteticos/${nome}/${PASTA_FOTO}`;
    const abs = (n: string) => caminhoEmDataDir(`${pasta}/${n}`);
    let rec: Reconstrucao;
    try {
      rec = reconstrucaoSchema.parse(JSON.parse(await readFile(abs(ARQUIVO_RECONSTRUCAO), "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return erro(404, "foto_nao_preparada", "fotos de exemplo deste torso ainda não preparadas");
      throw e;
    }
    // cada foto do C1: <pasta>/original/foto_<vista>.jpg (layout de malha) ou <pasta>/foto_<vista>.jpg
    const fotos: Array<{ de: string; para: string }> = [];
    for (const f of rec.fotos) {
      const de = (await existe(abs(f.arquivo))) ? abs(f.arquivo) : abs(basename(f.arquivo));
      if (!(await existe(de))) return erro(404, "foto_nao_preparada", `foto ausente: ${f.arquivo}`);
      fotos.push({ de, para: f.arquivo });
    }
    const par = await (async () => {
      for (const [obj, mtl] of MALHAS_RECONSTRUIDAS) if (await existe(abs(obj))) return [obj, mtl] as const;
      return null;
    })();
    if (!par) return erro(404, "foto_nao_preparada", "malha reconstruída ausente");
    const entradas: ArquivoUpload[] = [];
    for (const a of [par[0], par[1], "textura.png"]) {
      if (await existe(abs(a))) entradas.push({ nome: a, dados: new Uint8Array(await readFile(abs(a))) });
    }

    let gabarito: z.infer<typeof gabaritoSchema> | null = null;
    const bloqueado = gabaritoBloqueado(await bloqueioGabarito(), nome);
    if (!bloqueado) {
      try {
        gabarito = gabaritoSchema.parse(JSON.parse(await readFile(caminhoEmDataDir(`sinteticos/${nome}/gabarito.json`), "utf8")));
      } catch {
        gabarito = null;
      }
    }

    const r = await registrarMalha({
      paciente,
      upload: prepararUpload(entradas),
      unidade: "mm",
      recorte: "abaixo_do_pescoco",
      sintetica: true,
      desenho,
      origem: "sintetico",
      modalidade: "foto",
      aposProcessar: async (dir) => {
        for (const f of fotos) {
          await mkdir(dirname(join(/*turbopackIgnore: true*/ dir, f.para)), { recursive: true });
          await copyFile(f.de, join(/*turbopackIgnore: true*/ dir, f.para));
        }
        await copyFile(abs(ARQUIVO_RECONSTRUCAO), join(/*turbopackIgnore: true*/ dir, ARQUIVO_RECONSTRUCAO));
        for (const opcional of [ARQUIVO_OBSERVADO, ARQUIVO_AVALIACAO]) {
          if (await existe(abs(opcional))) await copyFile(abs(opcional), join(/*turbopackIgnore: true*/ dir, opcional));
        }
      },
    });
    const lida = await lerReconstrucao(r.meta.malha_dir);
    const medir = recursoAtivoEm(desenho, "medicao_automatica_3d");
    const foto = lida
      ? fotoRealPublica(lida.reconstrucao, { envelopeMm: carregarConfigSimulacaoUI().envelope_rms_mm, numerosPermitidos: medir, observado: lida.observado, avaliacao: bloqueado ? null : lida.avaliacao })
      : null;
    const distancias = medir ? (gabarito?.distancias ?? null) : null;
    return json({ ...r, torso: nome, gabarito: gabarito ? { landmarks: gabarito.landmarks, distancias } : null, gabarito_bloqueado: bloqueado, foto }, 201);
  } catch (e) {
    if (e instanceof ErroUpload) return erro(e.status, e.codigo, e.message);
    return tratarErro(e, "sinteticos.importar_foto");
  }
}
