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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConfigPublica } from "@/config/publica";
import { distanciaEuclidiana, distanciasEuclidianas } from "@/medidas/geometria";
import type { MalhaCarregada } from "@/viewer/carregar";
import type { CliqueNaMalha, Marcador } from "@/viewer/Visualizador";
import { NOMES_VISTAS, VISTAS, type NomeVista } from "@/viewer/vistas";
import { FormularioTepid, valoresTepidVazios, type ErroCampoUI, type ResultadoTepidUI, type ValoresTepidForm } from "./FormularioTepid";
import { COR_BASE, COR_OBRIGATORIO, GuiaLandmarks, ROTULO_CURTO, numeroDoLandmark } from "./GuiaLandmarks";
import { Inicio, type PacienteResumo } from "./Inicio";
import { Mensagem, horaAgora, type MensagemLocal } from "./Mensagem";
import { PainelDistancias, PainelVolume, type EstadoMedicao } from "./PainelMedidas";
import { Passos, type PassoInfo } from "./Passos";
import { PainelSimulacao, type EstadoSimulacao } from "@/simulacao/PainelSimulacao";
import { PainelAnamnese } from "./PainelAnamnese";
import { PainelRelatorio } from "./PainelRelatorio";

const VisualizadorDinamico = dynamic(() => import("@/viewer/Visualizador"), {
  ssr: false,
  loading: () => <div className="viewer-vazio">Carregando visualizador 3D…</div>,
});
// Memo: mudanças de estado alheias ao viewer (simulação, TEPID) não re-renderizam o canvas principal.
const Visualizador = memo(VisualizadorDinamico);

type Fonte =
  | { tipo: "servidor"; malhaId: string; pseudonimo: string; sintetica: boolean; versao: number }
  | { tipo: "sintetico"; nome: string }
  | { tipo: "local"; descricao: string };

type Ferramenta = "navegar" | "regua" | "landmarks";

interface TorsoSintetico {
  nome: string;
  glb: boolean;
  obj: boolean;
  gabarito: boolean;
}

/** Nome para o cirurgião dos torsos sintéticos conhecidos (o código continua no card, em cinza). */
const NOMES_TORSOS: Record<string, { titulo: string; descricao: string }> = {
  t01_simetrico_300: { titulo: "Torso 1 — simétrico", descricao: "mamas simétricas de volume médio" },
  t02_assimetrico: { titulo: "Torso 2 — assimétrico", descricao: "diferença de volume entre os lados" },
  t03_pequeno_ptose: { titulo: "Torso 3 — pequeno com ptose", descricao: "volume pequeno e mamilo baixo" },
};

async function lerErro(r: Response): Promise<string> {
  try {
    const j = await r.json();
    return j?.erro?.mensagem ?? j?.erro?.codigo ?? `erro ${r.status}`;
  } catch {
    return `erro ${r.status}`;
  }
}

const fmt1 = (v: number) => v.toFixed(1).replace(".", ",");
/** Valor do campo TEPID (input type=number, passo 0,5): ponto decimal, múltiplo de 0,5. */
const valorCampo = (v: number) => String(Math.round(v * 2) / 2);

