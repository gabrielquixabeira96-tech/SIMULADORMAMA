"use client";

import { CAMPOS_DIGITADOS, type AlertaTepid, type CampoDigitado } from "@simulador/contratos";
import type { ReactNode } from "react";
import type { ConfigPublica } from "@/config/publica";
import type { MapaRecursos } from "@/config/recursos";

export type ValoresTepidForm = Record<CampoDigitado, { dir: string; esq: string }>;

export interface ReferenciaTabelaUI {
  tabela_id: string;
  descricao: string | null;
  lado: "dir" | "esq";
  saida: string;
  valor_saida: number | null;
}

export interface ResultadoTepidUI {
  alertas: AlertaTepid[];
  referencias: ReferenciaTabelaUI[];
}

export interface ErroCampoUI {
  campo: string;
  lado: string;
  mensagem: string;
}

export function valoresTepidVazios(): ValoresTepidForm {
  return Object.fromEntries(CAMPOS_DIGITADOS.map((c) => [c, { dir: "", esq: "" }])) as ValoresTepidForm;
}

interface Props {
  recursos: MapaRecursos;
  tepid: ConfigPublica["tepid"];
  valores: ValoresTepidForm;
  onChange: (v: ValoresTepidForm) => void;
  onAvaliar: () => void;
  avaliando: boolean;
  resultado: ResultadoTepidUI | null;
  erros: ErroCampoUI[];
  /**
   * Base pré-preenchida pela medida 3D (valor em texto, como no campo). Só existe em DESENHO=B:
   * com `medicao_automatica_3d` desligado a prop é IGNORADA (defesa em profundidade, ADR 0005).
   */
  basePreenchida?: { dir: string | null; esq: string | null } | null;
  /** Ações e mensagens logo abaixo do formulário (gravar TEPID, "Salvo ✓"), dentro da mesma seção. */
  rodape?: ReactNode;
}

/**
 * Formulário TEPID digitado (contratos §8) em grade compacta D/E. Campos, rótulos e faixas vêm da
 * configuração do servidor. A nota "conferir no texto original" é sempre exibida. Os alertas
 * TEPID/High Five só existem em DESENHO=B e aparecem também ao lado do campo que os disparou.
 */
export function FormularioTepid({ recursos, tepid, valores, onChange, onAvaliar, avaliando, resultado, erros, basePreenchida, rodape }: Props) {
  const set = (campo: CampoDigitado, lado: "dir" | "esq", v: string) => onChange({ ...valores, [campo]: { ...valores[campo], [lado]: v } });
  const erroDe = (campo: string, lado: string) => erros.find((e) => e.campo === campo && e.lado === lado)?.mensagem;
  const pre = recursos.medicao_automatica_3d ? (basePreenchida ?? null) : null;
  const preenchidoPelo3D = (campo: CampoDigitado, lado: "dir" | "esq") => campo === "base_mm" && !!pre?.[lado] && pre[lado] === valores[campo][lado];
  const alertasDe = (campo: string) => (recursos.alertas_tepid ? (resultado?.alertas ?? []).filter((a) => a.campo === campo) : []);
  const campos = CAMPOS_DIGITADOS.flatMap((campo) => {
    const def = tepid.campos[campo];
    return def ? [{ campo, def, alertas: alertasDe(campo) }] : [];
  });
  return (
    <section className="painel painel-tepid" data-testid="tepid-form" aria-labelledby="titulo-tepid">
      <div className="tepid-cabecalho">
        <h3 id="titulo-tepid">Medidas da consulta (TEPID, mm)</h3>
        <p className="nota nota-conferir" data-testid="tepid-nota">
          Limiares {tepid.status === "nao_conferido" ? "NÃO conferidos" : "conferidos"}: conferir no texto original.
        </p>
        <details className="fonte-tepid">
          <summary>Fonte dos limiares</summary>
          <p className="nota">
            <code>config/tepid.json</code> (versão {tepid.versao}): {tepid.nota}
          </p>
        </details>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAvaliar();
        }}
      >
        {/* grade compacta: uma coluna por medida, linhas D e E (cabe numa faixa no iPad) */}
        <div className="grade-tepid-rolagem">
          <table className="tabela tabela-tepid">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Lado</span>
                </th>
                {campos.map(({ campo, def, alertas }) => (
                  <th key={campo} scope="col" className={alertas.length > 0 ? "com-alerta" : undefined}>
                    <label htmlFor={`tepid-${campo}-dir`}>{def.rotulo}</label>
                    <span className="faixa">
                      {" "}
                      {def.min}–{def.max}
                    </span>
                    {alertas.length > 0 && (
                      <div className="alerta-campo" aria-hidden="true">
                        ⚠ {alertas.map((al) => (al.lado === "dir" ? "D" : al.lado === "esq" ? "E" : "")).join(" ")}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["dir", "esq"] as const).map((lado) => (
                <tr key={lado}>
                  <th scope="row">{lado === "dir" ? "D" : "E"}</th>
                  {campos.map(({ campo, def }) => (
                    <td key={campo}>
                      <input
                        id={`tepid-${campo}-${lado}`}
                        data-testid={`tepid-${campo}-${lado}`}
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min={def.min}
                        max={def.max}
                        required={def.obrigatorio}
                        aria-label={`${def.rotulo} (${lado === "dir" ? "direita" : "esquerda"}) em mm`}
                        aria-invalid={!!erroDe(campo, lado)}
                        value={valores[campo][lado]}
                        onChange={(e) => set(campo, lado, e.target.value)}
                      />
                      {preenchidoPelo3D(campo, lado) && (
                        <div className="pre-3d" data-testid={`tepid-base-pre-${lado}`}>
                          pré-preenchida pelo 3D — confirme
                        </div>
                      )}
                      {erroDe(campo, lado) && <div className="erro">{erroDe(campo, lado)}</div>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="linha-form">
          <button type="submit" className="secundario" disabled={avaliando}>
            {avaliando ? "Validando…" : recursos.alertas_tepid ? "Validar e avaliar alertas" : "Validar medidas"}
          </button>
          {rodape}
          {recursos.alertas_tepid && (
            <div className={resultado && (resultado.alertas.length > 0 || resultado.referencias.length > 0) ? "alertas alertas-lista" : "alertas"} data-testid="tepid-alertas" aria-live="polite">
              {!resultado && <span className="nota">Alertas TEPID / High Five (apoio, nunca decisão) aparecem ao validar.</span>}
              {resultado && resultado.alertas.length === 0 && <p className="nota">Nenhum alerta pelos limiares configurados.</p>}
              {resultado && resultado.alertas.length > 0 && (
                <ul>
                  {resultado.alertas.map((a) => (
                    <li key={`${a.regra_id}-${a.lado}`} className="alerta">
                      <strong>{a.lado === "dir" ? "D" : a.lado === "esq" ? "E" : ""}</strong> {a.alerta}
                      {a.conferir_no_texto_original && <em> (conferir no texto original)</em>}
                    </li>
                  ))}
                </ul>
              )}
              {resultado && resultado.referencias.length > 0 && (
                <details>
                  <summary>Tabelas de referência (conferir no texto original)</summary>
                  <ul>
                    {resultado.referencias.map((r) => (
                      <li key={`${r.tabela_id}-${r.lado}`}>
                        {r.tabela_id} ({r.lado}): {r.valor_saida === null ? "fora da faixa da tabela" : `${r.valor_saida} ${r.saida.endsWith("_ml") ? "mL" : "mm"}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
