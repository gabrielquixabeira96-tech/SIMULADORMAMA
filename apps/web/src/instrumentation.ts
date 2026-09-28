/**
 * Validação na subida do servidor (ADR 0005): DESENHO inválido impede o processo de subir. No
 * modo demo sintética (ADR 0018), as checagens de ambiente e de dados também (assíncronas: banco).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validarAmbienteNaSubida } = await import("./config/subida");
    await validarAmbienteNaSubida();
  }
}
