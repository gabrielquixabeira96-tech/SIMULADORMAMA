import { AVISO_FIXO, TEXTO_FAIXA_DEMO } from "@/config/aviso";

/**
 * Aviso fixo, sempre visível (restrição 3). Renderizado no layout raiz, em todas as telas. No modo
 * demonstração sintética (ADR 0018), a faixa "DEMONSTRAÇÃO" fica na MESMA barra do aviso (uma linha
 * no iPad, ≤ 56 px), sem reduzir nem esconder nenhum dos dois textos. O desenho (A/B) vai só no
 * atributo `data-desenho` e no título (dica ao passar o mouse): não é texto para o cirurgião.
 */
export function AvisoFixo({ versao, desenho, demo = false }: { versao: string; desenho: string; demo?: boolean }) {
  return (
    <div
      className={demo ? "aviso-fixo aviso-fixo-demo" : "aviso-fixo"}
      role="note"
      aria-live="polite"
      data-testid="aviso-fixo"
      data-desenho={desenho}
      title={`versão ${versao} · configuração ${desenho}`}
    >
      {demo && (
        <span className="faixa-demo" data-testid="faixa-demo">
          {TEXTO_FAIXA_DEMO}
        </span>
      )}
      <strong className="aviso-texto">{AVISO_FIXO}</strong>
      <span className="aviso-meta">v{versao}</span>
    </div>
  );
}
