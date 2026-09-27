"use client";

import { DEFINICOES_LANDMARKS, LANDMARK_IDS, type Landmark, type LandmarkId, type Landmarks, type Vetor3 } from "@simulador/contratos";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { carregarGlb, type MalhaCarregada } from "@/viewer/carregar";
import type { CliqueNaMalha, Marcador } from "@/viewer/Visualizador";
import { NOMES_VISTAS, VISTAS, type NomeVista } from "@/viewer/vistas";
import type { ResultadoBlandAltman } from "./estatistica";
import type { ResultadoSessao, VistaSessao } from "./sessao";

const Visualizador = memo(
  dynamic(() => import("@/viewer/Visualizador"), {
    ssr: false,
    loading: () => <div className="viewer-vazio">Carregando visualizador 3D…</div>,
  }),
);

async function lerErro(r: Response): Promise<string> {
  try {
    const j = await r.json();
    return j?.erro?.mensagem ?? j?.erro?.codigo ?? `erro ${r.status}`;
  } catch {
    return `erro ${r.status}`;
  }
}

const postJson = (url: string, corpo: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const f3 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : (v >= 0 ? "+" : "") + v.toFixed(3).replace(".", ","));
const d3 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(3).replace(".", ","));
const simNao = (v: boolean | null) => (v === null ? "—" : v ? "sim" : "não");

function LinhaBA({ rotulo, r, testid }: { rotulo: string; r: ResultadoBlandAltman; testid: string }) {
  return (
    <tr data-testid={testid}>
      <td>{rotulo}</td>
      <td className="num">{r.n}</td>
      <td className="num">{f3(r.vies_mm)}</td>
      <td className="num">{d3(r.dp_mm)}</td>
      <td className="num">
        [{f3(r.loa_inferior_mm)}; {f3(r.loa_superior_mm)}]
      </td>
      <td className="num">{simNao(r.dentro_de_3mm)}</td>
      <td className="num">{simNao(r.dentro_de_2mm)}</td>
    </tr>
  );
}

