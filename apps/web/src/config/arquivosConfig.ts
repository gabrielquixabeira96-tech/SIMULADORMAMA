import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tepidConfigSchema, type TepidConfig } from "@simulador/contratos";
import { z } from "zod";
import { raizRepo } from "./ambiente";

function lerConfig(nome: string): unknown {
  const dir = process.env.CONFIG_DIR ? resolve(/*turbopackIgnore: true*/ process.env.CONFIG_DIR) : resolve(/*turbopackIgnore: true*/ raizRepo(), "config");
  return JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ dir, nome), "utf8"));
}

/**
 * config/tepid.json validado. Os números NUNCA são copiados para o código (contratos §8);
 * o arquivo é lido a cada chamada para refletir a conferência mais recente.
 */
export function carregarTepidConfig(): TepidConfig {
  return tepidConfigSchema.parse(lerConfig("tepid.json"));
}

const incertezaSchema = z.object({
  versao: z.string(),
  incerteza: z.object({
    envelope_rms_mm: z.object({ valor: z.number().positive(), fonte: z.string(), configuravel: z.boolean() }),
    volume_relativa_fator: z.object({ valor: z.number().nonnegative() }).passthrough(),
    aviso_fixo: z.string().min(1),
  }),
  imf: z.object({ opcoes: z.array(z.string()) }).passthrough(),
});

export interface ConfigSimulacaoUI {
  versao: string;
  envelope_rms_mm: number;
  envelope_fonte: string;
  volume_relativa_fator: number;
  aviso_fixo: string;
  imf_opcoes: string[];
}

/** O web lê de config/simulacao.json apenas incerteza e imf.opcoes (contratos §9). */
export function carregarConfigSimulacaoUI(): ConfigSimulacaoUI {
  const c = incertezaSchema.parse(lerConfig("simulacao.json"));
  const sobrescrito = Number(process.env.ENVELOPE_RMS_MM);
  const podeSobrescrever = c.incerteza.envelope_rms_mm.configuravel && Number.isFinite(sobrescrito) && sobrescrito > 0;
  return {
    versao: c.versao,
    envelope_rms_mm: podeSobrescrever ? sobrescrito : c.incerteza.envelope_rms_mm.valor,
    envelope_fonte: c.incerteza.envelope_rms_mm.fonte,
    volume_relativa_fator: c.incerteza.volume_relativa_fator.valor,
    aviso_fixo: c.incerteza.aviso_fixo,
    imf_opcoes: c.imf.opcoes,
  };
}
