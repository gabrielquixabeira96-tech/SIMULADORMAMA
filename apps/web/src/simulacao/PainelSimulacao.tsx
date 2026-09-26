"use client";

import {
  IMFS,
  PLANOS,
  ROTULOS_IMF,
  ROTULOS_PLANO,
  arquivoMorph,
  nomeTarget,
  type Imf,
  type ImplanteCatalogo,
  type Landmarks,
  type ManifestMorphs,
  type Plano,
} from "@simulador/contratos";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EscolhaImplante } from "@/catalogo/EscolhaImplante";
import type { MapaRecursos } from "@/config/recursos";
import { NOMES_VISTAS, VISTAS, type NomeVista } from "@/viewer/vistas";
import type { ConjuntoMorph, PainelVista } from "./VisualizadorSimulacao";

const VisualizadorSimulacao = dynamic(() => import("./VisualizadorSimulacao"), {
  ssr: false,
  loading: () => <div className="viewer-vazio">Carregando simulação…</div>,
});

/** Estado da simulação exposto à Consulta (e ao relatório/PDF do Marco 2b). */
export interface EstadoSimulacao {
  malha_id: string;
  implantes: Array<{ id: string; rotulo: string; volume_ml: number; base_mm: number; projecao_mm: number }>;
  implante_mostrado: string | null;
  comparacao: boolean;
  plano: Plano;
  imf: Imf;
  envelope_rms_mm: number;
  nao_calibrado: boolean;
  modelo: string | null;
  versao_config_simulacao: string;
  /** só com números calculados permitidos (DESENHO=B); null em A */
  previsto: ManifestMorphs["arquivos"][number]["targets"][number]["previsto"] | null;
}

interface Props {
  recursos: MapaRecursos;
  envelopeMm: number;
  malhaId: string | null;
  landmarks: Landmarks;
  prontoParaSimular: boolean;
  motivoBloqueio: string | null;
  pincaPoloSuperiorMm: { dir: number; esq: number } | null;
  onEstado?: (e: EstadoSimulacao | null) => void;
}

// A tabela do catálogo (~190 linhas) não re-renderiza a cada movimento do slider.
const EscolhaImplanteMemo = memo(EscolhaImplante);

const rotuloImplante = (i: ImplanteCatalogo) => `${i.fabricante} ${i.modelo} ${i.volume_ml} mL`;

