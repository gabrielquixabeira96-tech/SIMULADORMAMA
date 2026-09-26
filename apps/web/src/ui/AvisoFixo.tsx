import { AVISO_FIXO } from "@/config/aviso";

/** Aviso fixo, sempre visível (restrição 3). Renderizado no layout raiz, em todas as telas. */
export function AvisoFixo({ versao, desenho }: { versao: string; desenho: string }) {
  return (
    <div className="aviso-fixo" role="note" aria-live="polite" data-testid="aviso-fixo">
      <strong>{AVISO_FIXO}</strong>
      <span className="aviso-meta">
        v{versao} · desenho {desenho}
      </span>
    </div>
  );
}
