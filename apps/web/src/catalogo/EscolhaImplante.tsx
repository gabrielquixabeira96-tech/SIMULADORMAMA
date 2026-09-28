"use client";

import { useMemo, useState } from "react";
import {
  filtrarCatalogo,
  NOTA_CATALOGO,
  opcoesDoCatalogo,
  type FiltroCatalogo,
  type ImplanteCatalogo,
} from "@simulador/contratos";
import css from "@/simulacao/foto.module.css";

/**
 * Escolha MANUAL de implante (contratos §11; ADR 0005: permitida em A e B). Lista o catálogo na
 * ordem neutra recebida (por id), só filtra; nada de ranking, pontuação ou "recomendado". Os
 * "EXEMPLO NÃO CLÍNICO" vão para o fim da lista. Com a base medida no 3D (só quando a medição
 * automática existe; o chamador passa null no outro desenho), o catálogo abre filtrado pela base
 * ±10 mm, e o filtro pode ser desligado com um toque.
 * Os dados vêm do servidor (`GET /api/catalogo` ou prop de Server Component).
 */
interface Props {
  implantes: readonly ImplanteCatalogo[];
  selecionado: string | null;
  onEscolher: (id: string) => void;
  /** largura da base medida (mm) por lado; null/ausente = sem filtro pela base */
  baseMedidaMm?: { dir: number; esq: number } | null;
}

/** Tolerância do filtro pela base medida (mm). */
export const TOLERANCIA_BASE_MM = 10;

export function faixaDaBase(b: { dir: number; esq: number } | null | undefined): { min: number; max: number; media: number } | null {
  if (!b || !Number.isFinite(b.dir) || !Number.isFinite(b.esq) || b.dir <= 0 || b.esq <= 0) return null;
  return { min: Math.min(b.dir, b.esq) - TOLERANCIA_BASE_MM, max: Math.max(b.dir, b.esq) + TOLERANCIA_BASE_MM, media: (b.dir + b.esq) / 2 };
}

const ROTULO_PERFIL: Record<string, string> = {
  baixo: "baixo",
  baixo_moderado: "baixo-moderado",
  moderado: "moderado",
  moderado_alto: "moderado-alto",
  alto: "alto",
  extra_alto: "extra-alto",
  outro: "outro",
};

const numero = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));

