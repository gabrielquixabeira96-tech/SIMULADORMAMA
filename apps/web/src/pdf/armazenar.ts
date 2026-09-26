import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { caminhoEmDataDir } from "@/config/ambiente";

/**
 * PDFs ficam em DATA_DIR (fora do repositório, no .gitignore), caminho RELATIVO gravado no banco
 * (contratos §5.4/§17). Arquivo com permissão 0600; leitura confere o SHA-256 gravado.
 */
export class PdfCorrompidoError extends Error {
  readonly codigo = "pdf_corrompido" as const;
  constructor() {
    super("PDF em disco não confere com o SHA-256 registrado");
    this.name = "PdfCorrompidoError";
  }
}

/** Um arquivo por geração (nunca sobrescreve um PDF já entregue). */
export function caminhoRelativoPdf(atendimentoId: string, relatorioId: string, carimbo: number = Date.now()): string {
  return `atendimentos/${atendimentoId}/pdf/relatorio-${relatorioId}-${carimbo}.pdf`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function salvarPdf(caminhoRelativo: string, bytes: Uint8Array): { sha256: string; bytes: number } {
  const abs = caminhoEmDataDir(caminhoRelativo);
  mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
  writeFileSync(abs, bytes, { mode: 0o600 });
  return { sha256: sha256(bytes), bytes: bytes.byteLength };
}

export function lerPdf(caminhoRelativo: string, shaEsperado: string | null): Buffer {
  const buf = readFileSync(caminhoEmDataDir(caminhoRelativo));
  if (shaEsperado && sha256(buf) !== shaEsperado) throw new PdfCorrompidoError();
  return buf;
}
