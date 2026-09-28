"use client";

import { useEffect, useState } from "react";

/**
 * Barra fixa dos 3 passos (plano P3): "1 Captura · 2 Medidas · 3 Simulação", ✓ por passo e um
 * botão "Próximo" que rola até a seção seguinte e põe o foco no primeiro controle dela. Quando o
 * passo atual ainda não permite seguir, o botão fica desabilitado e o motivo aparece em uma linha.
 *
 * Os passos são SEÇÕES da mesma página (`section[data-passo]`), não abas: todo o conteúdo
 * continua no DOM (estado preservado, e2e estáveis); o passo ativo vem da rolagem (scroll-spy).
 */
export interface PassoInfo {
  n: 1 | 2 | 3;
  titulo: string;
  /** Passo concluído (✓). */
  feito: boolean;
  /** Por que ainda não dá para seguir deste passo para o próximo; null = pode seguir. */
  motivo: string | null;
}

const seletor = (n: number) => `section[data-passo="${n}"]`;

function reduzirMovimento(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rola até a seção do passo e foca o primeiro controle habilitado (sem rolar de novo). */
export function irParaPasso(n: number): void {
  const el = document.querySelector<HTMLElement>(seletor(n));
  if (!el) return;
  el.scrollIntoView({ behavior: reduzirMovimento() ? "auto" : "smooth", block: "start" });
  const alvo = el.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, a[href]");
  (alvo ?? el).focus({ preventScroll: true });
}

/** Passo cuja seção ocupa o topo da área visível (abaixo das barras fixas). */
function passoNoTopo(total: number): number {
  const barra = document.querySelector<HTMLElement>(".passos");
  const topo = (barra?.getBoundingClientRect().bottom ?? 0) + 8;
  let ativo = 1;
  for (let n = 1; n <= total; n++) {
    const el = document.querySelector<HTMLElement>(seletor(n));
    if (el && el.getBoundingClientRect().top <= topo + window.innerHeight * 0.25) ativo = n;
  }
  // fim da página: o último passo é o ativo mesmo que a seção seja curta
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) ativo = total;
  return ativo;
}

export function Passos({ passos }: { passos: PassoInfo[] }) {
  const [ativo, setAtivo] = useState(1);

  useEffect(() => {
    let pendente = 0;
    const atualizar = () => {
      cancelAnimationFrame(pendente);
      pendente = requestAnimationFrame(() => setAtivo(passoNoTopo(passos.length)));
    };
    atualizar();
    window.addEventListener("scroll", atualizar, { passive: true });
    window.addEventListener("resize", atualizar);
    return () => {
      cancelAnimationFrame(pendente);
      window.removeEventListener("scroll", atualizar);
      window.removeEventListener("resize", atualizar);
    };
  }, [passos.length]);

  const atual = passos.find((p) => p.n === ativo) ?? passos[0]!;
  const ultimo = atual.n === passos.length;
  const motivo = ultimo ? null : atual.motivo;

  return (
    <nav className="passos" aria-label="Passos da consulta" data-testid="passos">
      <ol className="passos-lista">
        {passos.map((p) => (
          <li key={p.n}>
            <button
              type="button"
              className="passo"
              data-testid={`passo-${p.n}`}
              data-feito={p.feito ? "1" : "0"}
              aria-current={p.n === ativo ? "step" : undefined}
              onClick={() => irParaPasso(p.n)}
            >
              <span className="passo-num" aria-hidden="true">
                {p.feito ? "✓" : p.n}
              </span>
              <span className="passo-titulo">{p.titulo}</span>
              {p.feito && <span className="sr-only"> (concluído)</span>}
            </button>
          </li>
        ))}
      </ol>
      <div className="passos-acao">
        {motivo && (
          <span className="passo-motivo" data-testid="passo-motivo" role="note">
            {motivo}
          </span>
        )}
        {!ultimo && (
          <button type="button" className="passo-proximo" data-testid="passo-proximo" disabled={!!motivo} onClick={() => irParaPasso(atual.n + 1)}>
            Próximo
          </button>
        )}
      </div>
    </nav>
  );
}
