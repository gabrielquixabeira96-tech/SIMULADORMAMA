import { ProvedorAnthropic, configAnthropicDoEnv, type ClienteMensagens } from "./anthropic";
import { ProvedorMock } from "./mock";
import { modoLLM, type ProvedorLLM } from "./provedor";

/**
 * Provedor conforme o ambiente (ADR 0006): `LLM_MODO=mock` ou sem `ANTHROPIC_API_KEY` → mock.
 * `cliente` só é usado em testes (cliente falso que captura o payload).
 */
export function obterProvedor(env: NodeJS.ProcessEnv = process.env, cliente?: ClienteMensagens): ProvedorLLM {
  if (modoLLM(env) === "mock") return new ProvedorMock();
  return new ProvedorAnthropic(configAnthropicDoEnv(env), cliente);
}
