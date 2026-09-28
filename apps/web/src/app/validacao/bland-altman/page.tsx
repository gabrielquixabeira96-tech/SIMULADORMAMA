import type { Metadata } from "next";
import { demoAtiva } from "@/config/demo";
import { recursoAtivo } from "@/config/desenho";
import { RECURSO_VALIDACAO } from "@/validacao/http";
import { SessaoBlandAltman } from "@/validacao/SessaoBlandAltman";

// DESENHO é lido em runtime no servidor (ADR 0005).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sessão de Bland-Altman — simulador mamário" };

/**
 * /validacao/bland-altman — sessão de validação de medidas com operador humano (ADR 0017; ESTRATEGIA
 * fase 1). Só no desenho B: a sessão calcula distâncias a partir do 3D (`medicao_automatica_3d`).
 */
export default async function PaginaBlandAltman({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!recursoAtivo(RECURSO_VALIDACAO)) {
    return (
      <section className="painel" data-testid="validacao-desligada">
        <h1>Validação de medidas</h1>
        <p>Desligada no desenho A: nenhuma distância é calculada a partir do 3D nesta instalação (ADR 0005 e ADR 0017).</p>
      </section>
    );
  }
  const q = await searchParams;
  const sessao = typeof q.sessao === "string" && /^[0-9a-f-]{36}$/.test(q.sessao) ? q.sessao : null;
  return (
    <>
      <header className="cabecalho">
        <h1>Sessão de Bland-Altman (validação das medidas)</h1>
        <p className="nota">
          Torsos sintéticos com gabarito, cegos: o operador marca os landmarks em cada scan, em ordem aleatória, com repetição; o gabarito só é lido no servidor e aparece ao encerrar. Resultado em
          DATA_DIR/validacao/sessoes e na planilha do art. 5º da RDC 657.
        </p>
      </header>
      <SessaoBlandAltman sessaoInicial={sessao} demo={demoAtiva()} />
    </>
  );
}