function Resultado({ sessao }: { sessao: VistaSessao }) {
  if (sessao.resultado_oculto) {
    return (
      <section className="painel" data-testid="resultado-oculto">
        <h3>Resultado oculto</h3>
        <p>Um torso desta sessão está em outra sessão aberta: o resultado (que revela o gabarito) volta a aparecer quando ela for encerrada ou cancelada.</p>
      </section>
    );
  }
  const r = sessao.resultado as ResultadoSessao;
  const intra = r.intra_operador;
  return (
    <section className="painel" data-testid="resultado-sessao">
      <h3>Resultado da sessão (gabarito revelado)</h3>
      <p className="nota">
        Operador {sessao.operador} ({sessao.tipo_operador}) · {sessao.repeticoes} repetições · versão {sessao.versao_software}. Diferença = medido − gabarito (mm); LoA 95 % = viés ± 1,96·DP.
      </p>
      <table className="tabela">
        <thead>
          <tr>
            <th>Conjunto</th>
            <th>n</th>
            <th>Viés</th>
            <th>DP</th>
            <th>LoA 95 %</th>
            <th>±3 mm</th>
            <th>±2 mm</th>
          </tr>
        </thead>
        <tbody>
          <LinhaBA rotulo="Geral" r={r.geral} testid="ba-geral" />
          <LinhaBA rotulo="N-IMF (à parte)" r={r.n_imf} testid="ba-n-imf" />
          <LinhaBA rotulo="Sem N-IMF" r={r.sem_n_imf} testid="ba-sem-n-imf" />
          <LinhaBA rotulo="Só euclidianas" r={r.euclidiana} testid="ba-euclidiana" />
          <LinhaBA rotulo="Só geodésicas" r={r.geodesica} testid="ba-geodesica" />
          {intra.bland_altman_rep2_rep1 && <LinhaBA rotulo="Intra-operador (rep. 2 − rep. 1)" r={intra.bland_altman_rep2_rep1} testid="ba-intra" />}
        </tbody>
      </table>
      <p data-testid="repetibilidade">
        Repetibilidade intra-operador: DP intra-sujeito {d3(intra.dp_intra_mm)} mm; coeficiente de repetibilidade (1,96·√2·s<sub>w</sub>) {d3(intra.coeficiente_repetibilidade_mm)} mm ({intra.n_grupos} grupos scan × medida).
      </p>
      <ul data-testid="criterios">
        <li>Pares: {r.criterios.n_pares} (≥ 30: {simNao(r.criterios.n_pares_min_30)})</li>
        <li>LoA geral dentro de ±3 mm (ESTRATEGIA, fase 1): {simNao(r.criterios.loa_dentro_3mm)}</li>
        <li>LoA geral dentro de ±2 mm (Marco 1): {simNao(r.criterios.loa_dentro_2mm)}</li>
        <li>
          Vale para a fase 1: <strong>{r.criterios.vale_para_fase1 ? "sim" : "não"}</strong> — {r.criterios.motivo_fase1}
        </li>
      </ul>
      <ul className="nota" data-testid="notas-resultado">
        {r.notas?.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="nota">Scans: {sessao.scans?.map((s) => `${s.scan_id} = ${s.torso}`).join(" · ")}</p>
      <p>
        Planilha art. 5º:{" "}
        <a href="/api/validacao/planilha?formato=csv" data-testid="planilha-csv">
          CSV
        </a>{" "}
        · <a href="/api/validacao/planilha?formato=csv&amp;separador=ponto-e-virgula">CSV (Excel pt-BR)</a> · <a href="/api/validacao/planilha?formato=json">JSON</a>
      </p>
    </section>
  );
}

export function SessaoBlandAltman({ sessaoInicial, demo = false }: { sessaoInicial: string | null; demo?: boolean }) {
  const [sessao, setSessao] = useState<VistaSessao | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: "info" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [operador, setOperador] = useState("");
  const [tipoOperador, setTipoOperador] = useState<"humano" | "simulado">("humano");
  const [repeticoes, setRepeticoes] = useState("2");
  const [observacoes, setObservacoes] = useState("");
  const [abertas, setAbertas] = useState<VistaSessao[]>([]);

  const [carregada, setCarregada] = useState<MalhaCarregada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [landmarks, setLandmarks] = useState<Landmarks>({});
  const [ativo, setAtivo] = useState<LandmarkId>("furcula");
  const [vista, setVista] = useState<NomeVista>("frente");

  const carga = useRef(0);
  /** Aplica a vista da sessão e abre o scan do próximo item (se houver). */
  const aplicarSessao = useCallback((s: VistaSessao) => {
    setSessao(s);
    setLandmarks({});
    setAtivo("furcula");
    setVista("frente");
    setCarregada(null);
    const prox = s.estado === "aberta" ? s.proximo_indice : null;
    const minha = ++carga.current;
    if (prox === null) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    carregarGlb(`/api/validacao/sessoes/${s.id}/itens/${prox}/malha`)
      .then((c) => {
        if (carga.current === minha) setCarregada(c);
      })
      .catch((e: Error) => {
        if (carga.current === minha) setMensagem({ tipo: "erro", texto: `Falha ao abrir o scan: ${e.message}` });
      })
      .finally(() => {
        if (carga.current === minha) setCarregando(false);
      });
  }, []);

  const listarAbertas = useCallback(() => {
    fetch("/api/validacao/sessoes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { sessoes: [] }))
      .then((j: { sessoes: VistaSessao[] }) => setAbertas(j.sessoes.filter((s) => s.estado === "aberta")))
      .catch(() => setAbertas([]));
  }, []);

  useEffect(() => {
    if (sessaoInicial) return;
    listarAbertas();
  }, [sessaoInicial, listarAbertas]);

  async function cancelarPorId(id: string) {
    const r = await postJson(`/api/validacao/sessoes/${id}/cancelar`, {});
    if (!r.ok) setMensagem({ tipo: "erro", texto: await lerErro(r) });
    listarAbertas();
  }

  async function retomar(id: string) {
    const r = await fetch(`/api/validacao/sessoes/${id}`, { cache: "no-store" });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: await lerErro(r) });
    aplicarSessao(await r.json());
    window.history.replaceState(null, "", `?sessao=${id}`);
  }

  useEffect(() => {
    if (!sessaoInicial) return;
    let vivo = true;
    fetch(`/api/validacao/sessoes/${sessaoInicial}`, { cache: "no-store" })
      .then(async (r) => {
        if (!vivo) return;
        if (r.ok) aplicarSessao(await r.json());
        else setMensagem({ tipo: "erro", texto: await lerErro(r) });
      })
      .catch(() => vivo && setMensagem({ tipo: "erro", texto: "falha de rede ao abrir a sessão" }));
    return () => {
      vivo = false;
    };
  }, [sessaoInicial, aplicarSessao]);

  const proximo = sessao?.estado === "aberta" ? sessao.proximo_indice : null;

  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setMensagem(null);
    const r = await postJson("/api/validacao/sessoes", { operador, tipo_operador: tipoOperador, repeticoes: Number(repeticoes) });
    setOcupado(false);
    if (!r.ok) {
      setMensagem({ tipo: "erro", texto: await lerErro(r) });
      return;
    }
    const s = (await r.json()) as VistaSessao;
    aplicarSessao(s);
    window.history.replaceState(null, "", `?sessao=${s.id}`);
  }

  const aoClicar = useCallback(
    (c: CliqueNaMalha) => {
      const lm: Landmark = { posicao: c.posicao.map((v) => Math.round(v * 100) / 100) as Vetor3, vertice: c.vertice, origem: "clique" };
      setLandmarks((atual) => {
        const novos = { ...atual, [ativo]: lm };
        const seguinte = LANDMARK_IDS.find((id) => !novos[id]);
        if (seguinte) setAtivo(seguinte);
        return novos;
      });
    },
    [ativo],
  );

  async function registrar() {
    if (!sessao || proximo === null) return;
    setOcupado(true);
    setMensagem(null);
    const r = await postJson(`/api/validacao/sessoes/${sessao.id}/itens/${proximo}`, { landmarks });
    setOcupado(false);
    if (!r.ok) {
      setMensagem({ tipo: "erro", texto: await lerErro(r) });
      return;
    }
    aplicarSessao(await r.json());
    setMensagem({ tipo: "info", texto: `Marcação do item ${proximo + 1} registrada.` });
  }

  async function encerrar() {
    if (!sessao) return;
    setOcupado(true);
    setMensagem(null);
    const r = await postJson(`/api/validacao/sessoes/${sessao.id}/encerrar`, observacoes.trim() ? { observacoes } : {});
    setOcupado(false);
    if (!r.ok) {
      setMensagem({ tipo: "erro", texto: await lerErro(r) });
      return;
    }
    aplicarSessao(await r.json());
  }

  async function cancelar() {
    if (!sessao) return;
    const r = await postJson(`/api/validacao/sessoes/${sessao.id}/cancelar`, {});
    if (!r.ok) {
      setMensagem({ tipo: "erro", texto: await lerErro(r) });
      return;
    }
    aplicarSessao(await r.json());
  }

  const marcadores: Marcador[] = useMemo(
    () => DEFINICOES_LANDMARKS.filter((d) => landmarks[d.id]).map((d) => ({ id: d.id, posicao: landmarks[d.id]!.posicao, cor: d.obrigatorio ? "#d1242f" : "#8250df" })),
    [landmarks],
  );
  const completos = LANDMARK_IDS.every((id) => landmarks[id]);
  const concluidos = sessao?.itens.filter((i) => i.concluido).length ?? 0;
  const itemAtual = proximo !== null ? sessao?.itens[proximo] : undefined;

  const avisos = mensagem && (
    <p className={mensagem.tipo === "erro" ? "erro mensagem" : "info mensagem"} role={mensagem.tipo === "erro" ? "alert" : "status"}>
      {mensagem.texto}
    </p>
  );

  if (!sessao) {
    return (
      <section className="painel">
        {avisos}
        {abertas.length > 0 && (
          <div data-testid="sessoes-abertas">
            <h3>Sessões abertas</h3>
            <p className="nota">Enquanto houver sessão aberta, o gabarito dos torsos dela fica bloqueado na consulta e a planilha não é exportada. Retome ou cancele.</p>
            <ul>
              {abertas.map((a) => (
                <li key={a.id} data-testid={`sessao-aberta-${a.id}`}>
                  {a.operador} · {a.itens.filter((i) => i.concluido).length}/{a.itens.length} itens · {a.criada_em.slice(0, 16).replace("T", " ")}{" "}
                  <button type="button" className="secundario" onClick={() => retomar(a.id)}>
                    Retomar
                  </button>{" "}
                  <button type="button" className="secundario" onClick={() => cancelarPorId(a.id)}>
                    Cancelar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <h3>Nova sessão</h3>
        <form onSubmit={iniciar} className="linha-form">
          <label>
            Código do operador (pseudônimo, nunca o nome)
            <input value={operador} onChange={(e) => setOperador(e.target.value)} placeholder="OP-01" required pattern={demo ? "OP-[0-9]{2}" : "[A-Za-z0-9][A-Za-z0-9-]{1,15}"} title={demo ? "na demonstração: OP-NN (ex.: OP-01)" : undefined} data-testid="operador" />
          </label>
          <label>
            Operador
            <select value={tipoOperador} onChange={(e) => setTipoOperador(e.target.value as "humano" | "simulado")} data-testid="tipo-operador">
              <option value="humano">humano</option>
              <option value="simulado">simulado (teste automatizado)</option>
            </select>
          </label>
          <label>
            Repetições de cada scan
            <input type="number" min={2} max={5} value={repeticoes} onChange={(e) => setRepeticoes(e.target.value)} data-testid="repeticoes" />
          </label>
          <button type="submit" disabled={ocupado}>
            Iniciar sessão
          </button>
        </form>
        <p className="nota">
          <strong>O código do operador não pode conter nome, CRM, e-mail ou outro dado pessoal</strong> — use um código combinado (ex.: OP-01) cuja chave fica fora do sistema. Os scans são os torsos sintéticos com gabarito, identificados só por código e em ordem aleatória. Durante a sessão nenhuma distância é mostrada — nem a medida nem a do gabarito. O
          resultado (viés, LoA 95 %, N-IMF à parte e repetibilidade) aparece ao encerrar.
        </p>
      </section>
    );
  }

  return (
    <>
      <p data-testid="sessao-id" data-sessao={sessao.id} data-estado={sessao.estado} className="nota">
        Sessão {sessao.id} · operador {sessao.operador} ({sessao.tipo_operador}) · {sessao.estado}
      </p>
      {avisos}
      {sessao.estado === "encerrada" && <Resultado sessao={sessao} />}
      {sessao.estado === "cancelada" && <p className="painel">Sessão cancelada: nenhum resultado foi calculado e o gabarito não foi revelado.</p>}
      {sessao.estado === "aberta" && (
        <div className="consulta">
          <div className="coluna-viewer">
            <div className="viewer" data-testid="viewer">
              {carregada ? (
                <Visualizador carregada={carregada} marcadores={marcadores} linhaRegua={null} clicavel vista={vista} onClique={aoClicar} />
              ) : (
                <div className="viewer-vazio">{carregando ? "Preparando o scan (o primeiro acesso a cada torso processa a malha)…" : "Sessão completa: encerre para ver o resultado."}</div>
              )}
            </div>
            <div className="ferramentas" role="toolbar" aria-label="Vista da câmera">
              {NOMES_VISTAS.map((v) => (
                <button key={v} type="button" className="secundario" aria-pressed={vista === v} disabled={!carregada} onClick={() => setVista(v)} data-testid={`vista-${v}`}>
                  {VISTAS[v].rotulo}
                </button>
              ))}
            </div>
          </div>
          <div className="coluna-passos">
            <section className="painel">
              <h3>Progresso</h3>
              <p data-testid="progresso">
                {concluidos} de {sessao.itens.length} itens concluídos
                {itemAtual ? ` · agora: scan ${itemAtual.scan_id}, repetição ${itemAtual.repeticao}` : ""}
              </p>
            </section>
            {itemAtual && (
              <section className="painel" data-testid="landmarks-guia">
                <h3>Landmarks (os 10)</h3>
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
                      </li>
                    );
                  })}
                </ol>
                <p className="nota">{DEFINICOES_LANDMARKS.find((d) => d.id === ativo)?.instrucao}</p>
                <div className="linha-form">
                  <button type="button" className="secundario" onClick={() => setLandmarks({})}>
                    Limpar landmarks
                  </button>
                  <button type="button" onClick={registrar} disabled={!completos || ocupado || !carregada} data-testid="registrar-item">
                    Registrar marcação
                  </button>
                </div>
                <p className="nota">A marcação registrada não pode ser refeita; nenhuma distância é mostrada durante a sessão.</p>
              </section>
            )}
            {proximo === null && (
              <section className="painel">
                <h3>Encerrar</h3>
                {!demo && (
                  <label className="linha-form">
                    Observações (opcional; sem nome, CRM, e-mail ou qualquer dado de paciente ou do operador)
                    <input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={500} data-testid="observacoes" />
                  </label>
                )}
                <button type="button" onClick={encerrar} disabled={ocupado} data-testid="encerrar-sessao">
                  Encerrar sessão e revelar o gabarito
                </button>
              </section>
            )}
            <button type="button" className="secundario" onClick={cancelar} data-testid="cancelar-sessao">
              Cancelar sessão
            </button>
          </div>
        </div>
      )}
    </>
  );
}
