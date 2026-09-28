"use client";

import { useState } from "react";

export interface PacienteResumo {
  id: string;
  pseudonimo: string;
  criado_em?: string;
}

const dataCurta = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * Início da consulta (plano P3): um botão "Nova simulação" (gera o pseudônimo) e, recolhida, a lista
 * de atendimentos recentes (só pseudônimo e data, via GET /api/pacientes, buscada quando aberta).
 * O vínculo com a identidade fica no prontuário, fora deste sistema.
 */
export function Inicio({ paciente, onNovo, onRetomar, ocupado, demo = false }: { paciente: PacienteResumo | null; onNovo: () => void; onRetomar: (p: PacienteResumo) => void; ocupado: boolean; demo?: boolean }) {
  const [recentes, setRecentes] = useState<PacienteResumo[] | null>(null);
  const [erro, setErro] = useState(false);

  async function carregarRecentes() {
    if (recentes) return;
    try {
      const r = await fetch("/api/pacientes");
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { pacientes: PacienteResumo[] };
      const ordenados = [...j.pacientes].sort((a, b) => String(b.criado_em ?? "").localeCompare(String(a.criado_em ?? "")));
      setRecentes(ordenados.slice(0, 6));
    } catch {
      setErro(true);
    }
  }

  if (paciente) {
    return (
      <p className="paciente-atual">
        Paciente <strong data-testid="pseudonimo">{paciente.pseudonimo}</strong>
        <span className="nota"> · pseudônimo; o vínculo com a identidade fica no prontuário.</span>
      </p>
    );
  }
  return (
    <div className="inicio">
      <button type="button" className="primario" onClick={onNovo} disabled={ocupado} data-testid="nova-simulacao">
        Nova simulação
      </button>
      {/* na demonstração (ADR 0018) não há atendimento a retomar: cada visita começa do zero */}
      {!demo && (
        <details className="recentes" onToggle={(e) => (e.currentTarget.open ? void carregarRecentes() : undefined)}>
          <summary>Retomar atendimento recente</summary>
          {erro && <p className="erro">Não foi possível listar os atendimentos.</p>}
          {!erro && !recentes && <p className="nota">Carregando…</p>}
          {recentes && recentes.length === 0 && <p className="nota">Nenhum atendimento ainda.</p>}
          {recentes && recentes.length > 0 && (
            <ul className="lista-recentes">
              {recentes.map((p) => (
                <li key={p.id}>
                  <button type="button" className="secundario" onClick={() => onRetomar(p)}>
                    {p.pseudonimo}
                    <span className="nota"> {dataCurta(p.criado_em)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
