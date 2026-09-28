import { randomUUID } from "node:crypto";
import { bloquearSeDesligado, erro, json } from "@/api/respostas";
import { isoComFuso, versaoSoftware } from "@/config/ambiente";
import { demoAtiva } from "@/config/demo";
import { auditarSessao, erroValidacao, RECURSO_VALIDACAO } from "@/validacao/http";
import { montarPlanilha, paraCsv } from "@/validacao/planilha";
import { algumBloqueio, bloqueioGabarito } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/validacao/planilha?formato=csv|json[&separador=virgula|ponto-e-virgula] — planilha de
 * validação do art. 5º da RDC 657 (ADR 0017): uma linha por par medido × referência, dos registros
 * de componente versionados e das sessões de Bland-Altman encerradas. Audita `exportou`.
 * DESENHO=A → 403 (as linhas são distâncias calculadas). Com qualquer sessão aberta (ou arquivo de
 * sessão inválido) → 409: as linhas trazem referências dos gabaritos dos torsos (cegueira, ADR 0017).
 */
export async function GET(req: Request) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const url = new URL(req.url);
    const formato = url.searchParams.get("formato") ?? "csv";
    const sepParam = url.searchParams.get("separador") ?? "virgula";
    if (formato !== "csv" && formato !== "json") return erro(400, "formato_invalido", "formato deve ser csv ou json");
    if (sepParam !== "virgula" && sepParam !== "ponto-e-virgula") return erro(400, "separador_invalido", "separador deve ser virgula ou ponto-e-virgula");
    const b = await bloqueioGabarito();
    if (algumBloqueio(b)) {
      return erro(409, "planilha_indisponivel_sessao_aberta", b.todos ? "há arquivo de sessão inválido em DATA_DIR/validacao/sessoes (corrija ou remova à mão)" : "há sessão de validação aberta: encerre ou cancele antes de exportar");
    }
    const agora = isoComFuso();
    const versao = versaoSoftware();
    const demo = demoAtiva();
    const p = await montarPlanilha({ versaoSoftware: versao, geradaEm: agora, demo });
    await auditarSessao("exportou", randomUUID(), { formato, n_linhas: p.linhas.length, n_grupos: p.resumo.length }, "validacao_planilha");
    if (formato === "json") return json(p);
    const nome = `planilha-art5${demo ? "-DEMO" : ""}-v${versao}-${agora.slice(0, 10)}.csv`;
    return new Response(paraCsv(p, { separador: sepParam === "virgula" ? "," : ";" }), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return erroValidacao(e, "validacao.planilha");
  }
}