export function PainelSimulacao({ recursos, envelopeMm, malhaId, landmarks, prontoParaSimular, motivoBloqueio, pincaPoloSuperiorMm, onEstado }: Props) {
  const [catalogo, setCatalogo] = useState<ImplanteCatalogo[]>([]);
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null);
  const [escolhidos, setEscolhidos] = useState<[string | null, string | null]>([null, null]);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [gerada, setGerada] = useState<{ chave: string; manifest: ManifestMorphs; conjuntos: ConjuntoMorph[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [plano, setPlano] = useState<Plano>("subglandular");
  const [imf, setImf] = useState<Imf>("manter");
  const [peso, setPeso] = useState(1);
  const [comparar, setComparar] = useState(false);
  const [mostrado, setMostrado] = useState<0 | 1>(0);
  const [vista, setVista] = useState<NomeVista>("frente");
  const registradas = useRef(new Set<string>());

  useEffect(() => {
    fetch("/api/catalogo")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catálogo ${r.status}`))))
      .then((j) => setCatalogo(j.implantes ?? []))
      .catch((e) => setErroCatalogo((e as Error).message));
  }, []);

  // A simulação pertence à malha e aos landmarks: qualquer mudança a invalida.
  const chaveAtual = useMemo(() => `${malhaId}|${JSON.stringify(landmarks)}`, [malhaId, landmarks]);
  const valida = gerada && gerada.chave === chaveAtual ? gerada : null;
  const manifest = valida?.manifest ?? null;
  const conjuntos = valida?.conjuntos ?? null;

  const porId = useMemo(() => new Map(catalogo.map((i) => [i.id, i])), [catalogo]);
  const idsGerados = useMemo(() => [...new Set(manifest?.arquivos[0]?.targets.map((t) => t.implante_id) ?? [])], [manifest]);
  const implantesGerados = useMemo(() => idsGerados.map((id) => porId.get(id)).filter((x): x is ImplanteCatalogo => !!x), [idsGerados, porId]);

  async function gerar() {
    const ids = escolhidos.filter((x): x is string => !!x);
    if (!malhaId || ids.length === 0) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/malhas/${malhaId}/morphs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ landmarks, implantes: ids, pinca_polo_superior_mm: pincaPoloSuperiorMm }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro?.mensagem ?? j?.erro?.codigo ?? `erro ${r.status}`);
      const m = j as ManifestMorphs;
      const { carregarGlb } = await import("@/viewer/carregar");
      // pré-carrega os 4 (plano × IMF): a troca depois é instantânea
      const cs = await Promise.all(
        m.arquivos.map(async (a) => ({
          plano: a.plano,
          imf: a.imf,
          carregada: await carregarGlb(`/api/malhas/${malhaId}/arquivo?nome=${encodeURIComponent(`morphs/${arquivoMorph(a.plano, a.imf)}`)}&v=${encodeURIComponent(m.gerado_em)}`, "morphs/1.0"),
        })),
      );
      for (const c of cs) {
        const dic = c.carregada.malha.morphTargetDictionary ?? {};
        for (const id of ids) if (!(nomeTarget(id, c.plano, c.imf) in dic)) throw new Error(`target ausente no ${c.plano}__${c.imf}.glb: ${id}`);
      }
      registradas.current.clear();
      setGerada({ chave: chaveAtual, manifest: m, conjuntos: cs });
      setMostrado(0);
      setComparar(ids.length === 2);
      setPeso(1);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const naoCalibrado = !!manifest && (manifest.nao_calibrado || conjuntos?.some((c) => c.carregada.extras?.nao_calibrado === true) === true);
  const modelo = (conjuntos?.[0]?.carregada.extras?.modelo as string | undefined) ?? null;
  const paineis: PainelVista[] = useMemo(() => {
    if (implantesGerados.length === 0) return [];
    if (comparar && implantesGerados.length === 2) return implantesGerados.map((i, k) => ({ chave: `i${k + 1}`, rotulo: `Implante ${k + 1}: ${rotuloImplante(i)}`, implanteId: i.id }));
    const i = implantesGerados[Math.min(mostrado, implantesGerados.length - 1)]!;
    return [{ chave: "i1", rotulo: rotuloImplante(i), implanteId: i.id }];
  }, [implantesGerados, comparar, mostrado]);

  const previsto = useMemo(() => {
    if (!manifest || !recursos.numeros_calculados_no_relatorio || paineis.length !== 1) return null;
    const arq = manifest.arquivos.find((a) => a.plano === plano && a.imf === imf);
    return arq?.targets.find((t) => t.implante_id === paineis[0]!.implanteId && t.lado === "ambos")?.previsto ?? null;
  }, [manifest, recursos.numeros_calculados_no_relatorio, paineis, plano, imf]);

  // estado para a Consulta / relatório (emitido só quando o conteúdo muda)
  const ultimoEstado = useRef<string>("");
  useEffect(() => {
    if (!onEstado) return;
    const emitir = (e: EstadoSimulacao | null) => {
      const k = JSON.stringify(e);
      if (k === ultimoEstado.current) return;
      ultimoEstado.current = k;
      onEstado(e);
    };
    if (!manifest || !malhaId) return emitir(null);
    emitir({
      malha_id: malhaId,
      implantes: implantesGerados.map((i) => ({ id: i.id, rotulo: rotuloImplante(i), volume_ml: i.volume_ml, base_mm: i.base_mm, projecao_mm: i.projecao_mm })),
      implante_mostrado: paineis.length === 1 ? paineis[0]!.implanteId : null,
      comparacao: paineis.length === 2,
      plano,
      imf,
      envelope_rms_mm: envelopeMm,
      nao_calibrado: naoCalibrado,
      modelo,
      versao_config_simulacao: manifest.versao_config_simulacao,
      previsto,
    });
  }, [onEstado, manifest, malhaId, implantesGerados, paineis, plano, imf, envelopeMm, naoCalibrado, modelo, previsto]);

  // cada combinação MOSTRADA (peso > 0) vira uma linha em `simulacoes`, uma vez por combinação
  useEffect(() => {
    if (!manifest || !malhaId || peso <= 0) return;
    for (const p of paineis) {
      const chave = `${p.implanteId}|${plano}|${imf}`;
      if (registradas.current.has(chave)) continue;
      registradas.current.add(chave);
      const alvo = manifest.arquivos.find((a) => a.plano === plano && a.imf === imf)?.targets.find((t) => t.implante_id === p.implanteId && t.lado === "ambos");
      void fetch(`/api/malhas/${malhaId}/simulacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ implante_id: p.implanteId, plano, imf, lado: "ambos", versao_config_simulacao: manifest.versao_config_simulacao, nao_calibrado: naoCalibrado, previsto: alvo?.previsto ?? null }),
      })
        .then((r) => {
          if (!r.ok) registradas.current.delete(chave);
        })
        .catch(() => registradas.current.delete(chave));
    }
  }, [manifest, malhaId, peso, paineis, plano, imf, naoCalibrado]);

  const selecionado = escolhidos[slot];
  const aoEscolher = useCallback(
    (id: string) =>
      setEscolhidos((atual) => {
        const novo: [string | null, string | null] = [...atual];
        novo[slot] = id;
        if (novo[0] === novo[1]) novo[1 - slot] = null;
        return novo;
      }),
    [slot],
  );
  const nomeEscolhido = (k: 0 | 1) => (escolhidos[k] ? (porId.get(escolhidos[k]!) ? rotuloImplante(porId.get(escolhidos[k]!)!) : escolhidos[k]) : "—");

  return (
    <section className="painel painel-simulacao" data-testid="simulacao" aria-labelledby="titulo-simulacao">
      <h3 id="titulo-simulacao">5. Simulação (ilustração)</h3>
      <p className="nota">
        Escolha manual do implante pelo cirurgião{recursos.sugestao_implante ? "" : " (desenho A: sem sugestão, sem volume calculado, sem alertas)"}. Até 2 implantes para comparar lado a lado.
      </p>
      <div className="linha-form" role="radiogroup" aria-label="Implante sendo escolhido">
        {([0, 1] as const).map((k) => (
          <label key={k} className="check">
            <input type="radio" name="slot-implante" checked={slot === k} onChange={() => setSlot(k)} data-testid={`slot-implante-${k + 1}`} /> Implante {k + 1}
            {k === 1 ? " (comparação, opcional)" : ""}: <strong data-testid={`implante-escolhido-${k + 1}`}>{nomeEscolhido(k)}</strong>
            {k === 1 && escolhidos[1] && (
              <button type="button" className="link" onClick={() => setEscolhidos([escolhidos[0], null])}>
                remover
              </button>
            )}
          </label>
        ))}
      </div>
      {erroCatalogo && <p className="erro">Catálogo indisponível: {erroCatalogo}</p>}
      <details open={!manifest} className="det-catalogo">
        <summary>Catálogo de implantes</summary>
        <EscolhaImplanteMemo implantes={catalogo} selecionado={selecionado} onEscolher={aoEscolher} />
      </details>
      <div className="linha-form">
        <button type="button" onClick={gerar} disabled={!prontoParaSimular || !escolhidos[0] || carregando} data-testid="gerar-simulacao">
          {carregando ? "Gerando simulação…" : "Gerar simulação"}
        </button>
        {!prontoParaSimular && motivoBloqueio && <span className="nota">{motivoBloqueio}</span>}
      </div>
      {erro && (
        <p className="erro" role="alert">
          Simulação falhou: {erro}
        </p>
      )}

      {manifest && conjuntos && paineis.length > 0 && (
        <div className="sim-controles" data-testid="simulacao-pronta">
          {naoCalibrado && (
            <p className="selo-nao-calibrado" data-testid="selo-nao-calibrado">
              Coeficientes NÃO calibrados — modelo {modelo ?? "geométrico"}; ilustração, não previsão.
            </p>
          )}
          <div className="linha-form" role="radiogroup" aria-label="Plano">
            {PLANOS.map((p) => (
              <label key={p} className="check">
                <input type="radio" name="plano" checked={plano === p} onChange={() => setPlano(p)} data-testid={`plano-${p}`} /> {ROTULOS_PLANO[p]}
              </label>
            ))}
          </div>
          <div className="linha-form" role="radiogroup" aria-label="Sulco inframamário">
            {IMFS.map((i) => (
              <label key={i} className="check">
                <input type="radio" name="imf" checked={imf === i} onChange={() => setImf(i)} data-testid={`imf-${i}`} /> {ROTULOS_IMF[i]}
              </label>
            ))}
          </div>
          <label className="slider">
            Antes
            <input type="range" min={0} max={100} step={1} value={Math.round(peso * 100)} onChange={(e) => setPeso(Number(e.target.value) / 100)} data-testid="slider-peso" aria-label="Antes e depois" />
            Depois <span className="num">{Math.round(peso * 100)}%</span>
          </label>
          {implantesGerados.length === 2 && (
            <div className="linha-form">
              <label className="check">
                <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} data-testid="comparar" /> Comparar lado a lado (câmeras sincronizadas)
              </label>
              {!comparar &&
                ([0, 1] as const).map((k) => (
                  <label key={k} className="check">
                    <input type="radio" name="mostrado" checked={mostrado === k} onChange={() => setMostrado(k)} data-testid={`mostrar-implante-${k + 1}`} /> Implante {k + 1}
                  </label>
                ))}
            </div>
          )}
          <div className="ferramentas" role="toolbar" aria-label="Vista da simulação">
            {NOMES_VISTAS.slice(0, 5).map((v) => (
              <button key={v} type="button" className="secundario" aria-pressed={vista === v} onClick={() => setVista(v)} data-testid={`sim-vista-${v}`}>
                {VISTAS[v].rotulo}
              </button>
            ))}
          </div>
          <VisualizadorSimulacao conjuntos={conjuntos} paineis={paineis} plano={plano} imf={imf} peso={peso} envelopeMm={envelopeMm} vista={vista} />
          {previsto && (
            <p className="nota" data-testid="previsto-simulacao">
              Previsto pelo modelo não calibrado (mm): projeção do mamilo +{previsto.delta_projecao_mamilo_mm.dir.toFixed(1)} D / +{previsto.delta_projecao_mamilo_mm.esq.toFixed(1)} E; sulco{" "}
              {previsto.delta_y_sulco_mm.dir.toFixed(1)} D / {previsto.delta_y_sulco_mm.esq.toFixed(1)} E.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
