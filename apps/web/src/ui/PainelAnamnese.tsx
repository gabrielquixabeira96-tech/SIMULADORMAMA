"use client";

import { useState } from "react";

/**
 * Painel de anamnese (Marco 2b). Autocontido: envia o texto livre a POST /api/llm/anamnese e
 * mostra o JSON estruturado (anamnese/1.0). O texto é higienizado no servidor antes do LLM e
 * não é gravado; ainda assim a UI pede para não digitar identificação.
 */

export interface AnamneseUI {
  esquema: "anamnese/1.0";
  queixa_principal: string;
  objetivo_estetico: string;
  tamanho_desejado_descricao: string | null;
  gestacoes: { numero: number | null; amamentou: boolean | null; planeja: string };
  cirurgias_mamarias_previas: string[];
  comorbidades_relatadas: string[];
  tabagismo: string;
  medicamentos: string[];
  alergias: string[];
  expectativas_irreais_sinalizadas: boolean;
  campos_nao_informados: string[];
  texto_fonte_hash: string;
}

export interface PropsPainelAnamnese {
  /** Paciente (pseudonimizado) do atendimento. */
  pacienteId: string;
  /** Atendimento em curso; ausente → o servidor cria um e devolve em `onRegistrada`. */
  atendimentoId?: string | null;
  /** Chamado após gravar; use para guardar o `atendimentoId` e passá-lo ao PainelRelatorio. */
  onRegistrada?: (r: { atendimentoId: string; anamnese: AnamneseUI; modo: "mock" | "anthropic" }) => void;
}

const ROTULOS_OBJETIVO: Record<string, string> = {
  aumento_discreto: "Aumento discreto",
  aumento_moderado: "Aumento moderado",
  aumento_marcado: "Aumento marcado",
  correcao_assimetria: "Correção de assimetria",
  outro: "Outro / não informado",
};

const lista = (xs: string[]) => (xs.length ? xs.join("; ") : "—");
const simNao = (b: boolean | null) => (b === null ? "não informado" : b ? "sim" : "não");

export function PainelAnamnese({ pacienteId, atendimentoId, onRegistrada }: PropsPainelAnamnese) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ anamnese: AnamneseUI; modo: string } | null>(null);

  async function enviar() {
    setEnviando(true);
    setErroMsg(null);
    try {
      const r = await fetch("/api/llm/anamnese", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paciente_id: pacienteId, atendimento_id: atendimentoId ?? null, texto }),
      });
      const corpo = (await r.json()) as { atendimento_id?: string; anamnese?: AnamneseUI; modo?: "mock" | "anthropic"; erro?: { codigo: string; mensagem?: string } };
      if (!r.ok || !corpo.anamnese || !corpo.atendimento_id) {
        setErroMsg(corpo.erro?.mensagem ?? corpo.erro?.codigo ?? `falha (${r.status})`);
        return;
      }
      setResultado({ anamnese: corpo.anamnese, modo: corpo.modo ?? "mock" });
      setTexto(""); // o texto bruto não fica na tela depois de estruturado
      onRegistrada?.({ atendimentoId: corpo.atendimento_id, anamnese: corpo.anamnese, modo: corpo.modo ?? "mock" });
    } catch {
      setErroMsg("falha de rede ao estruturar a anamnese");
    } finally {
      setEnviando(false);
    }
  }

  const a = resultado?.anamnese;
  return (
    <section className="painel" data-testid="painel-anamnese" aria-labelledby="titulo-anamnese">
      <h3 id="titulo-anamnese">Anamnese</h3>
      <p className="nota">Não digite nome, CPF, telefone, e-mail ou datas de nascimento. Esses padrões são removidos antes do processamento e o texto livre não é gravado.</p>
      <label htmlFor="anamnese-texto">Texto livre da consulta</label>
      <textarea
        id="anamnese-texto"
        data-testid="anamnese-texto"
        rows={6}
        style={{ width: "100%" }}
        value={texto}
        maxLength={20000}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="par-botoes">
        <button type="button" data-testid="anamnese-enviar" disabled={enviando || texto.trim() === ""} onClick={enviar}>
          {enviando ? "Estruturando…" : "Estruturar anamnese"}
        </button>
      </div>
      {erroMsg && (
        <p className="erro" role="alert" data-testid="anamnese-erro">
          {erroMsg}
        </p>
      )}
      {a && (
        <div data-testid="anamnese-resultado">
          <p className="nota" data-testid="anamnese-modo">
            {resultado?.modo === "mock" ? "Modo demonstração (mock determinístico, sem LLM)." : "Estruturado por modelo de linguagem a partir de texto pseudonimizado; revise antes de usar."}
          </p>
          <table className="tabela">
            <tbody>
              <tr>
                <th>Queixa principal</th>
                <td data-testid="anamnese-queixa">{a.queixa_principal || "—"}</td>
              </tr>
              <tr>
                <th>Objetivo estético</th>
                <td data-testid="anamnese-objetivo">{ROTULOS_OBJETIVO[a.objetivo_estetico] ?? a.objetivo_estetico}</td>
              </tr>
              <tr>
                <th>Tamanho desejado</th>
                <td>{a.tamanho_desejado_descricao ?? "—"}</td>
              </tr>
              <tr>
                <th>Gestações</th>
                <td>
                  número: {a.gestacoes.numero ?? "não informado"}; amamentou: {simNao(a.gestacoes.amamentou)}; planeja: {a.gestacoes.planeja}
                </td>
              </tr>
              <tr>
                <th>Tabagismo</th>
                <td data-testid="anamnese-tabagismo">{a.tabagismo}</td>
              </tr>
              <tr>
                <th>Cirurgias mamárias prévias</th>
                <td>{lista(a.cirurgias_mamarias_previas)}</td>
              </tr>
              <tr>
                <th>Comorbidades relatadas</th>
                <td>{lista(a.comorbidades_relatadas)}</td>
              </tr>
              <tr>
                <th>Medicamentos</th>
                <td>{lista(a.medicamentos)}</td>
              </tr>
              <tr>
                <th>Alergias</th>
                <td>{lista(a.alergias)}</td>
              </tr>
              <tr>
                <th>Expectativas irreais sinalizadas</th>
                <td>{a.expectativas_irreais_sinalizadas ? "sim — conversar" : "não"}</td>
              </tr>
              <tr>
                <th>Não informado</th>
                <td>{lista(a.campos_nao_informados)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
