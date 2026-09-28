"use client";

import type { Desenho } from "@simulador/contratos";
import { useState } from "react";
import { AVISO_FIXO } from "@/config/aviso";
import { recursosDoDesenho } from "@/config/recursos";
import type { RelatorioFinal, SecaoRelatorio } from "@/llm/relatorio";

/**
 * Painel do relatório para a paciente + PDF do atendimento (Marco 2b). Autocontido:
 *  - "Gerar relatório" → POST /api/relatorio (números do template travado; prosa verificada);
 *  - "Gerar PDF" → POST /api/pdf; "Abrir PDF"/"Baixar PDF" → GET /api/pdf/<atendimento> (auditados).
 * Sem botão de compartilhar, sem exportação para redes (restrição 4). Em DESENHO=A nenhuma seção
 * calculada é exibida (defesa em profundidade: o servidor já não as gera).
 */

export interface PropsPainelRelatorio {
  pacienteId: string;
  /** Desenho vindo do servidor (ConfigPublica.desenho), nunca de NEXT_PUBLIC_*. */
  desenho: Desenho;
  /** Malha exibida: dela vêm as simulações mostradas e a última medida. */
  malhaId?: string | null;
  /** Medida específica (opcional; padrão = última da malha). */
  medidaId?: string | null;
  /** Atendimento em curso (ex.: o devolvido pelo PainelAnamnese). Ausente → o servidor cria. */
  atendimentoId?: string | null;
  /** Chamado quando o servidor cria/usa um atendimento. */
  onAtendimento?: (atendimentoId: string) => void;
}

type RelatorioUI = Pick<RelatorioFinal, "relatorio_id" | "atendimento_id" | "desenho" | "versao_software" | "prosa_origem" | "prosa_rejeitada" | "secoes" | "parametros" | "simulacoes_mostradas">;

function Secao({ s }: { s: SecaoRelatorio }) {
  return (
    <section data-testid={`relatorio-secao-${s.id}`} data-origem={s.origem}>
      <h4>{s.titulo}</h4>
      {s.linhas.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </section>
  );
}

export function PainelRelatorio({ pacienteId, desenho, malhaId, medidaId, atendimentoId, onAtendimento }: PropsPainelRelatorio) {
  const calculadosAtivos = recursosDoDesenho(desenho).numeros_calculados_no_relatorio;
  const [relatorio, setRelatorio] = useState<RelatorioUI | null>(null);
  const [ocupado, setOcupado] = useState<"relatorio" | "pdf" | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ atendimentoId: string; sha256: string } | null>(null);

  async function postar<T>(url: string, corpo: unknown): Promise<T | null> {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = (await r.json()) as T & { erro?: { codigo: string; mensagem?: string } };
    if (!r.ok) {
      setErroMsg(j.erro?.mensagem ?? j.erro?.codigo ?? `falha (${r.status})`);
      return null;
    }
    return j;
  }

  async function gerarRelatorio() {
    setOcupado("relatorio");
    setErroMsg(null);
    setPdf(null);
    try {
      const j = await postar<{ relatorio: RelatorioUI }>("/api/relatorio", {
        paciente_id: pacienteId,
        malha_id: malhaId ?? null,
        medida_id: medidaId ?? null,
        atendimento_id: atendimentoId ?? relatorio?.atendimento_id ?? null,
      });
      if (j) {
        setRelatorio(j.relatorio);
        onAtendimento?.(j.relatorio.atendimento_id);
      }
    } catch {
      setErroMsg("falha de rede ao gerar o relatório");
    } finally {
      setOcupado(null);
    }
  }

  async function gerarPdf() {
    if (!relatorio) return;
    setOcupado("pdf");
    setErroMsg(null);
    try {
      const j = await postar<{ atendimento_id: string; sha256: string }>("/api/pdf", { atendimento_id: relatorio.atendimento_id, relatorio_id: relatorio.relatorio_id });
      if (j) setPdf({ atendimentoId: j.atendimento_id, sha256: j.sha256 });
    } catch {
      setErroMsg("falha de rede ao gerar o PDF");
    } finally {
      setOcupado(null);
    }
  }

  // Defesa em profundidade: em A, seção calculada nunca é renderizada.
  const secoes = (relatorio?.secoes ?? []).filter((s) => calculadosAtivos || !s.calculado);

  return (
    <section className="painel painel-registro" data-testid="painel-relatorio" aria-labelledby="titulo-relatorio">
      <h3 id="titulo-relatorio">Relatório para a paciente</h3>
      <p className="aviso-servico" data-testid="relatorio-aviso">
        {AVISO_FIXO}
      </p>
      {/* uma sequência só: gerar relatório → gerar PDF → abrir/baixar (cada botão aparece quando cabe) */}
      <div className="linha-form">
        <button type="button" className={relatorio ? "secundario" : undefined} data-testid="relatorio-gerar" disabled={ocupado !== null} onClick={gerarRelatorio}>
          {ocupado === "relatorio" ? "Gerando…" : relatorio ? "Gerar novamente" : "Gerar relatório"}
        </button>
        {relatorio && (
          <button type="button" className={pdf ? "secundario" : undefined} data-testid="relatorio-pdf-gerar" disabled={ocupado !== null} onClick={gerarPdf}>
            {ocupado === "pdf" ? "Gerando PDF…" : "Gerar PDF do atendimento"}
          </button>
        )}
        {pdf && (
          <span data-testid="relatorio-pdf-pronto" className="par-botoes">
            <a className="botao" href={`/api/pdf/${pdf.atendimentoId}`} target="_blank" rel="noopener noreferrer" data-testid="relatorio-pdf-abrir">
              Abrir PDF
            </a>
            <a className="botao secundario" href={`/api/pdf/${pdf.atendimentoId}?download=1`} data-testid="relatorio-pdf-baixar">
              Baixar PDF
            </a>
          </span>
        )}
      </div>
      {erroMsg && (
        <p className="erro" role="alert" data-testid="relatorio-erro">
          {erroMsg}
        </p>
      )}
      {pdf && (
        <details className="avancado-pdf">
          <summary>Integridade do PDF</summary>
          <p className="nota">SHA-256 {pdf.sha256}</p>
        </details>
      )}
      {relatorio && (
        <div data-testid="relatorio-conteudo">
          <p className="nota" data-testid="relatorio-origem-prosa">
            {relatorio.prosa_origem === "llm"
              ? "Prosa redigida por modelo de linguagem; números conferidos com os dados."
              : relatorio.prosa_origem === "mock_substituto"
                ? "A prosa do modelo foi descartada (número fora dos dados ou saída inválida) e substituída pelo texto-padrão."
                : "Modo demonstração: texto-padrão sem LLM."}
          </p>
          {relatorio.parametros.nao_calibrado && <span className="selo-nao-calibrado">Coeficientes não calibrados</span>}
          {secoes.map((s) =>
            s.calculado ? (
              <div key={s.id} data-testid="relatorio-numero-calculado">
                <Secao s={s} />
              </div>
            ) : (
              <Secao key={s.id} s={s} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