export function Consulta({ config }: { config: ConfigPublica }) {
  const { recursos } = config;

  // ---------------------------------------------------------------- estado
  const [paciente, setPaciente] = useState<PacienteResumo | null>(null);
  const [fonte, setFonte] = useState<Fonte | null>(null);
  const [carregada, setCarregada] = useState<MalhaCarregada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [processando, setProcessando] = useState<string | null>(null);
  // feedback junto da ação que o gerou (um por bloco; nenhum sobrescreve o outro)
  const [msgCaptura, setMsgCaptura] = useState<MensagemLocal | null>(null);
  const [msgEscala, setMsgEscala] = useState<MensagemLocal | null>(null);
  const [msgMedidas, setMsgMedidas] = useState<MensagemLocal | null>(null);
  const [msgTepid, setMsgTepid] = useState<MensagemLocal | null>(null);
  const [meshDisponivel, setMeshDisponivel] = useState<boolean | null>(null);
  const [sinteticos, setSinteticos] = useState<TorsoSintetico[]>([]);
  const [gabarito, setGabarito] = useState<Partial<Record<DistanciaId, { euclidiana_mm: number; geodesica_mm: number | null }>> | null>(null);

  const [unidade, setUnidade] = useState("desconhecida");
  const arquivosUpload = useRef<HTMLInputElement>(null);
  const arquivosLocais = useRef<HTMLInputElement>(null);
  const urlsLocais = useRef<string[]>([]);

  const [ferramenta, setFerramenta] = useState<Ferramenta>("navegar");
  const [vista, setVista] = useState<NomeVista>("frente");
  const [landmarksGabarito, setLandmarksGabarito] = useState<Record<string, { posicao: Vetor3 }> | null>(null);
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
  /** Base pré-preenchida pelo 3D (só DESENHO=B; em A nunca é calculada). */
  const [basePre, setBasePre] = useState<{ dir: string | null; esq: string | null } | null>(null);
  /** Fotografia do que foi gravado por último (indicador "alterações não salvas"). */
  const [salvoTepid, setSalvoTepid] = useState<string | null>(null);
  const [salvoMedidas, setSalvoMedidas] = useState<string | null>(null);
  /**
   * Estado da simulação mostrada (implantes, plano, IMF, peso, envelope, não calibrado, previsto só em B).
   * Disponível para o relatório/PDF do Marco 2b (PainelRelatorio) — ver README.
   */
  const [estadoSimulacao, setEstadoSimulacao] = useState<EstadoSimulacao | null>(null);
  /** Atendimento (Marco 2b): criado pela anamnese ou pelo relatório e repassado entre os painéis. */
  const [atendimentoId, setAtendimentoId] = useState<string | null>(null);
  /** Último registro de medidas gravado nesta malha (vai para o relatório/PDF). */
  const [medidaId, setMedidaId] = useState<string | null>(null);

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

  /**
   * Pré-preenche a base do TEPID com a largura da base medida no 3D (linha reta), só em DESENHO=B e
   * só quando o campo está vazio ou ainda com o valor pré-preenchido antes (nunca apaga o digitado).
   */
  const valoresTepidRef = useRef(valoresTepid);
  const basePreRef = useRef(basePre);
  useLayoutEffect(() => {
    valoresTepidRef.current = valoresTepid;
    basePreRef.current = basePre;
  });
  const preencherBase = useCallback(
    (novos: Landmarks) => {
      if (!recursos.medicao_automatica_3d) return;
      const e = distanciasEuclidianas(novos);
      const pre = { dir: e.base_dir !== null ? valorCampo(e.base_dir) : null, esq: e.base_esq !== null ? valorCampo(e.base_esq) : null };
      const antigo = basePreRef.current;
      const v = valoresTepidRef.current;
      const base = { ...v.base_mm };
      let mudou = false;
      for (const lado of ["dir", "esq"] as const) {
        const livre = base[lado] === "" || base[lado] === antigo?.[lado];
        const novo = pre[lado] ?? "";
        if (livre && base[lado] !== novo) {
          base[lado] = novo;
          mudou = true;
        }
      }
      basePreRef.current = pre;
      setBasePre(pre);
      if (mudou) {
        const nv = { ...v, base_mm: base };
        valoresTepidRef.current = nv;
        setValoresTepid(nv);
        setTepidValidado(null);
      }
    },
    [recursos.medicao_automatica_3d],
  );

  const limparMedidas = useCallback(() => {
    setLandmarks({});
    setAtivo("furcula");
    setMedicao(null);
    setEstadoMedicao("ocioso");
    preencherBase({});
  }, [preencherBase]);

  const abrir = useCallback(
    async (novaFonte: Fonte, carregar: () => Promise<MalhaCarregada>) => {
      setCarregando(true);
      setMsgCaptura(null);
      try {
        const m = await carregar();
        setCarregada(m);
        setFonte(novaFonte);
        setMedidaId(null);
        setSalvoMedidas(null);
        setPontosRegua([]);
        limparMedidas();
        // passo 2 começa com a marcação ativa; scan enviado espera a escala (régua) antes
        setFerramenta(novaFonte.tipo === "servidor" && !novaFonte.sintetica ? "navegar" : "landmarks");
        return true;
      } catch (e) {
        setMsgCaptura({ tipo: "erro", texto: (e as Error).message });
        return false;
      } finally {
        setCarregando(false);
      }
    },
    [limparMedidas],
  );

  // ---------------------------------------------------------------- ações
  async function criarPaciente(): Promise<PacienteResumo | null> {
    const r = await fetch("/api/pacientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) {
      setMsgCaptura({ tipo: "erro", texto: `Não foi possível criar o atendimento: ${await lerErro(r)}` });
      return null;
    }
    const j = await r.json();
    const p = { id: j.id, pseudonimo: j.pseudonimo, criado_em: j.criado_em };
    setPaciente(p);
    return p;
  }

  async function enviarMalha(e: React.FormEvent) {
    e.preventDefault();
    const files = arquivosUpload.current?.files;
    if (!paciente || !files || files.length === 0) return;
    const fd = new FormData();
    fd.set("paciente_id", paciente.id);
    fd.set("unidade_origem", unidade);
    fd.set("recorte_modo", "abaixo_do_pescoco");
    for (const f of Array.from(files)) fd.append("arquivos", f, f.name);
    setCarregando(true);
    setProcessando("Enviando e preparando o scan…");
    setMsgCaptura(null);
    const r = await fetch("/api/malhas", { method: "POST", body: fd });
    setCarregando(false);
    setProcessando(null);
    if (!r.ok) return setMsgCaptura({ tipo: "erro", texto: `Envio falhou: ${await lerErro(r)}` });
    const j = await r.json();
    setCalibrada(false);
    setLandmarksGabarito(null);
    setGabarito(null);
    setMsgEscala(null);
    const { carregarGlb } = await import("@/viewer/carregar");
    const ok = await abrir({ tipo: "servidor", malhaId: j.malha_id, pseudonimo: j.pseudonimo, sintetica: false, versao: 1 }, () =>
      carregarGlb(`/api/malhas/${j.malha_id}/arquivo?nome=processada.glb&v=1`),
    );
    if (ok) setMsgCaptura({ tipo: "ok", texto: "Malha processada ✓ — no passo 2, ajuste a escala pela régua antes de marcar os pontos.", dados: { "data-malha-id": j.malha_id } });
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

  /** Pré-visualização do GLB do gerador (não grava; fica em "Avançado"). */
  async function abrirSintetico(t: TorsoSintetico) {
    const mod = await import("@/viewer/carregar");
    const base = `/api/sinteticos/${t.nome}`;
    setCalibrada(true);
    setLandmarksGabarito(null);
    if (t.gabarito && recursos.medicao_automatica_3d) {
      fetch(`${base}/gabarito.json`)
        .then(async (r) => {
          if (r.status === 403 && (await r.clone().json().catch(() => null))?.erro?.codigo === "gabarito_oculto_sessao_aberta") {
            setMsgCaptura({ tipo: "info", texto: `Referência de ${t.nome} bloqueada: há sessão de validação aberta com este torso.` });
          }
          return r.ok ? r.json() : null;
        })
        .then((g) => setGabarito(g?.distancias ?? null))
        .catch(() => setGabarito(null));
    } else setGabarito(null);
    await abrir({ tipo: "sintetico", nome: t.nome }, () =>
      t.glb
        ? mod.carregarGlb(`${base}/torso.glb`)
        : mod.carregarObj(new Map([["torso.obj", `${base}/torso.obj`], ["torso.mtl", `${base}/torso.mtl`], ["textura.png", `${base}/textura.png`]])),
    );
  }

  /** Torso sintético pelo MESMO caminho de uma malha enviada (ADR 0003 item 9). Sem atendimento, cria um. */
  async function importarSintetico(t: TorsoSintetico) {
    const p = paciente ?? (await criarPaciente());
    if (!p) return;
    setCarregando(true);
    setProcessando(`Preparando ${NOMES_TORSOS[t.nome]?.titulo ?? t.nome}… (cerca de 15 s)`);
    setMsgCaptura(null);
    const r = await fetch(`/api/sinteticos/${t.nome}/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paciente_id: p.id }) });
    setCarregando(false);
    setProcessando(null);
    if (!r.ok) return setMsgCaptura({ tipo: "erro", texto: `Não foi possível preparar o torso: ${await lerErro(r)}` });
    const j = await r.json();
    setCalibrada(true);
    setMsgEscala(null);
    setGabarito(recursos.medicao_automatica_3d ? (j.gabarito?.distancias ?? null) : null);
    setLandmarksGabarito(j.gabarito?.landmarks ?? null);
    const { carregarGlb } = await import("@/viewer/carregar");
    const ok = await abrir({ tipo: "servidor", malhaId: j.malha_id, pseudonimo: j.pseudonimo, sintetica: true, versao: 1 }, () =>
      carregarGlb(`/api/malhas/${j.malha_id}/arquivo?nome=processada.glb&v=1`),
    );
    if (ok)
      setMsgCaptura({
        tipo: "ok",
        texto: `Torso ${t.nome} processado ✓${j.gabarito_bloqueado ? " (pontos de referência bloqueados: há sessão de validação aberta com este torso)" : ""}`,
        dados: { "data-malha-id": j.malha_id },
      });
  }

  /** Landmarks `origem: "gabarito"` (contratos §2) projetados no vértice mais próximo da malha aberta. */
  async function aplicarLandmarksGabarito() {
    if (!carregada || !landmarksGabarito) return;
    const { verticeMaisProximoGlobal } = await import("@/viewer/carregar");
    const novos: Landmarks = {};
    for (const id of LANDMARK_IDS) {
      const g = landmarksGabarito[id];
      if (g) novos[id] = { posicao: g.posicao, vertice: verticeMaisProximoGlobal(carregada.malha.geometry, g.posicao), origem: "gabarito" };
    }
    setLandmarks(novos);
    setMedicao(null);
    setEstadoMedicao("ocioso");
    preencherBase(novos);
  }

  function apagarLandmark(id: LandmarkId) {
    const { [id]: _removido, ...resto } = landmarks;
    void _removido;
    setLandmarks(resto);
    setMedicao(null);
    setAtivo(id);
    preencherBase(resto);
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
      preencherBase(novos);
      const proximo = LANDMARK_IDS.find((id) => !novos[id]);
      if (proximo) setAtivo(proximo);
    }
  }

  // callback estável para o viewer memoizado (sempre chama a versão mais recente de aoClicar)
  const aoClicarRef = useRef(aoClicar);
  useLayoutEffect(() => {
    aoClicarRef.current = aoClicar;
  });
  const aoClicarEstavel = useCallback((c: CliqueNaMalha) => aoClicarRef.current(c), []);
  const linhaRegua = useMemo<[Vetor3, Vetor3] | null>(() => (pontosRegua.length === 2 ? [pontosRegua[0]!, pontosRegua[1]!] : null), [pontosRegua]);

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
    if (!r.ok) return setMsgEscala({ tipo: "erro", texto: `Não foi possível aplicar a escala: ${await lerErro(r)}` });
    const j = await r.json();
    const versao = fonte.versao + 1;
    const { carregarGlb } = await import("@/viewer/carregar");
    await abrir({ ...fonte, versao }, () => carregarGlb(`/api/malhas/${fonte.malhaId}/arquivo?nome=processada.glb&v=${versao}`));
    setCalibrada(true);
    setFerramenta("landmarks");
    setMsgEscala({ tipo: "ok", texto: `Escala aplicada (fator ${j.fator.toFixed(4)}) ✓ Pontos marcados antes foram apagados.` });
  }

  function prosseguirSemRegua() {
    setCalibrada(true);
    setFerramenta("landmarks");
    setMsgEscala({ tipo: "info", texto: "Escala mantida (unidade declarada no envio)." });
  }

  // Euclidianas SÓ quando medicao_automatica_3d está ativo (DESENHO=B).
  const euclidianas = useMemo(() => (recursos.medicao_automatica_3d ? distanciasEuclidianas(landmarks) : null), [landmarks, recursos.medicao_automatica_3d]);

  const obrigatoriosOk = LANDMARKS_OBRIGATORIOS.every((id) => landmarks[id]);
  const indicesOk = !!carregada?.indicesCanonicos && fonte?.tipo === "servidor";

  async function medirNoServico() {
    if (!recursos.medicao_automatica_3d || fonte?.tipo !== "servidor") return;
    setEstadoMedicao("medindo");
    setMsgMedidas(null);
    const r = await fetch("/api/medidas/medir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ malha_id: fonte.malhaId, landmarks }),
    });
    if (r.status === 503) return setEstadoMedicao("sem_servico");
    if (!r.ok) {
      setEstadoMedicao("erro");
      return setMsgMedidas({ tipo: "erro", texto: `Medição falhou: ${await lerErro(r)}` });
    }
    setMedicao(await r.json());
    setEstadoMedicao("ok");
  }

  async function avaliarTepid() {
    setAvaliandoTepid(true);
    setErrosTepid([]);
    setMsgTepid(null);
    const r = await fetch("/api/tepid/avaliar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores: valoresTepid }) });
    setAvaliandoTepid(false);
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setResultadoTepid(null);
      setTepidValidado(null);
      setErrosTepid(j?.erro?.detalhes?.erros ?? []);
      return setMsgTepid({ tipo: "erro", texto: j?.erro?.mensagem ?? "Medidas inválidas" });
    }
    setTepidValidado(j.valores);
    setResultadoTepid({ alertas: j.alertas ?? [], referencias: j.referencias ?? [] });
  }

  async function gravarTepid() {
    if (!paciente || !tepidValidado) return;
    const r = await fetch("/api/tepid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paciente_id: paciente.id, valores: tepidValidado }) });
    if (r.ok) {
      setSalvoTepid(JSON.stringify(valoresTepid));
      setMsgTepid({ tipo: "ok", texto: "TEPID gravado. ✓", hora: horaAgora() });
    } else setMsgTepid({ tipo: "erro", texto: `TEPID não gravado: ${await lerErro(r)}` });
  }

  const fotoMedidas = JSON.stringify({ landmarks, tepidValidado });
  async function gravarMedidas() {
    if (fonte?.tipo !== "servidor") return;
    const corpo: Record<string, unknown> = { malha_id: fonte.malhaId, landmarks };
    if (tepidValidado) corpo.medidas_digitadas = tepidValidado;
    const foto = fotoMedidas;
    const r = await fetch("/api/medidas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (!r.ok) return setMsgMedidas({ tipo: "erro", texto: `Medidas não gravadas: ${await lerErro(r)}` });
    const j = await r.json();
    if (recursos.medicao_automatica_3d && j.distancias) {
      setMedicao({ distancias: j.distancias, volumes: j.volumes, quadro_anatomico: j.quadro_anatomico, geodesica: j.geodesica, avisos: [] });
      setEstadoMedicao("ok");
    }
    setMedidaId(j.medida_id);
    setSalvoMedidas(foto);
    setMsgMedidas({ tipo: "ok", texto: "Registro de medidas gravado ✓", hora: horaAgora(), dados: { "data-medida-id": j.medida_id } });
  }

  // ---------------------------------------------------------------- viewer
  const marcadores: Marcador[] = useMemo(() => {
    const out: Marcador[] = [];
    for (const d of DEFINICOES_LANDMARKS) {
      const l = landmarks[d.id];
      if (l) out.push({ id: d.id, posicao: l.posicao, cor: d.obrigatorio ? COR_OBRIGATORIO : COR_BASE, rotulo: `${numeroDoLandmark(d.id)} ${ROTULO_CURTO[d.id]}` });
    }
    pontosRegua.forEach((p, i) => out.push({ id: `regua-${i}`, posicao: p, cor: "#1f6feb", rotulo: `régua ${i + 1}` }));
    return out;
  }, [landmarks, pontosRegua]);

  const dims = carregada
    ? { x: carregada.caixa.max.x - carregada.caixa.min.x, y: carregada.caixa.max.y - carregada.caixa.min.y, z: carregada.caixa.max.z - carregada.caixa.min.z }
    : null;
  const escaneada = fonte?.tipo === "servidor" && !fonte.sintetica;
  const podeMarcar = !!carregada && (calibrada || fonte?.tipo !== "servidor" || (fonte.tipo === "servidor" && fonte.sintetica));

  const faltam = LANDMARK_IDS.filter((id) => !landmarks[id]).length;
  const todosLandmarks = faltam === 0;
  const motivoBloqueioSimulacao = !fonte || fonte.tipo !== "servidor"
    ? "Prepare o scan (ou um torso sintético) no passo 1 para simular."
    : !indicesOk
      ? "Este scan não pode ser simulado: prepare-o de novo no passo 1."
      : !todosLandmarks
        ? "Marque os 10 pontos no passo 2 (os 4 da base definem a pegada do implante)."
        : null;

  // ---------------------------------------------------------------- passos
  const passos: PassoInfo[] = [
    {
      n: 1,
      titulo: "Captura",
      feito: fonte?.tipo === "servidor",
      motivo: !paciente
        ? "Comece com “Nova simulação”."
        : fonte?.tipo !== "servidor"
          ? config.demo
            ? "Escolha um torso e toque em “Usar este torso”."
            : "Envie o scan (ou use um torso sintético) para continuar."
          : null,
    },
    {
      n: 2,
      titulo: "Medidas",
      feito: todosLandmarks && (!recursos.medicao_automatica_3d || estadoMedicao === "ok"),
      motivo: fonte?.tipo !== "servidor"
        ? "Conclua o passo 1."
        : !podeMarcar
          ? "Ajuste a escala pela régua (ou prossiga sem régua)."
          : !todosLandmarks
          ? `Marque os 10 pontos (faltam ${faltam}).`
          : recursos.medicao_automatica_3d && estadoMedicao !== "ok"
            ? "Toque em “Medir” para ver as medidas."
            : null,
    },
    { n: 3, titulo: "Simulação", feito: estadoSimulacao !== null, motivo: null },
  ];

  const definicaoAtiva = DEFINICOES_LANDMARKS.find((d) => d.id === ativo)!;
  const importaveis = sinteticos.filter((t) => t.obj);

  return (
    <>
      <Passos passos={passos} />
      {/* ------------------------------------------------ passo 1: captura */}
      <section className="passo-secao" data-passo="1" aria-labelledby="titulo-passo-1">
        <div className="passo-cabecalho">
          <h2 id="titulo-passo-1">
            <span className="passo-num" aria-hidden="true">
              1
            </span>{" "}
            Captura
          </h2>
          {config.demo && (
            <p className="nota" data-testid="upload-desligado-demo">
              Demonstração: só torsos sintéticos (envio de scan desligado).
            </p>
          )}
        </div>
        <Inicio paciente={paciente} onNovo={() => void criarPaciente()} onRetomar={setPaciente} ocupado={carregando} />

        {config.demo ? null : (
          <form onSubmit={enviarMalha} className="linha-form envio-scan">
            <label>
              Scan (ZIP do 3D Scanner App, OBJ + MTL + imagem, ou PLY)
              <input ref={arquivosUpload} type="file" multiple accept=".obj,.mtl,.png,.jpg,.jpeg,.ply,.zip" disabled={!paciente} data-testid="upload-arquivos" />
            </label>
            <label>
              Unidade do arquivo
              <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="desconhecida">detectar</option>
                <option value="m">metros (3D Scanner App)</option>
                <option value="cm">centímetros</option>
                <option value="mm">milímetros</option>
              </select>
            </label>
            <button type="submit" disabled={!paciente || carregando}>
              Enviar e processar
            </button>
          </form>
        )}

        {importaveis.length > 0 && (
          // depois da captura os cards recolhem (a página fica curta); abrem de novo para trocar de torso
          <details className="torsos" open={fonte?.tipo !== "servidor"} data-testid="torsos-sinteticos">
            <summary>{fonte?.tipo === "servidor" ? "Trocar de torso sintético" : "Torsos sintéticos"}</summary>
            <div className="cards-torsos" role="list" aria-label="Torsos sintéticos">
              {importaveis.map((t) => (
                <div key={t.nome} className="card-torso" role="listitem" data-selecionado={fonte?.tipo === "servidor" && fonte.sintetica && msgCaptura?.texto.includes(t.nome) ? "1" : "0"}>
                  <div className="card-torso-titulo">{NOMES_TORSOS[t.nome]?.titulo ?? t.nome}</div>
                  <div className="nota">{NOMES_TORSOS[t.nome]?.descricao ?? "torso sintético"}</div>
                  <button type="button" onClick={() => void importarSintetico(t)} disabled={carregando} data-testid={`importar-${t.nome}`}>
                    Usar este torso
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}

        {processando && (
          <div className="progresso" role="status" aria-live="polite">
            <progress aria-label="Processando" />
            <span>{processando}</span>
          </div>
        )}
        <Mensagem msg={msgCaptura} testId="mensagem-captura" />


        <details className="avancado" data-testid="avancado-captura">
          <summary>Avançado</summary>
          <p className="status-mesh" data-testid="status-mesh">
            Serviço de malha: {meshDisponivel === null ? "verificando…" : meshDisponivel ? "disponível" : "aguardando serviço de malha"}
          </p>
          {carregada && dims && (
            <p className="caixa" data-testid="caixa-mm">
              Caixa envolvente: {fmt1(dims.x)} × {fmt1(dims.y)} × {fmt1(dims.z)} mm (X × Y × Z) · {carregada.nVertices.toLocaleString("pt-BR")} vértices · {carregada.origem.toUpperCase()}
              {carregada.quadro ? ` · quadro ${carregada.quadro}` : ""}
            </p>
          )}
          <p className="nota">+Y cranial, +Z anterior, +X lado esquerdo da paciente. Escala em mm, sem ajuste na carga.</p>
          {fonte?.tipo === "servidor" && <p className="nota">Malha {fonte.malhaId} (versão {fonte.versao}).</p>}
          {sinteticos.length > 0 && (
            <div className="linha-form">
              <span>Pré-visualizar sem gravar:</span>
              {sinteticos.map((t) => (
                <button key={t.nome} type="button" className="secundario" onClick={() => void abrirSintetico(t)} disabled={carregando || (!t.glb && !t.obj)} title="Pré-visualizar o GLB do gerador (não grava)">
                  {t.nome}
                </button>
              ))}
            </div>
          )}
          {!config.demo && (
            <div className="linha-form">
              <label>
                Pré-visualizar arquivo local (sem enviar; não grava medidas)
                <input ref={arquivosLocais} type="file" multiple accept=".obj,.mtl,.png,.jpg,.jpeg,.ply" data-testid="arquivos-locais" />
              </label>
              <button type="button" className="secundario" onClick={abrirLocal} disabled={carregando}>
                Abrir no viewer
              </button>
            </div>
          )}
        </details>
      </section>

      {/* ------------------------------------------------ passo 2: medidas */}
      <section className="passo-secao" data-passo="2" aria-labelledby="titulo-passo-2">
        <h2 id="titulo-passo-2">
          <span className="passo-num" aria-hidden="true">
            2
          </span>{" "}
          Medidas
        </h2>
        <div className="consulta">
          <div className="coluna-viewer">
            <div className="viewer" data-testid="viewer">
              {carregada || carregando ? (
                <Visualizador carregada={carregada} marcadores={marcadores} linhaRegua={linhaRegua} clicavel={ferramenta !== "navegar"} vista={vista} onClique={aoClicarEstavel} />
              ) : (
                <div className="viewer-vazio">{config.demo ? "Escolha um torso sintético no passo 1." : "Envie o scan (ou use um torso sintético) no passo 1."}</div>
              )}
            </div>
            <div className="ferramentas" role="toolbar" aria-label="Vista da câmera">
              {NOMES_VISTAS.slice(0, 5).map((v) => (
                <button key={v} type="button" className="secundario" aria-pressed={vista === v} disabled={!carregada} onClick={() => setVista(v)} data-testid={`vista-${v}`}>
                  {VISTAS[v].rotulo}
                </button>
              ))}
              <details className="mais-vistas" data-testid="mais-vistas">
                <summary>Mais vistas</summary>
                <div className="ferramentas">
                  {NOMES_VISTAS.slice(5).map((v) => (
                    <button key={v} type="button" className="secundario" aria-pressed={vista === v} disabled={!carregada} onClick={() => setVista(v)} data-testid={`vista-${v}`}>
                      {VISTAS[v].rotulo}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <div className="ferramentas" role="toolbar" aria-label="Ferramenta de toque">
              <button type="button" className="secundario" aria-pressed={ferramenta === "navegar"} disabled={!carregada} onClick={() => setFerramenta("navegar")}>
                Girar/zoom
              </button>
              {escaneada && (
                <button type="button" className="secundario" aria-pressed={ferramenta === "regua"} disabled={!carregada} onClick={() => setFerramenta("regua")}>
                  Régua (2 pontos)
                </button>
              )}
              <button type="button" className="secundario" aria-pressed={ferramenta === "landmarks"} disabled={!carregada || !podeMarcar} onClick={() => setFerramenta("landmarks")}>
                Marcar pontos
              </button>
            </div>
          </div>
          <div className="coluna-passos">
            {escaneada && (
              <details className="ajustar-escala" open={!calibrada} data-testid="ajustar-escala">
                <summary>Ajustar escala (régua)</summary>
                <p className="nota">
                  {calibrada
                    ? "Escala definida. Para refazer, marque de novo os dois extremos da régua."
                    : "Antes de marcar os pontos: toque em “Régua”, toque nos dois extremos da régua escaneada e digite o comprimento real. Sem régua no scan, prossiga com a unidade informada no envio."}
                </p>
                <div className="linha-form">
                  <label>
                    Comprimento real (mm)
                    <input type="number" inputMode="decimal" min={1} step="0.1" value={reguaMm} onChange={(e) => setReguaMm(e.target.value)} data-testid="regua-mm" />
                  </label>
                  <span data-testid="regua-pontos">{pontosRegua.length}/2 pontos</span>
                  {fatorPrevisto !== null && <span className="nota">fator previsto {fatorPrevisto.toFixed(4)}</span>}
                </div>
                <div className="linha-form">
                  <button type="button" onClick={aplicarCalibracao} disabled={pontosRegua.length !== 2 || carregando}>
                    Aplicar calibração
                  </button>
                  {!calibrada && (
                    <button type="button" className="secundario" onClick={prosseguirSemRegua}>
                      Prosseguir sem régua
                    </button>
                  )}
                  {pontosRegua.length !== 2 && <span className="nota">Marque os 2 extremos da régua para aplicar.</span>}
                </div>
                <Mensagem msg={msgEscala} testId="mensagem-escala" />
              </details>
            )}
            {!recursos.medicao_automatica_3d && <p className="nota">Os pontos servem só para posicionar a simulação; nenhuma distância é calculada a partir do 3D.</p>}
            <p className="instrucao-ativa" aria-live="polite">
              {!carregada
                ? "Os pontos são marcados tocando no 3D, depois do passo 1."
                : todosLandmarks
                  ? "Os 10 pontos estão marcados ✓"
                  : !podeMarcar
                    ? "Ajuste a escala pela régua (acima) antes de marcar os pontos."
                    : `Toque no ponto ${numeroDoLandmark(ativo)} — ${definicaoAtiva.rotulo}: ${definicaoAtiva.instrucao}`}
            </p>
            <GuiaLandmarks landmarks={landmarks} ativo={ativo} onAtivar={setAtivo} onApagar={apagarLandmark} />
            {carregada && !indicesOk && <p className="nota">Pré-visualização: para medir e gravar, use “Usar este torso” ou envie o scan.</p>}
            <div className="linha-form">
              {landmarksGabarito && fonte?.tipo === "servidor" && fonte.sintetica && (
                <button type="button" className="secundario" onClick={aplicarLandmarksGabarito} data-testid="aplicar-gabarito">
                  Pontos do torso sintético
                </button>
              )}
              {recursos.medicao_automatica_3d && (
                <button type="button" className="primario" onClick={medirNoServico} disabled={!indicesOk || !obrigatoriosOk || estadoMedicao === "medindo"} aria-label="Medir geodésicas e volume">
                  {estadoMedicao === "medindo" ? "Medindo…" : "Medir"}
                </button>
              )}
              <button type="button" className="secundario" onClick={limparMedidas} disabled={Object.keys(landmarks).length === 0}>
                Limpar pontos
              </button>
            </div>

            {recursos.medicao_automatica_3d && (
              <div className="medidas-grade">
                <PainelDistancias recursos={recursos} euclidianas={euclidianas} medicao={medicao} estado={estadoMedicao} gabarito={fonte?.tipo === "sintetico" || (fonte?.tipo === "servidor" && fonte.sintetica) ? gabarito : null} />
                <PainelVolume recursos={recursos} medicao={medicao} estado={estadoMedicao} />
              </div>
            )}
          </div>
        </div>

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
          basePreenchida={basePre}
          rodape={
            <>
              {paciente && tepidValidado && (
                <button type="button" onClick={gravarTepid}>
                  Gravar TEPID do paciente
                </button>
              )}
              <button type="button" onClick={gravarMedidas} disabled={!indicesOk || (!recursos.medicao_automatica_3d && !tepidValidado)}>
                Gravar registro de medidas
              </button>
              {!recursos.medicao_automatica_3d && !tepidValidado && indicesOk && <span className="nota">Valide as medidas digitadas para gravar o registro.</span>}
              <Mensagem msg={msgTepid} naoSalvo={salvoTepid !== null && salvoTepid !== JSON.stringify(valoresTepid)} testId="mensagem-tepid" />
              <Mensagem msg={msgMedidas} naoSalvo={salvoMedidas !== null && salvoMedidas !== fotoMedidas} testId="mensagem-medidas" />
            </>
          }
        />
      </section>

      {/* ------------------------------------------------ passo 3: simulação */}
      <section className="passo-secao passo-simulacao" data-passo="3" aria-labelledby="titulo-passo-3">
        <h2 id="titulo-passo-3">
          <span className="passo-num" aria-hidden="true">
            3
          </span>{" "}
          Simulação
        </h2>
        {/*
          SLOT DO PAINEL DE SIMULAÇÃO (pacote P1). O P3 só moveu o componente para o passo 3; a chamada
          e as props são as de antes (contrato C2). INTEGRAÇÃO: acrescentar aqui a prop opcional
            baseMedidaMm={euclidianas ? { dir: euclidianas.base_dir, esq: euclidianas.base_esq } : null}
          (só valores em mm; `euclidianas` é null em DESENHO=A, então o filtro pela base nunca existe em A;
          se o P1 exigir números, filtrar null: base_dir/base_esq podem faltar sem os pontos da base).
        */}
        <PainelSimulacao
          recursos={recursos}
          envelopeMm={config.envelope_rms_mm}
          malhaId={fonte?.tipo === "servidor" ? fonte.malhaId : null}
          landmarks={landmarks}
          prontoParaSimular={motivoBloqueioSimulacao === null}
          motivoBloqueio={motivoBloqueioSimulacao}
          pincaPoloSuperiorMm={tepidValidado?.pinca_polo_superior_mm ?? null}
          onEstado={setEstadoSimulacao}
        />
        {paciente && (
          <div className="paineis-atendimento" id="registro">
            <PainelRelatorio
              pacienteId={paciente.id}
              desenho={config.desenho}
              malhaId={fonte?.tipo === "servidor" ? fonte.malhaId : null}
              medidaId={medidaId}
              atendimentoId={atendimentoId}
              onAtendimento={setAtendimentoId}
            />
            {config.demo ? (
              <p className="nota" data-testid="anamnese-desligada-demo">
                Demonstração: anamnese em texto livre desligada (nenhum dado real entra nesta instância).
              </p>
            ) : (
              <PainelAnamnese pacienteId={paciente.id} atendimentoId={atendimentoId} onRegistrada={(r) => setAtendimentoId(r.atendimentoId)} />
            )}
          </div>
        )}
      </section>
      <span hidden data-testid="estado-simulacao" data-implantes={estadoSimulacao?.implantes.map((i) => i.id).join(",") ?? ""} data-plano={estadoSimulacao?.plano ?? ""} data-imf={estadoSimulacao?.imf ?? ""} />
    </>
  );
}
