import { modoRecorteSchema, unidadeOrigemSchema, uuidSchema } from "@simulador/contratos";
import { erro, json, limitarCorpo, tratarErro } from "@/api/respostas";
import { demoAtiva, desligadoNaDemo } from "@/config/demo";
import { getDesenho } from "@/config/desenho";
import { pacientePorId } from "@/db/repositorio";
import { registrarMalha } from "@/malhas/registrar";
import { ErroUpload, limiteUploadBytes, prepararUpload, type ArquivoUpload } from "@/malhas/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/malhas (multipart) — ADR 0003. Campos: `paciente_id`, `unidade_origem`,
 * `recorte_modo` (padrão abaixo_do_pescoco), `arquivos` (1..n). A malha enviada é SEMPRE gravada
 * com `sintetica=false` (o campo do cliente é ignorado; revisão v0.1.1): só a importação de torso
 * sintético (`POST /api/sinteticos/<nome>/importar`) grava `true` — e só ela dispensa a régua.
 * Grava o original em DATA_DIR/pacientes/<pseudonimo>/malhas/<malha_id>/original/,
 * chama /processar e só então registra a malha e a auditoria.
 */
export async function POST(req: Request) {
  // modo demo sintética (ADR 0018): upload de malha real fechado (o proxy já recusa; defesa em profundidade)
  if (demoAtiva()) return desligadoNaDemo();
  try {
    const desenho = getDesenho();
    // Limite pelo STREAM (conta os bytes recebidos), não só pelo Content-Length: chunked não escapa.
    const limite = limiteUploadBytes() + 1024 * 1024;
    const tamanho = Number(req.headers.get("content-length"));
    if (Number.isFinite(tamanho) && tamanho > limite) return erro(413, "upload_grande_demais", "upload acima do limite");
    if (!req.body) return erro(400, "multipart_invalido", "envie multipart/form-data");
    let form: FormData;
    let excedeu = false;
    try {
      const corpo = limitarCorpo(req.body, limite, () => (excedeu = true));
      form = await new Response(corpo, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
    } catch {
      if (excedeu) return erro(413, "upload_grande_demais", "upload acima do limite");
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

    const entradas: ArquivoUpload[] = [];
    for (const v of form.getAll("arquivos")) {
      if (typeof v === "string") continue;
      entradas.push({ nome: v.name, dados: new Uint8Array(await v.arrayBuffer()) });
    }
    const up = prepararUpload(entradas);

    const paciente = await pacientePorId(pacienteId.data);
    if (!paciente) return erro(404, "paciente_nao_encontrado", "paciente não encontrado");

    const r = await registrarMalha({ paciente, upload: up, unidade: unidade.data, recorte: recorte.data, sintetica: false, desenho, origem: "upload" });
    return json(r, 201);
  } catch (e) {
    if (e instanceof ErroUpload) return erro(e.status, e.codigo, e.message);
    return tratarErro(e, "malhas.upload");
  }
}
