import {
  medidasSchema,
  vetor3Schema,
  type Desenho,
  type Escala,
  type Landmarks,
  type MalhaMeta,
  type Medidas,
  type MedidasDigitadas,
  type MedirResposta,
} from "@simulador/contratos";
import { recursoAtivoEm } from "@/config/recursos";
import { quadroAnatomico } from "./geometria";

/** Escala do registro a partir do histórico de /reescalar gravado em meta.json. */
export function escalaDaMeta(meta: MalhaMeta, sintetica: boolean): Escala {
  const hist = meta.escala?.historico ?? [];
  const ultimo = hist[hist.length - 1];
  if (ultimo) {
    const regua = (ultimo.regua ?? {}) as { regua_mm?: unknown; pontos?: unknown };
    const pontos = vetor3Schema.array().length(2).safeParse(regua.pontos);
    return {
      metodo: "regua_2_pontos",
      regua_mm: typeof regua.regua_mm === "number" ? regua.regua_mm : null,
      pontos: pontos.success ? [pontos.data[0]!, pontos.data[1]!] : null,
      fator: ultimo.fator,
      aplicado_em: ultimo.aplicado_em,
    };
  }
  return { metodo: sintetica ? "gabarito" : "nenhuma", regua_mm: null, pontos: null, fator: 1, aplicado_em: null };
}

export interface EntradaRegistro {
  medidaId: string;
  malhaId: string;
  pseudonimo: string;
  desenho: Desenho;
  versaoSoftware: string;
  versaoConfig: { tepid: string; simulacao: string };
  quadro: "scan" | "anatomico";
  geradoEm: string;
  usuarioId: string;
  escala: Escala;
  landmarks: Landmarks;
  medidasDigitadas: MedidasDigitadas | null;
  /** Resultado de /medir (só existe em B). */
  medicao: MedirResposta | null;
}

/**
 * Monta e VALIDA o registro medidas/1.0. Em DESENHO=A `distancias`, `volumes` e `geodesica`
 * são sempre null, independentemente do que vier em `medicao` (ADR 0005).
 */
export function montarRegistroMedidas(e: EntradaRegistro): Medidas {
  const medir = recursoAtivoEm(e.desenho, "medicao_automatica_3d");
  const volume = recursoAtivoEm(e.desenho, "volume_calculado");
  const m = medir ? e.medicao : null;
  const registro = {
    esquema: "medidas/1.0" as const,
    medida_id: e.medidaId,
    malha_id: e.malhaId,
    pseudonimo: e.pseudonimo,
    desenho: e.desenho,
    versao_software: e.versaoSoftware,
    versao_config: e.versaoConfig,
    unidade: "mm" as const,
    quadro: e.quadro,
    gerado_em: e.geradoEm,
    gerado_por: { componente: "web" as const, usuario_id: e.usuarioId },
    escala: e.escala,
    landmarks: e.landmarks,
    quadro_anatomico: m?.quadro_anatomico ?? quadroAnatomico(e.landmarks),
    distancias: m ? m.distancias : null,
    volumes: m && volume ? m.volumes : null,
    geodesica: m ? m.geodesica : null,
    medidas_digitadas: e.medidasDigitadas,
  };
  return medidasSchema.parse(registro);
}
