import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DECIMACAO_PADRAO, modoRecorteSchema, unidadeOrigemSchema, uuidSchema } from "@simulador/contratos";
import { erro, json, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir, usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { inserirMalha, pacientePorId } from "@/db/repositorio";
import { log } from "@/log/logger";
import { ErroUpload, limiteUploadBytes, prepararUpload, type ArquivoUpload } from "@/malhas/upload";
import { ClienteMesh } from "@/mesh/cliente";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/malhas (multipart) — ADR 0003. Campos: `paciente_id`, `unidade_origem`,
 * `recorte_modo` (padrão abaixo_do_pescoco), `sintetica` ("true"), `arquivos` (1..n).
 * Grava o original em DATA_DIR/pacientes/<pseudonimo>/malhas/<malha_id>/original/,
 * chama /processar e só então registra a malha e a auditoria.
 */
export async function POST(req: Request) {
  let dirCriado: string | null = null;
  try {
    const desenho = getDesenho();
    const tamanho = Number(req.headers.get("content-length"));
    if (Number.isFinite(tamanho) && tamanho > limiteUploadBytes() + 1024 * 1024) {
      return erro(413, "upload_grande_demais", "upload acima do limite");
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return erro(400, "multipart_invalido", "envie multipart/form-data");
    }
    const pacienteId = uuidSchema.safeParse(form.get("paciente_id"));
    if (!pacienteId.success) return erro(400, "paciente_id_invalido", "paciente_id (uuid) obrigatório");
    const unidade = unidadeOrigemSchema.safeParse(form.get("unidade_origem") ?? "desconhecida");
    if (!unidade.success) return erro(400, "unidade_invalida", "unidade_origem deve ser m, cm, mm ou desconhecida");
    const recorte = modoRecorteSchema.safeParse(form.get("recorte_modo") ?? "abaixo_do_pescoco");
    if (!recorte.success || recorte.data === "caixa") {
      // modo "caixa" exige limites manuais (UI futura); nesta fase só abaixo_do_pescoco|nenhum
      return erro(400, "recorte_invalido", "recorte_modo deve ser abaixo_do_pescoco ou nenhum");
    }
    const sintetica = form.get("sintetica") === "true";

    const entradas: ArquivoUpload[] = [];
    for (const v of form.getAll("arquivos")) {
      if (typeof v === "string") continue;
      entradas.push({ nome: v.name, dados: new Uint8Array(await v.arrayBuffer()) });
    }
    const up = prepararUpload(entradas);

    const paciente = await pacientePorId(pacienteId.data);
    if (!paciente) return erro(404, "paciente_nao_encontrado", "paciente não encontrado");

    const malhaId = randomUUID();
    const malhaDir = `pacientes/${paciente.pseudonimo}/malhas/${malhaId}`;
    const absOriginal = caminhoEmDataDir(`${malhaDir}/original`);
    dirCriado = caminhoEmDataDir(malhaDir);
    await mkdir(absOriginal, { recursive: true });
    for (const a of up.arquivos) await writeFile(join(/*turbopackIgnore: true*/ absOriginal, a.nome), a.dados, { flag: "wx" });

    const mesh = new ClienteMesh({ desenho });
    const meta = await mesh.processar({
      malha_dir: malhaDir,
      arquivo_original: `original/${up.principal}`,
      unidade_origem: unidade.data,
      recorte: { modo: recorte.data, y_max_mm: null, y_min_mm: null },
      decimacao: { ...DECIMACAO_PADRAO },
    });
    if (meta.malha_dir !== malhaDir) {
      log.warn("mesh_malha_dir_divergente", { malha_id: malhaId });
    }

    await transacao(async (c) => {
      await inserirMalha({ id: malhaId, pacienteId: paciente.id, malhaDir, formatoOrigem: up.formato, unidadeOrigem: unidade.data, meta, sintetica }, c);
      await registrarAuditoria(
        {
          usuarioId: usuarioAtual(),
          acao: "criou",
          entidade: "malhas",
          entidadeId: malhaId,
          desenho,
          detalhes: { formato: up.formato, n_arquivos: up.arquivos.length, bytes: up.bytes, sintetica, n_vertices_processada: meta.processada.n_vertices },
        },
        c,
      );
    });
    dirCriado = null;
    log.info("malha_criada", { malha_id: malhaId, pseudonimo: paciente.pseudonimo });
    return json({ malha_id: malhaId, pseudonimo: paciente.pseudonimo, meta }, 201);
  } catch (e) {
    if (e instanceof ErroUpload) return erro(e.status, e.codigo, e.message);
    return tratarErro(e, "malhas.upload");
  } finally {
    if (dirCriado) await rm(dirCriado, { recursive: true, force: true }).catch(() => undefined);
  }
}
