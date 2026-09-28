"use client";

import { DEFINICOES_LANDMARKS, type LandmarkId, type Landmarks } from "@simulador/contratos";

/**
 * Figura-guia dos 10 pontos (plano P3, passo 2): torso esquemático desenhado por código (SVG, sem
 * imagem), pontos numerados na mesma ordem da lista, o ponto a marcar agora destacado e os já
 * marcados preenchidos. A lista mantém um `li` por ponto com o rótulo de DEFINICOES_LANDMARKS e
 * "✓" quando marcado (contrato C3, `landmarks-guia`), sem índice de vértice.
 */

/** Posição de cada ponto na figura (viewBox 0 0 200 200; a paciente de frente para quem olha). */
const POSICOES: Record<LandmarkId, [number, number]> = {
  furcula: [100, 36],
  mamilo_dir: [66, 104],
  mamilo_esq: [134, 104],
  sulco_dir: [66, 138],
  sulco_esq: [134, 138],
  linha_media_inferior: [100, 146],
  base_medial_dir: [88, 112],
  base_lateral_dir: [38, 108],
  base_medial_esq: [112, 112],
  base_lateral_esq: [162, 108],
};

/** Rótulo curto (figura e marcadores do 3D). */
export const ROTULO_CURTO: Record<LandmarkId, string> = {
  furcula: "Fúrcula",
  mamilo_dir: "Mamilo D",
  mamilo_esq: "Mamilo E",
  sulco_dir: "Sulco D",
  sulco_esq: "Sulco E",
  linha_media_inferior: "Linha média",
  base_medial_dir: "Base medial D",
  base_lateral_dir: "Base lateral D",
  base_medial_esq: "Base medial E",
  base_lateral_esq: "Base lateral E",
};

export const COR_OBRIGATORIO = "#d1242f";
export const COR_BASE = "#8250df";

export const numeroDoLandmark = (id: LandmarkId): number => DEFINICOES_LANDMARKS.findIndex((d) => d.id === id) + 1;

interface Props {
  landmarks: Landmarks;
  ativo: LandmarkId;
  onAtivar: (id: LandmarkId) => void;
  onApagar: (id: LandmarkId) => void;
  /** Sem malha aberta os itens ficam só de leitura. */
  desabilitado?: boolean;
}

export function FiguraGuia({ landmarks, ativo }: { landmarks: Landmarks; ativo: LandmarkId }) {
  return (
    <svg className="figura-guia" viewBox="0 0 200 200" role="img" aria-label="Figura-guia: posição dos 10 pontos no tórax, vista de frente">
      {/* contorno esquemático: pescoço, ombros, tronco e as duas mamas */}
      <path d="M84 8 L84 26 Q60 32 30 40 Q14 46 12 70 L20 196 L180 196 L188 70 Q186 46 170 40 Q140 32 116 26 L116 8" fill="#f3e6dc" stroke="#9a8578" strokeWidth="1.5" />
      <path d="M36 96 Q40 142 66 144 Q90 144 94 112" fill="none" stroke="#9a8578" strokeWidth="1.5" />
      <path d="M164 96 Q160 142 134 144 Q110 144 106 112" fill="none" stroke="#9a8578" strokeWidth="1.5" />
      <line x1="100" y1="36" x2="100" y2="160" stroke="#c9b6a8" strokeDasharray="3 3" />
      <text x="16" y="188" fontSize="9" fill="#57606a">D</text>
      <text x="178" y="188" fontSize="9" fill="#57606a">E</text>
      {/* legenda dentro da figura: vermelho = obrigatório, roxo = base da mama (opcional) */}
      <circle cx="40" cy="176" r="4" fill={COR_OBRIGATORIO} />
      <text x="47" y="179" fontSize="9" fill="#1c2128">obrigatório</text>
      <circle cx="108" cy="176" r="4" fill={COR_BASE} />
      <text x="115" y="179" fontSize="9" fill="#1c2128">base</text>
      {DEFINICOES_LANDMARKS.map((d, i) => {
        const [x, y] = POSICOES[d.id];
        const marcado = !!landmarks[d.id];
        const eAtivo = ativo === d.id && !marcado;
        const cor = d.obrigatorio ? COR_OBRIGATORIO : COR_BASE;
        return (
          <g key={d.id} className={eAtivo ? "ponto-guia ativo" : "ponto-guia"} aria-hidden="true">
            {eAtivo && <circle cx={x} cy={y} r={11} fill="none" stroke="#bf5b00" strokeWidth="2.5" />}
            <circle cx={x} cy={y} r={eAtivo ? 8 : 6.5} fill={marcado ? cor : "#ffffff"} stroke={cor} strokeWidth="1.8" />
            <text x={x} y={y + 2.8} fontSize="7.5" textAnchor="middle" fontWeight="700" fill={marcado ? "#ffffff" : cor}>
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function GuiaLandmarks({ landmarks, ativo, onAtivar, onApagar, desabilitado = false }: Props) {
  return (
    <div className="guia-landmarks" data-testid="landmarks-guia">
      <FiguraGuia landmarks={landmarks} ativo={ativo} />
      <div>
        <ol className="lista-landmarks">
          {DEFINICOES_LANDMARKS.map((d) => {
            const l = landmarks[d.id];
            return (
              <li key={d.id} className={ativo === d.id ? "ativo" : ""} data-marcado={l ? "1" : "0"}>
                <button type="button" className="item-landmark" onClick={() => onAtivar(d.id)} aria-current={ativo === d.id} title={d.instrucao} disabled={desabilitado}>
                  {d.rotulo}
                  {d.obrigatorio ? " *" : ""}
                </button>
                <span className="estado-landmark">{l ? "✓" : ""}</span>
                {l && (
                  <button type="button" className="link desmarcar" onClick={() => onApagar(d.id)} aria-label={`Desmarcar ${d.rotulo}`} title="Desmarcar">
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
