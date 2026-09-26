import type { NextResponse } from "next/server";
import { erro, tratarErro } from "@/api/respostas";
import { PdfCorrompidoError } from "@/pdf/armazenar";
import { NomeProprioError } from "./anamnese";
import { PayloadProibidoError } from "./payload";
import { LLMNaoConfiguradoError, ProvedorLLMIndisponivelError, SaidaLLMInvalidaError } from "./provedor";
import { RelatorioInconsistenteError } from "./relatorio";
import { PedidoInvalidoError } from "./servicoRelatorio";

/** Converte os erros da camada de texto/registro em respostas HTTP; o resto vai ao `tratarErro` comum. */
export function tratarErroLLM(e: unknown, contexto: string): NextResponse {
  if (e instanceof PedidoInvalidoError) return erro(e.status, e.codigo, e.message);
  if (e instanceof LLMNaoConfiguradoError) return erro(503, e.codigo, e.message);
  if (e instanceof ProvedorLLMIndisponivelError) return erro(502, e.codigo, "provedor do LLM indisponível");
  if (e instanceof SaidaLLMInvalidaError) return erro(502, e.codigo, "saída do LLM fora do contrato");
  if (e instanceof NomeProprioError) return erro(422, e.codigo, e.message, { sinais: e.sinais });
  if (e instanceof PayloadProibidoError) return erro(422, e.codigo, "payload recusado pela guarda do LLM");
  if (e instanceof RelatorioInconsistenteError) return erro(500, e.codigo, "texto final do relatório não confere com os dados");
  if (e instanceof PdfCorrompidoError) return erro(500, e.codigo, e.message);
  return tratarErro(e, contexto);
}