export function EscolhaImplante({ implantes, selecionado, onEscolher, baseMedidaMm }: Props) {
  const opcoes = useMemo(() => opcoesDoCatalogo(implantes), [implantes]);
  const [texto, setTexto] = useState("");
  const [fabricante, setFabricante] = useState("");
  const [forma, setForma] = useState("");
  const [perfil, setPerfil] = useState("");
  const [volMin, setVolMin] = useState("");
  const [volMax, setVolMax] = useState("");
  const [usarBase, setUsarBase] = useState(true);
  const faixaBase = useMemo(() => faixaDaBase(baseMedidaMm), [baseMedidaMm]);
  const filtrandoBase = !!faixaBase && usarBase;

  const { lista, erro } = useMemo(() => {
    const vmin = numero(volMin);
    const vmax = numero(volMax);
    const filtro: FiltroCatalogo = {
      ...(texto.trim() && { texto }),
      ...(fabricante && { fabricante: [fabricante] }),
      ...(forma && { forma: [forma as ImplanteCatalogo["forma"]] }),
      ...(perfil && { perfil: [perfil as ImplanteCatalogo["perfil"]] }),
      ...((vmin !== undefined || vmax !== undefined) && { volume_ml: { ...(vmin !== undefined && { min: vmin }), ...(vmax !== undefined && { max: vmax }) } }),
      ...(filtrandoBase && faixaBase && { base_mm: { min: Math.max(0, faixaBase.min), max: faixaBase.max } }),
    };
    try {
      const f = filtrarCatalogo(implantes, filtro);
      // exemplos não clínicos no fim (ordem neutra por id mantida dentro de cada grupo)
      return { lista: [...f.filter((i) => !i.exemplo_nao_clinico), ...f.filter((i) => i.exemplo_nao_clinico)], erro: null };
    } catch {
      return { lista: [] as ImplanteCatalogo[], erro: "Faixa de volume inválida." };
    }
  }, [implantes, texto, fabricante, forma, perfil, volMin, volMax, filtrandoBase, faixaBase]);
  const mm1 = (v: number) => v.toFixed(1).replace(".", ",");

  return (
    <section className="painel" data-testid="escolha-implante" aria-labelledby="titulo-escolha-implante">
      <h3 id="titulo-escolha-implante">Implante — escolha manual</h3>
      <p className="nota nota-conferir" data-testid="catalogo-nota">
        Dados transcritos de catálogos públicos dos fabricantes, não verificados: {NOTA_CATALOGO}.
      </p>
      <div className="filtros" role="group" aria-label="Filtros do catálogo">
        <label>
          Busca
          <input data-testid="catalogo-busca" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="modelo ou referência" />
        </label>
        <label>
          Fabricante
          <select data-testid="catalogo-fabricante" value={fabricante} onChange={(e) => setFabricante(e.target.value)}>
            <option value="">todos</option>
            {opcoes.fabricante.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Forma
          <select data-testid="catalogo-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">todas</option>
            {opcoes.forma.map((f) => (
              <option key={f} value={f}>
                {f === "anatomica" ? "anatômica" : f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Perfil
          <select data-testid="catalogo-perfil" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
            <option value="">todos</option>
            {opcoes.perfil.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PERFIL[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Volume mín. (mL)
          <input data-testid="catalogo-volume-min" type="number" inputMode="numeric" min={0} value={volMin} onChange={(e) => setVolMin(e.target.value)} />
        </label>
        <label>
          Volume máx. (mL)
          <input data-testid="catalogo-volume-max" type="number" inputMode="numeric" min={0} value={volMax} onChange={(e) => setVolMax(e.target.value)} />
        </label>
      </div>
      {faixaBase &&
        (usarBase ? (
          <p className={css.filtroBase} data-testid="catalogo-filtro-base">
            Filtrado pela base medida ({mm1(faixaBase.media)} mm ±{TOLERANCIA_BASE_MM})
            <button type="button" className="secundario" onClick={() => setUsarBase(false)} data-testid="catalogo-filtro-base-desligar">
              Mostrar todos
            </button>
          </p>
        ) : (
          <p className={css.filtroBase} data-testid="catalogo-filtro-base">
            Sem filtro pela base
            <button type="button" className="secundario" onClick={() => setUsarBase(true)} data-testid="catalogo-filtro-base-ligar">
              Filtrar pela base medida ({mm1(faixaBase.media)} mm ±{TOLERANCIA_BASE_MM})
            </button>
          </p>
        ))}
      {erro && <div className="erro">{erro}</div>}
      <p className="nota" aria-live="polite" data-testid="catalogo-contagem">
        {lista.length} de {implantes.length} implantes (ordem por identificador; exemplos não clínicos no fim)
      </p>
      <table className="tabela" data-testid="catalogo-lista">
        <thead>
          <tr>
            <th aria-label="Escolher" />
            <th>Fabricante / modelo</th>
            <th>Ref.</th>
            <th>Forma</th>
            <th>Perfil</th>
            <th>Base × altura (mm)</th>
            <th>Projeção (mm)</th>
            <th>Volume (mL)</th>
            <th>Fonte</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((it) => (
            <tr key={it.id} data-testid={`catalogo-item-${it.id}`} data-selecionado={selecionado === it.id ? "1" : undefined}>
              <td>
                <input
                  type="radio"
                  name="implante-escolhido"
                  aria-label={`Escolher ${it.fabricante} ${it.modelo} ${it.volume_ml} mL`}
                  checked={selecionado === it.id}
                  onChange={() => onEscolher(it.id)}
                />
              </td>
              <td>
                {it.exemplo_nao_clinico && <strong className="tarja">EXEMPLO NÃO CLÍNICO </strong>}
                {it.fabricante} — {it.modelo}
              </td>
              <td>{it.referencia_fabricante ?? "—"}</td>
              <td>
                {it.forma === "anatomica" ? "anatômica" : "redonda"}
                {it.base_forma === "oval" ? " (base oval)" : ""}
              </td>
              <td title={it.perfil_fabricante ?? undefined}>{ROTULO_PERFIL[it.perfil] ?? it.perfil}</td>
              <td className="num">
                {it.base_mm} × {it.altura_mm}
              </td>
              <td className="num">{it.projecao_mm}</td>
              <td className="num">{it.volume_ml}</td>
              <td>
                {it.fonte.url ? (
                  <a href={it.fonte.url} target="_blank" rel="noopener noreferrer">
                    PDF{it.fonte.pagina ? `, p. ${it.fonte.pagina}` : ""}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
