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

/** Cartões do passo 2: base em linha reta (como o paquímetro); as outras sobre a pele (como a fita) quando medidas. */
const CARTOES: { chave: string; titulo: string; dir: DistanciaId; esq: DistanciaId; sobrePele: boolean }[] = [
  { chave: "base", titulo: "Largura da base", dir: "base_dir", esq: "base_esq", sobrePele: false },
  { chave: "ssn_n", titulo: "Fúrcula–mamilo", dir: "ssn_n_dir", esq: "ssn_n_esq", sobrePele: true },
  { chave: "n_imf", titulo: "Mamilo–sulco", dir: "n_imf_dir", esq: "n_imf_esq", sobrePele: true },
];

/**
 * Medidas do passo 2 em cartões (1 casa decimal) + "Detalhes" com a tabela completa (linha reta e
 * sobre a pele). NÃO renderiza nada em DESENHO=A (medicao_automatica_3d off). Linha reta: calculada
 * no navegador. Sobre a pele: services/mesh (/medir), nunca Dijkstra do cliente.
 */
export function PainelDistancias({ recursos, euclidianas, medicao, estado, gabarito }: PropsDistancias) {
  if (!recursos.medicao_automatica_3d) return null;
  const valor = (id: DistanciaId, sobrePele: boolean): { v: number | null; como: string } => {
    const geo = medicao?.distancias[id]?.geodesica_mm ?? null;
    if (sobrePele && geo !== null) return { v: geo, como: "sobre a pele" };
    return { v: euclidianas?.[id] ?? null, como: "linha reta" };
  };
  return (
    <section className="cartoes-distancias" data-testid="distancias-painel" aria-labelledby="titulo-distancias">
      <h3 id="titulo-distancias" className="sr-only">
        Distâncias (mm)
      </h3>
      <div className="cartoes">
        {CARTOES.map((c) => {
          const d = valor(c.dir, c.sobrePele);
          const e = valor(c.esq, c.sobrePele);
          return (
            <div key={c.chave} className="cartao" data-testid={`cartao-${c.chave}`}>
              <div className="cartao-titulo">{c.titulo}</div>
              <div className="cartao-valores">
                <span>
                  D <strong className="num">{estado === "medindo" && c.sobrePele ? "…" : fmt(d.v)}</strong>
                </span>
                <span>
                  E <strong className="num">{estado === "medindo" && c.sobrePele ? "…" : fmt(e.v)}</strong>
                </span>
              </div>
              <div className="cartao-rodape">mm · {d.v === null && e.v === null ? (c.chave === "base" ? "marque os pontos da base" : "—") : d.como}</div>
            </div>
          );
        })}
      </div>
      <details className="detalhes-distancias">
        <summary>Detalhes (linha reta e sobre a pele)</summary>
        <table className="tabela">
          <thead>
            <tr>
              <th>Medida</th>
              <th title="Linha reta entre os dois pontos (calculada no navegador)">Linha reta</th>
              <th title="Caminho mais curto sobre a pele (calculado pelo serviço de medição)">Sobre a pele</th>
              {gabarito && <th title="Valor de referência do torso sintético">Referência</th>}
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
        <p className="nota">Sem os pontos da base, a largura da base fica em branco.</p>
      </details>
      {estado === "sem_servico" && <p className="aviso-servico">Serviço de medição indisponível: medidas sobre a pele e volume ficam em branco; nada é gravado sem ele.</p>}
      {estado === "erro" && <p className="erro">Falha ao medir.</p>}
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
    <section className="cartao cartao-volume" data-testid="volume-painel" aria-labelledby="titulo-volume">
      <h3 id="titulo-volume" className="cartao-titulo">
        Volume estimado (mL)
      </h3>
      <ul className="lista-volume">
        {(["dir", "esq"] as const).map((lado) => {
          const v = vols?.[lado] ?? null;
          return (
            <li key={lado} data-testid={`volume-${lado}`}>
              <span>{lado === "dir" ? "D" : "E"} </span>
              {v ? (
                <span className="num">
                  <strong>
                    {fmt(v.valor_ml)} ± {fmt(v.incerteza_ml)}
                  </strong>{" "}
                  <small>(faixa {fmt(v.valor_ml - v.incerteza_ml)}–{fmt(v.valor_ml + v.incerteza_ml)})</small>
                </span>
              ) : (
                <span className="num">
                  {estado === "medindo" ? "…" : "—"}
                  {medicao?.avisos.includes(`volume_${lado}:landmarks_da_base_ausentes`) && <small> (faltam os pontos da base)</small>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="cartao-rodape">estimativa geométrica, sempre com a faixa</div>
    </section>
  );
}
