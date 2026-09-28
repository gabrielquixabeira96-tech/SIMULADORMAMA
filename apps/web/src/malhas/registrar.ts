import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DECIMACAO_PADRAO, type Desenho, type MalhaMeta, type ModoRecorte, type UnidadeOrigem } from "@simulador/contratos";
import { caminhoEmDataDir, usuarioAtual } from "@/config/ambiente";
import { demoAtiva } from "@/config/demo";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { inserirMalha, type Paciente } from "@/db/repositorio";
import { log } from "@/log/logger";
import { ClienteMesh } from "@/mesh/cliente";
import type { UploadPreparado } from "./upload";

export interface MalhaRegistrada {
  malha_id: string;
  pseudonimo: string;
  meta: MalhaMeta;
}

/**
 * Caminho único de entrada de malhas (ADR 0003 itens 2 e 9): grava o original em
 * DATA_DIR/pacientes/<pseudonimo>/malhas/<malha_id>/original/, chama /processar e só então
 * registra a malha e a auditoria. Em falha, apaga a pasta criada. Usado pelo upload e pela
 * importação de torsos sintéticos.
 */
export async function registrarMalha(a: {
  paciente: Paciente;
  upload: UploadPreparado;
  unidade: UnidadeOrigem;
  recorte: Exclude<ModoRecorte, "caixa">;
  sintetica: boolean;
  desenho: Desenho;
  origem: "upload" | "sintetico";
  /**
   * Malha reconstruída de fotos (plano "foto → 3D"): chamado depois do /processar e antes do
   * registro no banco, com a pasta absoluta da malha, para copiar `reconstrucao.json`, as fotos e o
   * `observado.png`. Falha aqui apaga a pasta, como qualquer falha do registro.
   */
  aposProcessar?: (absMalhaDir: string) => Promise<void>;
  /** "foto" = malha reconstruída de fotos (vai na auditoria) */
  modalidade?: "scan" | "foto";
}): Promise<MalhaRegistrada> {
  // modo demo sintética (ADR 0018): nenhuma malha não sintética entra, por nenhum caminho
  if (demoAtiva() && (!a.sintetica || a.origem !== "sintetico")) throw new Error("modo demo sintética: só torsos sintéticos podem ser registrados");
  const malhaId = randomUUID();
  const malhaDir = `pacientes/${a.paciente.pseudonimo}/malhas/${malhaId}`;
  const absOriginal = caminhoEmDataDir(`${malhaDir}/original`);
  let dirCriado: string | null = caminhoEmDataDir(malhaDir);
  try {
    await mkdir(absOriginal, { recursive: true });
    for (const f of a.upload.arquivos) await writeFile(join(/*turbopackIgnore: true*/ absOriginal, f.nome), f.dados, { flag: "wx" });
    const meta = await new ClienteMesh({ desenho: a.desenho }).processar({
      malha_dir: malhaDir,
      arquivo_original: `original/${a.upload.principal}`,
      unidade_origem: a.unidade,
      recorte: { modo: a.recorte, y_max_mm: null, y_min_mm: null },
      decimacao: { ...DECIMACAO_PADRAO },
    });
    if (meta.malha_dir !== malhaDir) log.warn("mesh_malha_dir_divergente", { malha_id: malhaId });
    if (a.aposProcessar) await a.aposProcessar(caminhoEmDataDir(malhaDir));
    await transacao(async (c) => {
      await inserirMalha({ id: malhaId, pacienteId: a.paciente.id, malhaDir, formatoOrigem: a.upload.formato, unidadeOrigem: a.unidade, meta, sintetica: a.sintetica }, c);
      await registrarAuditoria(
        {
          usuarioId: usuarioAtual(),
          acao: "criou",
          entidade: "malhas",
          entidadeId: malhaId,
          desenho: a.desenho,
          detalhes: {
            origem: a.origem,
            ...(a.modalidade ? { modalidade: a.modalidade } : {}),
            formato: a.upload.formato,
            n_arquivos: a.upload.arquivos.length,
            bytes: a.upload.bytes,
            sintetica: a.sintetica,
            n_vertices_processada: meta.processada.n_vertices,
          },
        },
        c,
      );
    });
    dirCriado = null;
    log.info("malha_criada", { malha_id: malhaId, pseudonimo: a.paciente.pseudonimo, origem: a.origem });
    return { malha_id: malhaId, pseudonimo: a.paciente.pseudonimo, meta };
  } finally {
    if (dirCriado) await rm(dirCriado, { recursive: true, force: true }).catch(() => undefined);
  }
}
