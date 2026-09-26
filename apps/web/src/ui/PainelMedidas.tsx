"use client";

import { DISTANCIA_IDS, ROTULOS_DISTANCIAS, type DistanciaId, type MedirResposta } from "@simulador/contratos";
import type { MapaRecursos } from "@/config/recursos";

export type EstadoMedicao = "ocioso" | "medindo" | "ok" | "erro" | "sem_servico";

const fmt = (v: number | null | undefined, casas = 1) => (v === null || v === undefined ? "—" : v.toFixed(casas).replace(".", ","));

interface PropsDistancias {
  recursos: MapaRecursos;
  euclidianas: Record<DistanciaId, number | null> | null;
  medicao: MedirResposta | null;
  estado: EstadoMedicao;
  gabarito?: Partial<Record<DistanciaId, { euclidiana_mm: number; geodesica_mm: number | null }>> | null;
}

/**
 * Painel de distâncias. NÃO renderiza nada em DESENHO=A (medicao_automatica_3d off).
 * Euclidianas: cliente. Geodésicas: services/mesh (/medir), nunca Dijkstra do cliente.
 */
export function PainelDistancias({ recursos, euclidianas, medicao, estado, gabarito }: PropsDistancias) {
  if (!recursos.medicao_automatica_3d) return null;
  return (
    <section className="painel" data-testid="distancias-painel" aria-labelledby="titulo-distancias">
      <h3 id="titulo-distancias">Distâncias (mm)</h3>
      <table className="tabela">
        <thead>
          <tr>
            <th>Medida</th>
            <th title="Linha reta entre os dois pontos (calculada no navegador)">Euclidiana</th>
            <th title="Caminho mais curto sobre a pele (calculado pelo serviço de malha)">Geodésica</th>
            {gabarito && <th title="Gabarito do torso sintético">Gabarito</th>}
          </tr>
        </thead>
        <tbody>
          {DISTANCIA_IDS.map((id) => {
            const geo = medicao?.distancias[id]?.geodesica_mm;
            return (
              <tr key={id} data-testid={`distancia-${id}`}>
                <td>{ROTULOS_DISTANCIAS[id]}</td>
                <td className="num">{fmt(euclidianas?.[id] ?? null)}</td>
                <td className="num">{estado === "medindo" ? "…" : fmt(geo ?? null)}</td>
                {gabarito && <td className="num">{fmt(gabarito[id]?.euclidiana_mm ?? null)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {estado === "sem_servico" && <p className="aviso-servico">Aguardando serviço de malha: geodésicas e volume indisponíveis; nada é gravado sem ele.</p>}
      {estado === "erro" && <p className="erro">Falha ao medir no serviço de malha.</p>}
      <p className="nota">Faltando landmarks da base → largura da base fica em branco.</p>
    </section>
  );
}

interface PropsVolume {
  recursos: MapaRecursos;
  medicao: MedirResposta | null;
  estado: EstadoMedicao;
}

/** Volume com faixa de incerteza, SEMPRE junto (restrição 3). Não renderiza em DESENHO=A. */
export function PainelVolume({ recursos, medicao, estado }: PropsVolume) {
  if (!recursos.volume_calculado) return null;
  const vols = medicao?.volumes ?? null;
  return (
    <section className="painel" data-testid="volume-painel" aria-labelledby="titulo-volume">
      <h3 id="titulo-volume">Volume estimado (mL)</h3>
      <ul className="lista-volume">
        {(["dir", "esq"] as const).map((lado) => {
          const v = vols?.[lado] ?? null;
          return (
            <li key={lado} data-testid={`volume-${lado}`}>
              <span>{lado === "dir" ? "Direita" : "Esquerda"}: </span>
              {v ? (
                <span className="num">
                  {fmt(v.valor_ml)} ± {fmt(v.incerteza_ml)} <small>(faixa {fmt(v.valor_ml - v.incerteza_ml)}–{fmt(v.valor_ml + v.incerteza_ml)})</small>
                </span>
              ) : (
                <span className="num">{estado === "medindo" ? "…" : "—"}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="nota">Estimativa geométrica (plano da base + elipse), exige os 4 landmarks da base. Nunca exibida sem a faixa de incerteza.</p>
    </section>
  );
}
