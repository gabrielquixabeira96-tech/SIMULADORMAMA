import { z } from "zod";
import { vetor3Schema } from "./comum";

/**
 * Landmarks canônicos (contratos §2), na ordem da sequência guiada da UI.
 * Os 6 primeiros são obrigatórios; os 4 da base são opcionais.
 */
export const LANDMARK_IDS = [
  "furcula",
  "mamilo_dir",
  "mamilo_esq",
  "sulco_dir",
  "sulco_esq",
  "linha_media_inferior",
  "base_medial_dir",
  "base_lateral_dir",
  "base_medial_esq",
  "base_lateral_esq",
] as const;

export const landmarkIdSchema = z.enum(LANDMARK_IDS);
export type LandmarkId = z.infer<typeof landmarkIdSchema>;

export const LANDMARKS_OBRIGATORIOS: readonly LandmarkId[] = [
  "furcula",
  "mamilo_dir",
  "mamilo_esq",
  "sulco_dir",
  "sulco_esq",
  "linha_media_inferior",
];

export interface DefinicaoLandmark {
  id: LandmarkId;
  obrigatorio: boolean;
  lado: "dir" | "esq" | null;
  rotulo: string;
  instrucao: string;
}

export const DEFINICOES_LANDMARKS: readonly DefinicaoLandmark[] = [
  { id: "furcula", obrigatorio: true, lado: null, rotulo: "Fúrcula (SSN)", instrucao: "Ponto mais profundo da incisura jugular, na linha média." },
  { id: "mamilo_dir", obrigatorio: true, lado: "dir", rotulo: "Mamilo direito", instrucao: "Centro do mamilo DIREITO da paciente (à esquerda de quem olha de frente)." },
  { id: "mamilo_esq", obrigatorio: true, lado: "esq", rotulo: "Mamilo esquerdo", instrucao: "Centro do mamilo ESQUERDO da paciente (à direita de quem olha de frente)." },
  { id: "sulco_dir", obrigatorio: true, lado: "dir", rotulo: "Sulco inframamário direito", instrucao: "Ponto mais inferior da prega, na vertical do mamilo direito." },
  { id: "sulco_esq", obrigatorio: true, lado: "esq", rotulo: "Sulco inframamário esquerdo", instrucao: "Ponto mais inferior da prega, na vertical do mamilo esquerdo." },
  { id: "linha_media_inferior", obrigatorio: true, lado: null, rotulo: "Linha média inferior", instrucao: "Linha média esternal ao nível dos sulcos (aprox. xifoide)." },
  { id: "base_medial_dir", obrigatorio: false, lado: "dir", rotulo: "Base medial direita", instrucao: "Borda medial da base direita, no plano horizontal do mamilo." },
  { id: "base_lateral_dir", obrigatorio: false, lado: "dir", rotulo: "Base lateral direita", instrucao: "Borda lateral da base direita, no plano horizontal do mamilo." },
  { id: "base_medial_esq", obrigatorio: false, lado: "esq", rotulo: "Base medial esquerda", instrucao: "Borda medial da base esquerda, no plano horizontal do mamilo." },
  { id: "base_lateral_esq", obrigatorio: false, lado: "esq", rotulo: "Base lateral esquerda", instrucao: "Borda lateral da base esquerda, no plano horizontal do mamilo." },
];

export const origemLandmarkSchema = z.enum(["clique", "gabarito", "automatico", "foto"]);

export const landmarkSchema = z.strictObject({
  posicao: vetor3Schema,
  vertice: z.number().int().min(0),
  origem: origemLandmarkSchema,
});
export type Landmark = z.infer<typeof landmarkSchema>;

/** Mapa de landmarks; chaves fora da tabela canônica são rejeitadas (contratos §2). */
export const landmarksSchema = z.partialRecord(landmarkIdSchema, landmarkSchema).superRefine((obj, ctx) => {
  for (const k of Object.keys(obj)) {
    if (!(LANDMARK_IDS as readonly string[]).includes(k)) {
      ctx.addIssue({ code: "custom", message: `landmark desconhecido: ${k}`, path: [k] });
    }
  }
});
export type Landmarks = Partial<Record<LandmarkId, Landmark>>;
