"use client";

import {
  DEFINICOES_LANDMARKS,
  LANDMARK_IDS,
  LANDMARKS_OBRIGATORIOS,
  type DistanciaId,
  type Landmark,
  type LandmarkId,
  type Landmarks,
  type MedirResposta,
  type Vetor3,
} from "@simulador/contratos";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigPublica } from "@/config/publica";
import { distanciaEuclidiana, distanciasEuclidianas } from "@/medidas/geometria";
import type { MalhaCarregada } from "@/viewer/carregar";
import type { CliqueNaMalha, Marcador } from "@/viewer/Visualizador";
import { FormularioTepid, valoresTepidVazios, type ErroCampoUI, type ResultadoTepidUI, type ValoresTepidForm } from "./FormularioTepid";
import { PainelDistancias, PainelVolume, type EstadoMedicao } from "./PainelMedidas";

const Visualizador = dynamic(() => import("@/viewer/Visualizador"), {
  ssr: false,
  loading: () => <div className="viewer-vazio">Carregando visualizador 3D…</div>,
});

type Fonte =
  | { tipo: "servidor"; malhaId: string; pseudonimo: string; sintetica: boolean; versao: number }
  | { tipo: "sintetico"; nome: string }
  | { tipo: "local"; descricao: string };

type Ferramenta = "navegar" | "regua" | "landmarks";

interface Paciente {
  id: string;
  pseudonimo: string;
}

interface TorsoSintetico {
  nome: string;
  glb: boolean;
  obj: boolean;
  gabarito: boolean;
}

async function lerErro(r: Response): Promise<string> {
  try {
    const j = await r.json();
    return j?.erro?.mensagem ?? j?.erro?.codigo ?? `erro ${r.status}`;
  } catch {
    return `erro ${r.status}`;
  }
}

const fmt1 = (v: number) => v.toFixed(1).replace(".", ",");

