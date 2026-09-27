"use client";

import { CAMPOS_DIGITADOS, type AlertaTepid, type CampoDigitado } from "@simulador/contratos";
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
}

/**
 * Formulário TEPID digitado (contratos §8). Campos, rótulos e faixas vêm de config/tepid.json
 * (via servidor). A nota "conferir no texto original" é sempre exibida. Os alertas TEPID/High
 * Five só existem em DESENHO=B.
 */
export function FormularioTepid({ recursos, tepid, valores, onChange, onAvaliar, avaliando, resultado, erros }: Props) {
  const set = (campo: CampoDigitado, lado: "dir" | "esq", v: string) => onChange({ ...valores, [campo]: { ...valores[campo], [lado]: v } });
  const erroDe = (campo: string, lado: string) => erros.find((e) => e.campo === campo && e.lado === lado)?.mensagem;
  return (
    <section className="painel" data-testid="tepid-form" aria-labelledby="titulo-tepid">
      <h3 id="titulo-tepid">TEPID — medidas digitadas (mm)</h3>
      <p className="nota nota-conferir" data-testid="tepid-nota">
        Limiares e tabelas de <code>config/tepid.json</code> ({tepid.status === "nao_conferido" ? "NÃO conferidos" : "conferidos"}): {tepid.nota}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAvaliar();
        }}
      >
        <table className="tabela">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Direita</th>
              <th>Esquerda</th>
            </tr>
          </thead>
          <tbody>
            {CAMPOS_DIGITADOS.map((campo) => {
              const def = tepid.campos[campo];
              if (!def) return null;
              return (
                <tr key={campo}>
                  <td>
                    <label htmlFor={`tepid-${campo}-dir`}>{def.rotulo}</label>
                    <div className="faixa">
                      {def.min}–{def.max} mm
                    </div>
                  </td>
                  {(["dir", "esq"] as const).map((lado) => (
                    <td key={lado}>
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
                      {erroDe(campo, lado) && <div className="erro">{erroDe(campo, lado)}</div>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="submit" disabled={avaliando}>
          {avaliando ? "Validando…" : recursos.alertas_tepid ? "Validar e avaliar alertas" : "Validar medidas"}
        </button>
      </form>
      {recursos.alertas_tepid && (
        <div className="alertas" data-testid="tepid-alertas" aria-live="polite">
          <h4>Alertas TEPID / High Five (apoio, nunca decisão)</h4>
          {!resultado && <p className="nota">Preencha e valide para ver os alertas.</p>}
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
    </section>
  );
}
