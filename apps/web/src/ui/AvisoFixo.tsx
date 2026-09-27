import { AVISO_FIXO, TEXTO_FAIXA_DEMO } from "@/config/aviso";

/**
 * Aviso fixo, sempre visível (restrição 3). Renderizado no layout raiz, em todas as telas. No modo
 * demonstração sintética (ADR 0018), acrescenta a faixa "DEMONSTRAÇÃO" acima do aviso.
 */
export function AvisoFixo({ versao, desenho, demo = false }: { versao: string; desenho: string; demo?: boolean }) {
  return (
    <div className={demo ? "aviso-fixo aviso-fixo-demo" : "aviso-fixo"} role="note" aria-live="polite" data-testid="aviso-fixo">
      {demo && (
        <div className="faixa-demo" data-testid="faixa-demo">
          {TEXTO_FAIXA_DEMO}
        </div>
      )}
      <strong>{AVISO_FIXO}</strong>
      <span className="aviso-meta">
        v{versao} · desenho {desenho}
      </span>
    </div>
  );
}
