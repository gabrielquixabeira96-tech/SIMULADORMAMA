import { configPublica } from "@/config/publica";
import { Consulta } from "@/ui/Consulta";

// DESENHO é lido em runtime no servidor (ADR 0005): a página nunca é pré-renderizada no build.
export const dynamic = "force-dynamic";

export default function PaginaConsulta() {
  const config = configPublica();
  return (
    <>
      <header className="cabecalho">
        <h1>Consulta — simulador de mamoplastia de aumento</h1>
        <p className="nota">
          Desenho {config.desenho}
          {config.desenho === "A" ? ": o cirurgião digita as medidas e escolhe o implante; nada é calculado a partir do 3D." : ": medição 3D, volume e alertas TEPID ativos."}
          {" "}Envelope de incerteza da simulação: ±{String(config.envelope_rms_mm).replace(".", ",")} mm RMS.
        </p>
        {config.recursos.medicao_automatica_3d && (
          <p className="nota">
            <a href="/validacao/bland-altman" data-testid="link-validacao">
              Validação das medidas: sessão de Bland-Altman e planilha do art. 5º
            </a>
          </p>
        )}
      </header>
      <Consulta config={config} />
    </>
  );
}