export function Consulta({ config }: { config: ConfigPublica }) {
  const { recursos } = config;

  // ---------------------------------------------------------------- estado
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [fonte, setFonte] = useState<Fonte | null>(null);
  const [carregada, setCarregada] = useState<MalhaCarregada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "info" | "erro"; texto: string } | null>(null);
  const [meshDisponivel, setMeshDisponivel] = useState<boolean | null>(null);
  const [sinteticos, setSinteticos] = useState<TorsoSintetico[]>([]);
  const [gabarito, setGabarito] = useState<Partial<Record<DistanciaId, { euclidiana_mm: number; geodesica_mm: number | null }>> | null>(null);

  const [unidade, setUnidade] = useState("desconhecida");
  const [marcarSintetica, setMarcarSintetica] = useState(false);
  const arquivosUpload = useRef<HTMLInputElement>(null);
  const arquivosLocais = useRef<HTMLInputElement>(null);
  const urlsLocais = useRef<string[]>([]);

  const [ferramenta, setFerramenta] = useState<Ferramenta>("navegar");
  const [pontosRegua, setPontosRegua] = useState<Vetor3[]>([]);
  const [reguaMm, setReguaMm] = useState("100");
  const [calibrada, setCalibrada] = useState(false);

  const [landmarks, setLandmarks] = useState<Landmarks>({});
  const [ativo, setAtivo] = useState<LandmarkId>("furcula");

  const [medicao, setMedicao] = useState<MedirResposta | null>(null);
  const [estadoMedicao, setEstadoMedicao] = useState<EstadoMedicao>("ocioso");

  const [valoresTepid, setValoresTepid] = useState<ValoresTepidForm>(valoresTepidVazios);
  const [resultadoTepid, setResultadoTepid] = useState<ResultadoTepidUI | null>(null);
  const [tepidValidado, setTepidValidado] = useState<Record<string, { dir: number; esq: number }> | null>(null);
  const [errosTepid, setErrosTepid] = useState<ErroCampoUI[]>([]);
  const [avaliandoTepid, setAvaliandoTepid] = useState(false);

  // ---------------------------------------------------------------- efeitos
  useEffect(() => {
    fetch("/api/mesh/saude")
      .then((r) => r.json())
      .then((j) => setMeshDisponivel(!!j.disponivel))
      .catch(() => setMeshDisponivel(false));
    fetch("/api/sinteticos")
      .then((r) => (r.ok ? r.json() : { torsos: [] }))
      .then((j) => setSinteticos(j.torsos ?? []))
      .catch(() => setSinteticos([]));
    const urls = urlsLocais.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const limparMedidas = useCallback(() => {
    setLandmarks({});
    setAtivo("furcula");
    setMedicao(null);
    setEstadoMedicao("ocioso");
  }, []);

  const abrir = useCallback(
    async (novaFonte: Fonte, carregar: () => Promise<MalhaCarregada>) => {
      setCarregando(true);
      setMensagem(null);
      try {
        const m = await carregar();
        setCarregada(m);
        setFonte(novaFonte);
        setPontosRegua([]);
        limparMedidas();
      } catch (e) {
        setMensagem({ tipo: "erro", texto: (e as Error).message });
      } finally {
        setCarregando(false);
      }
    },
    [limparMedidas],
  );

  // ---------------------------------------------------------------- ações
  async function criarPaciente() {
    const r = await fetch("/api/pacientes", { method: "POST" });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: `Não foi possível criar paciente: ${await lerErro(r)}` });
    const j = await r.json();
    setPaciente({ id: j.id, pseudonimo: j.pseudonimo });
  }

  async function enviarMalha(e: React.FormEvent) {
    e.preventDefault();
    const files = arquivosUpload.current?.files;
    if (!paciente || !files || files.length === 0) return;
    const fd = new FormData();
    fd.set("paciente_id", paciente.id);
    fd.set("unidade_origem", unidade);
    fd.set("recorte_modo", "abaixo_do_pescoco");
    if (marcarSintetica) fd.set("sintetica", "true");
    for (const f of Array.from(files)) fd.append("arquivos", f, f.name);
    setCarregando(true);
    setMensagem({ tipo: "info", texto: "Enviando e processando (recorte + decimação)…" });
    const r = await fetch("/api/malhas", { method: "POST", body: fd });
    setCarregando(false);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: `Upload falhou: ${await lerErro(r)}` });
    const j = await r.json();
    setCalibrada(false);
    const { carregarGlb } = await import("@/viewer/carregar");
    await abrir({ tipo: "servidor", malhaId: j.malha_id, pseudonimo: j.pseudonimo, sintetica: marcarSintetica, versao: 1 }, () =>
      carregarGlb(`/api/malhas/${j.malha_id}/arquivo?nome=processada.glb&v=1`),
    );
    setMensagem({ tipo: "info", texto: `Malha processada: ${j.meta?.processada?.n_vertices ?? "?"} vértices.` });
  }

  async function abrirLocal() {
    const files = arquivosLocais.current?.files;
    if (!files || files.length === 0) return;
    urlsLocais.current.forEach((u) => URL.revokeObjectURL(u));
    urlsLocais.current = [];
    const mapa = new Map<string, string>();
    for (const f of Array.from(files)) {
      const u = URL.createObjectURL(f);
      urlsLocais.current.push(u);
      mapa.set(f.name, u);
    }
    const nomes = [...mapa.keys()];
    const ply = nomes.find((n) => n.toLowerCase().endsWith(".ply"));
    const mod = await import("@/viewer/carregar");
    setGabarito(null);
    setCalibrada(true);
    await abrir({ tipo: "local", descricao: nomes.join(", ") }, () => (ply ? mod.carregarPly(mapa.get(ply)!) : mod.carregarObj(mapa)));
  }

  async function abrirSintetico(t: TorsoSintetico) {
    const mod = await import("@/viewer/carregar");
    const base = `/api/sinteticos/${t.nome}`;
    setCalibrada(true);
    if (t.gabarito && recursos.medicao_automatica_3d) {
      fetch(`${base}/gabarito.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((g) => setGabarito(g?.distancias ?? null))
        .catch(() => setGabarito(null));
    } else setGabarito(null);
    await abrir({ tipo: "sintetico", nome: t.nome }, () =>
      t.glb
        ? mod.carregarGlb(`${base}/torso.glb`)
        : mod.carregarObj(new Map([["torso.obj", `${base}/torso.obj`], ["torso.mtl", `${base}/torso.mtl`], ["textura.png", `${base}/textura.png`]])),
    );
  }

  function aoClicar(c: CliqueNaMalha) {
    if (ferramenta === "regua") {
      setPontosRegua((p) => (p.length >= 2 ? [c.posicao] : [...p, c.posicao]));
      return;
    }
    if (ferramenta === "landmarks") {
      const lm: Landmark = { posicao: c.posicao.map((v) => Math.round(v * 100) / 100) as Vetor3, vertice: c.vertice, origem: "clique" };
      const novos = { ...landmarks, [ativo]: lm };
      setLandmarks(novos);
      setMedicao(null);
      setEstadoMedicao("ocioso");
      const proximo = LANDMARK_IDS.find((id) => !novos[id]);
      if (proximo) setAtivo(proximo);
    }
  }

  const fatorPrevisto = useMemo(() => {
    const [p1, p2] = pontosRegua;
    const mm = Number(reguaMm.replace(",", "."));
    if (!p1 || !p2 || !(mm > 0)) return null;
    const d = distanciaEuclidiana(p1, p2);
    return d > 0 ? mm / d : null;
  }, [pontosRegua, reguaMm]);

  async function aplicarCalibracao() {
    if (fonte?.tipo !== "servidor" || pontosRegua.length !== 2) return;
    setCarregando(true);
    const r = await fetch(`/api/malhas/${fonte.malhaId}/reescalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regua_mm: Number(reguaMm.replace(",", ".")), pontos: pontosRegua }),
    });
    setCarregando(false);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: `Calibração falhou: ${await lerErro(r)}` });
    const j = await r.json();
    const versao = fonte.versao + 1;
    const { carregarGlb } = await import("@/viewer/carregar");
    await abrir({ ...fonte, versao }, () => carregarGlb(`/api/malhas/${fonte.malhaId}/arquivo?nome=processada.glb&v=${versao}`));
    setCalibrada(true);
    setFerramenta("landmarks");
    setMensagem({ tipo: "info", texto: `Escala aplicada (fator ${j.fator.toFixed(4)}). Landmarks anteriores foram invalidados.` });
  }

  // Euclidianas SÓ quando medicao_automatica_3d está ativo (DESENHO=B).
  const euclidianas = useMemo(() => (recursos.medicao_automatica_3d ? distanciasEuclidianas(landmarks) : null), [landmarks, recursos.medicao_automatica_3d]);

  const obrigatoriosOk = LANDMARKS_OBRIGATORIOS.every((id) => landmarks[id]);
  const indicesOk = !!carregada?.indicesCanonicos && fonte?.tipo === "servidor";

  async function medirNoServico() {
    if (!recursos.medicao_automatica_3d || fonte?.tipo !== "servidor") return;
    setEstadoMedicao("medindo");
    const r = await fetch("/api/medidas/medir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ malha_id: fonte.malhaId, landmarks }),
    });
    if (r.status === 503) return setEstadoMedicao("sem_servico");
    if (!r.ok) {
      setEstadoMedicao("erro");
      return setMensagem({ tipo: "erro", texto: `Medição falhou: ${await lerErro(r)}` });
    }
    setMedicao(await r.json());
    setEstadoMedicao("ok");
  }

  async function avaliarTepid() {
    setAvaliandoTepid(true);
    setErrosTepid([]);
    const r = await fetch("/api/tepid/avaliar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores: valoresTepid }) });
    setAvaliandoTepid(false);
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setResultadoTepid(null);
      setTepidValidado(null);
      setErrosTepid(j?.erro?.detalhes?.erros ?? []);
      return setMensagem({ tipo: "erro", texto: j?.erro?.mensagem ?? "TEPID inválido" });
    }
    setTepidValidado(j.valores);
    setResultadoTepid({ alertas: j.alertas ?? [], referencias: j.referencias ?? [] });
  }

  async function gravarTepid() {
    if (!paciente || !tepidValidado) return;
    const r = await fetch("/api/tepid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paciente_id: paciente.id, valores: tepidValidado }) });
    setMensagem(r.ok ? { tipo: "info", texto: "TEPID gravado." } : { tipo: "erro", texto: `TEPID não gravado: ${await lerErro(r)}` });
  }

  async function gravarMedidas() {
    if (fonte?.tipo !== "servidor") return;
    const corpo: Record<string, unknown> = { malha_id: fonte.malhaId, landmarks };
    if (tepidValidado) corpo.medidas_digitadas = tepidValidado;
    const r = await fetch("/api/medidas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: `Medidas não gravadas: ${await lerErro(r)}` });
    const j = await r.json();
    if (recursos.medicao_automatica_3d && j.distancias) {
      setMedicao({ distancias: j.distancias, volumes: j.volumes, quadro_anatomico: j.quadro_anatomico, geodesica: j.geodesica, avisos: [] });
      setEstadoMedicao("ok");
    }
    setMensagem({ tipo: "info", texto: `Registro de medidas gravado (${j.medida_id}).` });
  }

  // ---------------------------------------------------------------- viewer
  const marcadores: Marcador[] = useMemo(() => {
    const out: Marcador[] = [];
    for (const d of DEFINICOES_LANDMARKS) {
      const l = landmarks[d.id];
      if (l) out.push({ id: d.id, posicao: l.posicao, cor: d.obrigatorio ? "#d1242f" : "#8250df" });
    }
    pontosRegua.forEach((p, i) => out.push({ id: `regua-${i}`, posicao: p, cor: "#1f6feb" }));
    return out;
  }, [landmarks, pontosRegua]);

  const dims = carregada
    ? { x: carregada.caixa.max.x - carregada.caixa.min.x, y: carregada.caixa.max.y - carregada.caixa.min.y, z: carregada.caixa.max.z - carregada.caixa.min.z }
    : null;
  const podeMarcar = !!carregada && (calibrada || fonte?.tipo !== "servidor" || (fonte.tipo === "servidor" && fonte.sintetica));

  return (
    <div className="consulta">
      <div className="coluna-viewer">
        <div className="viewer" data-testid="viewer">
          {carregada || carregando ? (
            <Visualizador carregada={carregada} marcadores={marcadores} linhaRegua={pontosRegua.length === 2 ? [pontosRegua[0]!, pontosRegua[1]!] : null} clicavel={ferramenta !== "navegar"} onClique={aoClicar} />
          ) : (
            <div className="viewer-vazio">Nenhuma malha aberta. Envie um OBJ/PLY, abra um arquivo local ou um torso sintético.</div>
          )}
        </div>
        {carregada && dims && (
          <p className="caixa" data-testid="caixa-mm">
            Caixa envolvente: {fmt1(dims.x)} × {fmt1(dims.y)} × {fmt1(dims.z)} mm (X × Y × Z) · {carregada.nVertices.toLocaleString("pt-BR")} vértices · {carregada.origem.toUpperCase()}
            {carregada.quadro ? ` · quadro ${carregada.quadro}` : ""}
          </p>
        )}
        <p className="nota">+Y cranial, +Z anterior, +X lado esquerdo da paciente. Escala em mm, sem ajuste na carga.</p>
        <div className="ferramentas" role="toolbar" aria-label="Ferramenta de clique">
          {(["navegar", "regua", "landmarks"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={ferramenta === f} disabled={!carregada || (f === "landmarks" && !podeMarcar)} onClick={() => setFerramenta(f)}>
              {f === "navegar" ? "Girar/zoom" : f === "regua" ? "Régua (2 pontos)" : "Landmarks"}
            </button>
          ))}
        </div>
      </div>

      <div className="coluna-passos">
        {mensagem && (
          <p className={mensagem.tipo === "erro" ? "erro mensagem" : "info mensagem"} role={mensagem.tipo === "erro" ? "alert" : "status"}>
            {mensagem.texto}
          </p>
        )}
        <p className="status-mesh" data-testid="status-mesh">
          Serviço de malha: {meshDisponivel === null ? "verificando…" : meshDisponivel ? "disponível" : "aguardando serviço de malha"}
        </p>

        <section className="painel">
          <h3>1. Paciente (pseudônimo)</h3>
          {paciente ? (
            <p>
              Paciente <strong data-testid="pseudonimo">{paciente.pseudonimo}</strong>. O vínculo com a identidade fica no prontuário, fora deste sistema.
            </p>
          ) : (
            <button type="button" onClick={criarPaciente}>
              Novo atendimento (gera pseudônimo)
            </button>
          )}
        </section>

        <section className="painel">
          <h3>2. Malha 3D</h3>
          <form onSubmit={enviarMalha} className="linha-form">
            <label>
              Arquivos (OBJ + MTL + PNG/JPG, PLY ou ZIP)
              <input ref={arquivosUpload} type="file" multiple accept=".obj,.mtl,.png,.jpg,.jpeg,.ply,.zip" disabled={!paciente} data-testid="upload-arquivos" />
            </label>
            <label>
              Unidade do arquivo
              <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="desconhecida">desconhecida (inferir)</option>
                <option value="m">metros (3D Scanner App)</option>
                <option value="cm">centímetros</option>
                <option value="mm">milímetros</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={marcarSintetica} onChange={(e) => setMarcarSintetica(e.target.checked)} /> torso sintético
            </label>
            <button type="submit" disabled={!paciente || carregando}>
              Enviar e processar
            </button>
          </form>
          {!paciente && <p className="nota">Crie o atendimento para enviar ao serviço (recorte abaixo do pescoço + decimação 30–50 mil vértices).</p>}
          <details>
            <summary>Pré-visualizar arquivo local (sem enviar; não grava medidas)</summary>
            <div className="linha-form">
              <input ref={arquivosLocais} type="file" multiple accept=".obj,.mtl,.png,.jpg,.jpeg,.ply" data-testid="arquivos-locais" />
              <button type="button" onClick={abrirLocal} disabled={carregando}>
                Abrir no viewer
              </button>
            </div>
          </details>
          {sinteticos.length > 0 && (
            <div className="linha-form">
              <span>Torsos sintéticos:</span>
              {sinteticos.map((t) => (
                <button key={t.nome} type="button" onClick={() => abrirSintetico(t)} disabled={carregando || (!t.glb && !t.obj)}>
                  {t.nome}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="painel">
          <h3>3. Calibração pela régua</h3>
          <p className="nota">Escolha “Régua”, clique nos dois extremos da régua escaneada e digite o comprimento real. Ordem obrigatória: processar → calibrar → landmarks.</p>
          <div className="linha-form">
            <label>
              Comprimento real (mm)
              <input type="number" min={1} step="0.1" value={reguaMm} onChange={(e) => setReguaMm(e.target.value)} data-testid="regua-mm" />
            </label>
            <span data-testid="regua-pontos">{pontosRegua.length}/2 pontos</span>
            {fatorPrevisto !== null && <span>fator previsto {fatorPrevisto.toFixed(4)}</span>}
          </div>
          <div className="linha-form">
            <button type="button" onClick={aplicarCalibracao} disabled={fonte?.tipo !== "servidor" || pontosRegua.length !== 2 || carregando}>
              Aplicar calibração
            </button>
            {fonte?.tipo === "servidor" && !calibrada && (
              <button type="button" className="secundario" onClick={() => setCalibrada(true)}>
                Prosseguir sem régua (escala = unidade declarada)
              </button>
            )}
          </div>
          {fonte && fonte.tipo !== "servidor" && <p className="nota">Calibração só se aplica a malhas enviadas ao serviço.</p>}
        </section>

        <section className="painel" data-testid="landmarks-guia">
          <h3>4. Landmarks ({LANDMARKS_OBRIGATORIOS.length} obrigatórios + 4 da base)</h3>
          {!recursos.medicao_automatica_3d && <p className="nota">Desenho A: os landmarks servem só de âncora da simulação; nenhuma distância é calculada.</p>}
          <ol className="lista-landmarks">
            {DEFINICOES_LANDMARKS.map((d) => {
              const l = landmarks[d.id];
              return (
                <li key={d.id} className={ativo === d.id ? "ativo" : ""}>
                  <button type="button" className="link" onClick={() => setAtivo(d.id)} aria-current={ativo === d.id} title={d.instrucao}>
                    {d.rotulo}
                    {d.obrigatorio ? " *" : ""}
                  </button>
                  <span className="estado-landmark">{l ? `✓ v${l.vertice}` : "—"}</span>
                  {l && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        const { [d.id]: _removido, ...resto } = landmarks;
                        void _removido;
                        setLandmarks(resto);
                        setMedicao(null);
                      }}
                    >
                      apagar
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="nota">{DEFINICOES_LANDMARKS.find((d) => d.id === ativo)?.instrucao}</p>
          {carregada && !indicesOk && <p className="nota">Pré-visualização: índices de vértice não canônicos; para medir no serviço e gravar, envie a malha.</p>}
          <div className="linha-form">
            <button type="button" className="secundario" onClick={limparMedidas}>
              Limpar landmarks
            </button>
            {recursos.medicao_automatica_3d && (
              <button type="button" onClick={medirNoServico} disabled={!indicesOk || !obrigatoriosOk || estadoMedicao === "medindo"}>
                Medir geodésicas e volume
              </button>
            )}
            <button type="button" onClick={gravarMedidas} disabled={!indicesOk || (!recursos.medicao_automatica_3d && !tepidValidado)}>
              Gravar registro de medidas
            </button>
          </div>
        </section>

        <PainelDistancias recursos={recursos} euclidianas={euclidianas} medicao={medicao} estado={estadoMedicao} gabarito={fonte?.tipo === "sintetico" ? gabarito : null} />
        <PainelVolume recursos={recursos} medicao={medicao} estado={estadoMedicao} />

        <FormularioTepid
          recursos={recursos}
          tepid={config.tepid}
          valores={valoresTepid}
          onChange={(v) => {
            setValoresTepid(v);
            setTepidValidado(null);
          }}
          onAvaliar={avaliarTepid}
          avaliando={avaliandoTepid}
          resultado={resultadoTepid}
          erros={errosTepid}
        />
        {paciente && tepidValidado && (
          <button type="button" onClick={gravarTepid}>
            Gravar TEPID do paciente
          </button>
        )}
      </div>
    </div>
  );
}
