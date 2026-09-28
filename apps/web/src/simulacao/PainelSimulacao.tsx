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
import type { EstadoFoto, ModoFoto } from "./ComparadorFotos";
import css from "./foto.module.css";
import type { ConfigSelo } from "./marcaDagua";
import type { ConjuntoMorph, PainelVista } from "./VisualizadorSimulacao";

const VisualizadorSimulacao = dynamic(() => import("./VisualizadorSimulacao"), {
  ssr: false,
  loading: () => <div className="viewer-vazio">Carregando a vista 3D…</div>,
});
const ComparadorFotos = dynamic(() => import("./ComparadorFotos").then((m) => m.ComparadorFotos), {
  ssr: false,
  loading: () => <div className="viewer-vazio">Preparando as fotos…</div>,
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
  /** Largura da base medida no 3D (mm): filtra o catálogo ±10 mm. Ignorada sem medição automática. */
  baseMedidaMm?: { dir: number; esq: number } | null;
}

type Previsto = NonNullable<EstadoSimulacao["previsto"]>;

// A tabela do catálogo (~190 linhas) não re-renderiza a cada troca na simulação.
const EscolhaImplanteMemo = memo(EscolhaImplante);

const rotuloImplante = (i: ImplanteCatalogo) => `${i.fabricante} ${i.modelo} ${i.volume_ml} mL`;
const mm1 = (v: number) => v.toFixed(1).replace(".", ",");
const sinal = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${mm1(Math.abs(v))}`;

export function PainelSimulacao({ recursos, envelopeMm, malhaId, landmarks, prontoParaSimular, motivoBloqueio, pincaPoloSuperiorMm, onEstado, baseMedidaMm }: Props) {
  const [catalogo, setCatalogo] = useState<ImplanteCatalogo[]>([]);
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null);
  const [escolhidos, setEscolhidos] = useState<[string | null, string | null]>([null, null]);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [gaveta, setGaveta] = useState(true);
  const [gerada, setGerada] = useState<{ chave: string; manifest: ManifestMorphs; conjuntos: ConjuntoMorph[]; landmarks: Landmarks } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [plano, setPlano] = useState<Plano>("subglandular");
  const [imf, setImf] = useState<Imf>("manter");
  const [aba, setAba] = useState<"fotos" | "3d">("fotos");
  const [selecao, setSelecao] = useState<{ estado: EstadoFoto; modo: ModoFoto }>({ estado: "antes", modo: "foto" });
  // aba "Explorar 3D" (viewer orbital)
  const [peso, setPeso] = useState(1);
  const [comparar, setComparar] = useState(false);
  const [mostrado, setMostrado] = useState<0 | 1>(0);
  const [vista, setVista] = useState<NomeVista>("frente");
  const [configSelo, setConfigSelo] = useState<{ versao: string; demo: boolean; volumeFator: number } | null>(null);
  const registradas = useRef(new Set<string>());

  useEffect(() => {
    fetch("/api/catalogo")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catálogo ${r.status}`))))
      .then((j) => setCatalogo(j.implantes ?? []))
      .catch((e) => setErroCatalogo((e as Error).message));
    // versão e modo demo para o selo gravado nos pixels (a Consulta não precisa repassar)
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setConfigSelo({ versao: String(j.versao_software ?? ""), demo: j.demo === true, volumeFator: Number(j.volume_relativa_fator) || 0.15 }))
      .catch(() => undefined);
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
        for (const id of ids) if (!(nomeTarget(id, c.plano, c.imf) in dic)) throw new Error(`simulação incompleta para ${id} (${ROTULOS_PLANO[c.plano]}, ${ROTULOS_IMF[c.imf]})`);
      }
      registradas.current.clear();
      setGerada({ chave: chaveAtual, manifest: m, conjuntos: cs, landmarks });
      setMostrado(0);
      setComparar(ids.length === 2);
      setPeso(1);
      setGaveta(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const naoCalibrado = !!manifest && (manifest.nao_calibrado || conjuntos?.some((c) => c.carregada.extras?.nao_calibrado === true) === true);
  const modelo = (conjuntos?.[0]?.carregada.extras?.modelo as string | undefined) ?? null;

  // ---- aba "Explorar 3D": 1 painel ou 2 lado a lado (câmeras sincronizadas)
  const paineis: PainelVista[] = useMemo(() => {
    if (implantesGerados.length === 0) return [];
    if (comparar && implantesGerados.length === 2) return implantesGerados.map((i, k) => ({ chave: `i${k + 1}`, rotulo: `${k === 0 ? "A" : "B"}: ${rotuloImplante(i)}`, implanteId: i.id }));
    const k = Math.min(mostrado, implantesGerados.length - 1);
    return [{ chave: "i1", rotulo: `${k === 0 ? "A" : "B"}: ${rotuloImplante(implantesGerados[k]!)}`, implanteId: implantesGerados[k]!.id }];
  }, [implantesGerados, comparar, mostrado]);

  // implante mostrado sozinho (para o "previsto" e o relatório): foto única de A/B ou 1 painel no 3D
  const implanteMostrado = useMemo(() => {
    if (aba === "3d") return paineis.length === 1 ? paineis[0]!.implanteId : null;
    if (selecao.modo !== "foto" || selecao.estado === "antes") return null;
    return implantesGerados[selecao.estado === "a" ? 0 : Math.min(1, implantesGerados.length - 1)]?.id ?? null;
  }, [aba, paineis, selecao, implantesGerados]);
  const comparacao = aba === "3d" ? paineis.length === 2 : selecao.modo !== "foto" && implantesGerados.length === 2;

  const previstoDe = useCallback(
    (id: string | null | undefined): Previsto | null => {
      if (!manifest || !id || !recursos.numeros_calculados_no_relatorio) return null;
      const arq = manifest.arquivos.find((a) => a.plano === plano && a.imf === imf);
      return arq?.targets.find((t) => t.implante_id === id && t.lado === "ambos")?.previsto ?? null;
    },
    [manifest, recursos.numeros_calculados_no_relatorio, plano, imf],
  );
  const previsto = useMemo(() => previstoDe(implanteMostrado), [previstoDe, implanteMostrado]);

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
      implante_mostrado: implanteMostrado,
      comparacao,
      plano,
      imf,
      envelope_rms_mm: envelopeMm,
      nao_calibrado: naoCalibrado,
      modelo,
      versao_config_simulacao: manifest.versao_config_simulacao,
      previsto,
    });
  }, [onEstado, manifest, malhaId, implantesGerados, implanteMostrado, comparacao, plano, imf, envelopeMm, naoCalibrado, modelo, previsto]);

  // cada combinação MOSTRADA (peso > 0) vira uma linha em `simulacoes`, uma vez por combinação
  const registrar = useCallback(
    (ids: readonly string[], p: Plano, i: Imf) => {
      if (!manifest || !malhaId) return;
      for (const id of ids) {
        const chave = `${id}|${p}|${i}`;
        if (registradas.current.has(chave)) continue;
        registradas.current.add(chave);
        const alvo = manifest.arquivos.find((a) => a.plano === p && a.imf === i)?.targets.find((t) => t.implante_id === id && t.lado === "ambos");
        void fetch(`/api/malhas/${malhaId}/simulacoes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ implante_id: id, plano: p, imf: i, lado: "ambos", versao_config_simulacao: manifest.versao_config_simulacao, nao_calibrado: naoCalibrado, previsto: recursos.numeros_calculados_no_relatorio ? (alvo?.previsto ?? null) : null }),
        })
          .then((r) => {
            if (!r.ok) registradas.current.delete(chave);
          })
          .catch(() => registradas.current.delete(chave));
      }
    },
    [manifest, malhaId, naoCalibrado, recursos.numeros_calculados_no_relatorio],
  );
  // aba 3D: os painéis visíveis com peso > 0
  useEffect(() => {
    if (aba === "3d" && peso > 0) registrar(paineis.map((p) => p.implanteId), plano, imf);
  }, [aba, peso, paineis, plano, imf, registrar]);

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
  const dadosEscolhido = (k: 0 | 1) => {
    const i = escolhidos[k] ? porId.get(escolhidos[k]!) : undefined;
    if (!i) return k === 0 ? "Toque para escolher no catálogo" : "Opcional: um segundo implante para comparar";
    return `base ${mm1(i.base_mm)} mm · projeção ${mm1(i.projecao_mm)} mm · ${i.forma === "anatomica" ? "anatômico" : "redondo"}`;
  };

  const implantesFoto = useMemo(() => implantesGerados.map((i) => ({ id: i.id, rotulo: rotuloImplante(i) })), [implantesGerados]);
  const selo: ConfigSelo = useMemo(() => ({ envelopeMm, versao: configSelo?.versao || manifest?.versao_software || "", demo: configSelo?.demo ?? false }), [envelopeMm, configSelo, manifest?.versao_software]);
  const baseFiltro = recursos.medicao_automatica_3d ? (baseMedidaMm ?? null) : null;
  const aoSelecao = useCallback((s: { estado: EstadoFoto; modo: ModoFoto }) => setSelecao((x) => (x.estado === s.estado && x.modo === s.modo ? x : s)), []);

  const diferencas = useMemo(() => {
    if (!recursos.numeros_calculados_no_relatorio || implantesGerados.length !== 2) return null;
    const [a, b] = implantesGerados as [ImplanteCatalogo, ImplanteCatalogo];
    const pa = previstoDe(a.id), pb = previstoDe(b.id);
    return { a, b, pa, pb };
  }, [recursos.numeros_calculados_no_relatorio, implantesGerados, previstoDe]);

  return (
    <section className="painel painel-simulacao" data-testid="simulacao" aria-labelledby="titulo-simulacao">
      <h3 id="titulo-simulacao">Simulação (ilustração)</h3>
      <p className="nota">Escolha manual do implante pelo cirurgião: A e, se quiser comparar, B. A simulação é a foto do scan editada pela geometria de cada implante.</p>
      <div className={css.cards} role="radiogroup" aria-label="Implante sendo escolhido">
        {([0, 1] as const).map((k) => (
          <label key={k} className={css.card} data-ativo={slot === k ? "1" : undefined}>
            <input
              type="radio"
              name="slot-implante"
              checked={slot === k}
              onChange={() => {
                setSlot(k);
                setGaveta(true);
              }}
              onClick={() => setGaveta(true)}
              data-testid={`slot-implante-${k + 1}`}
              aria-label={`Implante ${k === 0 ? "A" : "B"}`}
            />
            <span className={css.letra} aria-hidden="true">
              {k === 0 ? "A" : "B"}
            </span>
            <span className={css.cardCorpo}>
              <strong className={css.cardNome} data-testid={`implante-escolhido-${k + 1}`}>
                {nomeEscolhido(k)}
              </strong>
              <span className={css.cardDados}>{dadosEscolhido(k)}</span>
              {k === 1 && escolhidos[1] && (
                <button type="button" className="link" onClick={() => setEscolhidos([escolhidos[0], null])}>
                  remover B
                </button>
              )}
            </span>
          </label>
        ))}
      </div>
      {erroCatalogo && <p className="erro">Catálogo indisponível: {erroCatalogo}</p>}
      <details className={`det-catalogo ${css.gaveta}`} open={gaveta} onToggle={(e) => setGaveta((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Catálogo de implantes — escolhendo o {slot === 0 ? "A" : "B"}</summary>
        <EscolhaImplanteMemo implantes={catalogo} selecionado={selecionado} onEscolher={aoEscolher} baseMedidaMm={baseFiltro} />
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

      {manifest && conjuntos && implantesGerados.length > 0 && (
        <div className="sim-controles" data-testid="simulacao-pronta">
          {naoCalibrado && (
            <p className="selo-nao-calibrado" data-testid="selo-nao-calibrado">
              Coeficientes do modelo geométrico NÃO calibrados — ilustração, não previsão de resultado.
            </p>
          )}
          <div className={css.chips}>
            <fieldset className={css.grupoChips} role="radiogroup" aria-label="Plano">
              <legend>Plano</legend>
              {PLANOS.map((p) => (
                <label key={p} className={css.chip}>
                  <input type="radio" name="plano" checked={plano === p} onChange={() => setPlano(p)} data-testid={`plano-${p}`} /> {ROTULOS_PLANO[p]}
                </label>
              ))}
            </fieldset>
            <fieldset className={css.grupoChips} role="radiogroup" aria-label="Sulco inframamário">
              <legend>Sulco</legend>
              {IMFS.map((i) => (
                <label key={i} className={css.chip}>
                  <input type="radio" name="imf" checked={imf === i} onChange={() => setImf(i)} data-testid={`imf-${i}`} /> {ROTULOS_IMF[i]}
                </label>
              ))}
            </fieldset>
          </div>

          <div className={css.abas} role="tablist" aria-label="Forma de ver a simulação">
            <button type="button" role="tab" aria-selected={aba === "fotos"} onClick={() => setAba("fotos")} data-testid="aba-fotos">
              Fotos
            </button>
            <button type="button" role="tab" aria-selected={aba === "3d"} onClick={() => setAba("3d")} data-testid="aba-explorar-3d">
              Explorar 3D
            </button>
          </div>

          {aba === "fotos" ? (
            <div role="tabpanel" aria-label="Fotos">
              <ComparadorFotos
                conjuntos={conjuntos}
                implantes={implantesFoto}
                plano={plano}
                imf={imf}
                rotuloPlano={ROTULOS_PLANO[plano]}
                rotuloImf={ROTULOS_IMF[imf]}
                envelopeMm={envelopeMm}
                volumeFator={configSelo?.volumeFator ?? 0.15}
                landmarks={valida!.landmarks}
                selo={selo}
                onMostradas={registrar}
                onSelecao={aoSelecao}
              />
              {diferencas && (
                <table className={`tabela ${css.diferencas}`} data-testid="foto-diferencas">
                  <caption className="nota">
                    Diferenças entre A e B ({ROTULOS_PLANO[plano]}, {ROTULOS_IMF[imf]}). Previstos pelo modelo não calibrado, cada um com faixa ±{mm1(envelopeMm)} mm.
                  </caption>
                  <thead>
                    <tr>
                      <th />
                      <th>A</th>
                      <th>B</th>
                      <th>A − B</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Volume (catálogo)</td>
                      <td>{mm1(diferencas.a.volume_ml)} mL</td>
                      <td>{mm1(diferencas.b.volume_ml)} mL</td>
                      <td>{sinal(diferencas.a.volume_ml - diferencas.b.volume_ml)} mL</td>
                    </tr>
                    <tr>
                      <td>Base (catálogo)</td>
                      <td>{mm1(diferencas.a.base_mm)} mm</td>
                      <td>{mm1(diferencas.b.base_mm)} mm</td>
                      <td>{sinal(diferencas.a.base_mm - diferencas.b.base_mm)} mm</td>
                    </tr>
                    <tr>
                      <td>Projeção (catálogo)</td>
                      <td>{mm1(diferencas.a.projecao_mm)} mm</td>
                      <td>{mm1(diferencas.b.projecao_mm)} mm</td>
                      <td>{sinal(diferencas.a.projecao_mm - diferencas.b.projecao_mm)} mm</td>
                    </tr>
                    {diferencas.pa && diferencas.pb && (
                      <>
                        <tr>
                          <td>Avanço do mamilo previsto D / E</td>
                          <td>
                            {sinal(diferencas.pa.delta_projecao_mamilo_mm.dir)} / {sinal(diferencas.pa.delta_projecao_mamilo_mm.esq)} mm
                          </td>
                          <td>
                            {sinal(diferencas.pb.delta_projecao_mamilo_mm.dir)} / {sinal(diferencas.pb.delta_projecao_mamilo_mm.esq)} mm
                          </td>
                          <td>
                            {sinal(diferencas.pa.delta_projecao_mamilo_mm.dir - diferencas.pb.delta_projecao_mamilo_mm.dir)} / {sinal(diferencas.pa.delta_projecao_mamilo_mm.esq - diferencas.pb.delta_projecao_mamilo_mm.esq)} mm
                          </td>
                        </tr>
                        <tr>
                          <td>Deslocamento do sulco previsto D / E</td>
                          <td>
                            {sinal(diferencas.pa.delta_y_sulco_mm.dir)} / {sinal(diferencas.pa.delta_y_sulco_mm.esq)} mm
                          </td>
                          <td>
                            {sinal(diferencas.pb.delta_y_sulco_mm.dir)} / {sinal(diferencas.pb.delta_y_sulco_mm.esq)} mm
                          </td>
                          <td>
                            {sinal(diferencas.pa.delta_y_sulco_mm.dir - diferencas.pb.delta_y_sulco_mm.dir)} / {sinal(diferencas.pa.delta_y_sulco_mm.esq - diferencas.pb.delta_y_sulco_mm.esq)} mm
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-label="Explorar 3D" data-testid="explorar-3d">
              <label className="slider">
                Antes
                <input type="range" min={0} max={100} step={1} value={Math.round(peso * 100)} onChange={(e) => setPeso(Number(e.target.value) / 100)} data-testid="slider-peso" aria-label="Antes e depois" />
                Depois <span className="num">{Math.round(peso * 100)}%</span>
              </label>
              {implantesGerados.length === 2 && (
                <div className="linha-form">
                  <label className="check">
                    <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} data-testid="comparar" /> A e B lado a lado (câmeras sincronizadas)
                  </label>
                  {!comparar &&
                    ([0, 1] as const).map((k) => (
                      <label key={k} className="check">
                        <input type="radio" name="mostrado" checked={mostrado === k} onChange={() => setMostrado(k)} data-testid={`mostrar-implante-${k + 1}`} /> {k === 0 ? "A" : "B"}
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
              <VisualizadorSimulacao conjuntos={conjuntos} paineis={paineis} plano={plano} imf={imf} peso={peso} envelopeMm={envelopeMm} vista={vista} landmarks={valida!.landmarks} />
            </div>
          )}
          {previsto && (
            <p className="nota" data-testid="previsto-simulacao">
              Previsto pelo modelo não calibrado para {implanteMostrado === implantesGerados[0]?.id ? "A" : "B"} (mm, faixa ±{mm1(envelopeMm)}): avanço do mamilo {sinal(previsto.delta_projecao_mamilo_mm.dir)} D / {sinal(previsto.delta_projecao_mamilo_mm.esq)} E; sulco{" "}
              {sinal(previsto.delta_y_sulco_mm.dir)} D / {sinal(previsto.delta_y_sulco_mm.esq)} E.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
