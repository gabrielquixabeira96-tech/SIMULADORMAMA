import type { CampoTepid, Desenho } from "@simulador/contratos";
import { versaoSoftware } from "./ambiente";
import { AVISO_FIXO } from "./aviso";
import { carregarConfigSimulacaoUI, carregarTepidConfig } from "./arquivosConfig";
import { demoAtiva } from "./demo";
import { getDesenho } from "./desenho";
import { recursosDoDesenho, type MapaRecursos } from "./recursos";

export { AVISO_FIXO };

/** O que o cliente recebe do servidor (via prop de Server Component ou GET /api/config). */
export interface ConfigPublica {
  desenho: Desenho;
  recursos: MapaRecursos;
  versao_software: string;
  aviso_fixo: string;
  envelope_rms_mm: number;
  volume_relativa_fator: number;
  /** Modo demonstração sintética (ADR 0018): a UI esconde o upload e a anamnese em texto livre. */
  demo: boolean;
  tepid: {
    versao: string;
    status: "nao_conferido" | "conferido";
    nota: string;
    fonte_referencia: string;
    campos: Record<string, CampoTepid>;
  };
}

export function configPublica(): ConfigPublica {
  const desenho = getDesenho();
  const sim = carregarConfigSimulacaoUI();
  const tepid = carregarTepidConfig();
  return {
    desenho,
    recursos: recursosDoDesenho(desenho),
    versao_software: versaoSoftware(),
    aviso_fixo: AVISO_FIXO,
    envelope_rms_mm: sim.envelope_rms_mm,
    volume_relativa_fator: sim.volume_relativa_fator,
    demo: demoAtiva(),
    tepid: {
      versao: tepid.versao,
      status: tepid.status,
      nota: tepid.fonte.nota,
      fonte_referencia: tepid.fonte.referencia,
      campos: tepid.campos,
    },
  };
}
