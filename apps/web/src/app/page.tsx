import { configPublica } from "@/config/publica";
import { Consulta } from "@/ui/Consulta";

// DESENHO é lido em runtime no servidor (ADR 0005): a página nunca é pré-renderizada no build.
export const dynamic = "force-dynamic";

export default function PaginaConsulta() {
  const config = configPublica();
  return (
    <>
      <header className="cabecalho" data-desenho={config.desenho}>
        <h1>Simulador de mamoplastia de aumento</h1>
        {config.recursos.medicao_automatica_3d && (
          <a href="/validacao/bland-altman" className="link-discreto" data-testid="link-validacao">
            Validação das medidas (pesquisa)
          </a>
        )}
      </header>
      <Consulta config={config} />
    </>
  );
}
