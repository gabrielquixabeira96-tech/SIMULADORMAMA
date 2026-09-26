/**
 * Validação na subida do servidor (ADR 0005): DESENHO inválido impede o processo de subir.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validarAmbienteNaSubida } = await import("./config/subida");
    validarAmbienteNaSubida();
  }
}
