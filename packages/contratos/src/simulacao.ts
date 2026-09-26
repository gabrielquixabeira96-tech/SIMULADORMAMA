/**
 * Interfaces de simulação (contratos §12.2). O viewer só conhece `FonteDeformacao`.
 * Implementações reais (morph targets) chegam no Marco 2; o surrogate é fase 6.
 */
export type Plano = "subglandular" | "dual_plane";
export type Imf = "manter" | "rebaixar";
export type Lado = "ambos" | "dir" | "esq";

export interface PrevistoMorph {
  delta_projecao_mamilo_mm: { dir: number; esq: number };
  delta_y_sulco_mm: { dir: number; esq: number };
  delta_y_mamilo_mm: { dir: number; esq: number };
}

export interface FonteDeformacao {
  readonly modelo: "morph_targets_v1" | "surrogate_onnx_web_v1";
  carregar(malhaId: string, plano: Plano, imf: Imf): Promise<void>;
  /** peso ∈ [0, 1] */
  aplicar(implanteId: string, lado: Lado, peso: number): void;
  previsto(implanteId: string, lado: Lado): PrevistoMorph | null;
}

/** Interface vazia do surrogate (fase 6). */
export class SurrogateOnnxWeb implements FonteDeformacao {
  readonly modelo = "surrogate_onnx_web_v1" as const;
  carregar(): Promise<void> {
    throw new Error("nao_implementado");
  }
  aplicar(): void {
    throw new Error("nao_implementado");
  }
  previsto(): PrevistoMorph | null {
    throw new Error("nao_implementado");
  }
}
