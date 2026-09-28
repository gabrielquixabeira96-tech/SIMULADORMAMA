import { readFile } from "node:fs/promises";
import { modoDemoSintetica } from "@/seguranca/requisicao";
import { caminhoEmDataDir } from "./ambiente";

/**
 * Modo "demonstração sintética" (ADR 0018): `DEMO_SINTETICA=1`, desligado por padrão. Instância
 * dedicada, exposta pela rede (ex.: Vercel Sandbox por HTTPS), só com torsos sintéticos gerados
 * pelo services/mesh. Sem a variável, nada daqui muda o comportamento do modo local.
 */

export { TEXTO_FAIXA_DEMO } from "./aviso";

export function demoAtiva(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return modoDemoSintetica(env);
}

const NOME_TORSO = /^[a-z0-9_]+$/;
/** Versões aceitas de `parametros.json` de um torso gerado (1.1 = 1.0 + `forma`/`parede` opcionais). */
const ESQUEMAS_PARAMETROS = new Set(["torso_parametros/1.0", "torso_parametros/1.1"]);

/**
 * O torso foi gerado pelo services/mesh (`mesh.cli torso`)? Exige `parametros.json` com
 * `esquema: "torso_parametros/1.0"` ou `"torso_parametros/1.1"` (fatores de forma opcionais do
 * template ajustado a fotos, contratos §4.1) e o mesmo `nome` da pasta. Um scan real copiado para
 * `sinteticos/` não tem esse arquivo.
 */
export async function torsoGerado(nome: string): Promise<boolean> {
  if (!NOME_TORSO.test(nome)) return false;
  try {
    const p = JSON.parse(await readFile(caminhoEmDataDir(`sinteticos/${nome}/parametros.json`), "utf8")) as { esquema?: unknown; nome?: unknown };
    return ESQUEMAS_PARAMETROS.has(p.esquema as string) && p.nome === nome;
  } catch {
    return false;
  }
}

/** No modo demo, só torsos gerados pelo services/mesh são utilizáveis; fora dele, todos (v0.1.2). */
export async function torsoUtilizavel(nome: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<boolean> {
  return demoAtiva(env) ? torsoGerado(nome) : true;
}
