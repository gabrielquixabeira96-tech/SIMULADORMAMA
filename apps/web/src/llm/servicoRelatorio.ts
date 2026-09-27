import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Desenho, Medidas, MedidasDigitadas } from "@simulador/contratos";
import type pg from "pg";
import { buscarImplante } from "@/catalogo/catalogo";
import { demoAtiva } from "@/config/demo";
import { isoComFuso, raizRepo, usuarioAtual, versaoSoftware } from "@/config/ambiente";
import { AVISO_FIXO } from "@/config/aviso";
import { carregarConfigSimulacaoUI, carregarTepidConfig } from "@/config/arquivosConfig";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { listarSimulacoes, malhaPorId, medidasPorId, pacientePorId } from "@/db/repositorio";
import { log } from "@/log/logger";
import { montarDadosTravados, type ImplanteMostrado } from "./numeros";
import type { ProvedorLLM } from "./provedor";
import { gerarRelatorio, type RelatorioFinal, type SimulacaoMostrada } from "./relatorio";
import { atendimentoPorId, criarAtendimento, implantesDoCache, inserirRelatorio, ultimaMedidaDaMalha, ultimaTepidDigitada, type AtendimentoLinha } from "./repositorio";

/** Erro de pedido com status HTTP (a rota converte). */
export class PedidoInvalidoError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "PedidoInvalidoError";
  }
}

/**
 * Atendimento existente (conferindo paciente e desenho) ou novo. Um atendimento gravado em um
 * desenho não é continuado no outro (a coluna `desenho` é o registro regulatório).
 */
export async function obterOuCriarAtendimento(
  pacienteId: string,
  atendimentoId: string | null | undefined,
  desenho: Desenho,
  cliente?: pg.ClientBase,
): Promise<{ atendimento: AtendimentoLinha; criado: boolean }> {
  if (atendimentoId) {
    const a = await atendimentoPorId(atendimentoId, cliente);
    if (!a) throw new PedidoInvalidoError(404, "atendimento_nao_encontrado", "atendimento não encontrado");
    if (a.paciente_id !== pacienteId) throw new PedidoInvalidoError(422, "atendimento_de_outro_paciente", "atendimento não pertence ao paciente");
    if (a.desenho !== desenho) throw new PedidoInvalidoError(409, "desenho_divergente", "atendimento registrado em outro desenho");
    return { atendimento: a, criado: false };
  }
  // criação + auditoria na MESMA transação (a do chamador, se houver)
  const criar = async (c: pg.ClientBase): Promise<AtendimentoLinha> => {
    const id = await criarAtendimento({ pacienteId, desenho, versaoSoftware: versaoSoftware() }, c);
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "criou", entidade: "atendimentos", entidadeId: id, desenho, detalhes: { paciente_id: pacienteId } }, c);
    return (await atendimentoPorId(id, c))!;
  };
  return { atendimento: cliente ? await criar(cliente) : await transacao(criar), criado: true };
}

function simulacaoNaoCalibrada(): boolean {
  const dir = process.env.CONFIG_DIR ? resolve(/*turbopackIgnore: true*/ process.env.CONFIG_DIR) : resolve(/*turbopackIgnore: true*/ raizRepo(), "config");
  try {
    const c = JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ dir, "simulacao.json"), "utf8")) as { nao_calibrado?: unknown };
    return c.nao_calibrado !== false;
  } catch {
    return true;
  }
}

function rotuloImplante(p: Record<string, unknown> | null, id: string): string {
  if (!p) return id;
  const ref = typeof p.referencia_fabricante === "string" && p.referencia_fabricante ? ` (${p.referencia_fabricante})` : "";
  return `${String(p.fabricante)} ${String(p.modelo)}${ref}`.slice(0, 200);
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface PedidoRelatorio {
  pacienteId: string;
  malhaId?: string | null;
  medidaId?: string | null;
  atendimentoId?: string | null;
}

/** Monta dados do BANCO (contratos §14.3), gera, verifica, grava e audita o relatório. */
export async function gerarRelatorioDoPedido(p: PedidoRelatorio, desenho: Desenho, provedor: ProvedorLLM): Promise<RelatorioFinal> {
  const paciente = await pacientePorId(p.pacienteId);
  if (!paciente) throw new PedidoInvalidoError(404, "paciente_nao_encontrado", "paciente não encontrado");

  const malha = p.malhaId ? await malhaPorId(p.malhaId) : null;
  if (p.malhaId && !malha) throw new PedidoInvalidoError(404, "malha_nao_encontrada", "malha não encontrada");
  if (malha && malha.paciente_id !== paciente.id) throw new PedidoInvalidoError(422, "malha_de_outro_paciente", "malha não pertence ao paciente");

  let medida: { id: string; payload: Medidas } | null = null;
  if (p.medidaId) {
    const m = await medidasPorId(p.medidaId);
    if (!m) throw new PedidoInvalidoError(404, "medida_nao_encontrada", "medida não encontrada");
    const dona = await malhaPorId(m.malha_id);
    if (!dona || dona.paciente_id !== paciente.id || (malha && dona.id !== malha.id)) throw new PedidoInvalidoError(422, "medida_de_outra_malha", "medida não pertence à malha/paciente");
    medida = { id: m.id, payload: m.payload };
  } else if (malha) {
    medida = await ultimaMedidaDaMalha(malha.id);
  }

  const digitadas: MedidasDigitadas | null = medida?.payload.medidas_digitadas ?? (await ultimaTepidDigitada(paciente.id));

  const linhasSim = malha ? await listarSimulacoes(malha.id) : [];
  const cache = await implantesDoCache([...new Set(linhasSim.map((s) => s.implante_id))]);
  const specs = (id: string): Record<string, unknown> | null => cache.get(id) ?? (buscarImplante(id) as unknown as Record<string, unknown> | null);

  const simulacoes: SimulacaoMostrada[] = linhasSim.map((s) => ({
    id: s.id,
    implante_id: s.implante_id,
    rotulo: rotuloImplante(specs(s.implante_id), s.implante_id),
    plano: s.plano,
    imf: s.imf,
    lado: s.lado,
    versao_config_simulacao: s.versao_config_simulacao,
    nao_calibrado: s.nao_calibrado,
    mostrada_em: isoComFuso(new Date(s.mostrada_em)),
  }));
  const vistos = new Set<string>();
  const implantes: ImplanteMostrado[] = [];
  for (const s of linhasSim) {
    const chave = `${s.implante_id}|${s.plano}|${s.imf}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const sp = specs(s.implante_id);
    implantes.push({
      id: s.implante_id,
      rotulo: rotuloImplante(sp, s.implante_id),
      plano: s.plano,
      imf: s.imf,
      ...(num(sp?.base_mm) !== undefined ? { base_mm: num(sp?.base_mm) } : {}),
      ...(num(sp?.projecao_mm) !== undefined ? { projecao_mm: num(sp?.projecao_mm) } : {}),
      ...(num(sp?.volume_ml) !== undefined ? { volume_ml: num(sp?.volume_ml) } : {}),
    });
  }

  const dados = montarDadosTravados({ implantes, medidasDigitadas: digitadas, distancias: medida?.payload.distancias ?? null, volumes: medida?.payload.volumes ?? null }, desenho);
  const { atendimento } = await obterOuCriarAtendimento(paciente.id, p.atendimentoId, desenho);
  const sim = carregarConfigSimulacaoUI();
  const tepid = carregarTepidConfig();

  const gerado = await gerarRelatorio(
    {
      relatorioId: randomUUID(),
      atendimentoId: atendimento.id,
      pseudonimo: paciente.pseudonimo,
      desenho,
      versaoSoftware: versaoSoftware(),
      geradoEm: isoComFuso(),
      parametros: {
        versao_config: { simulacao: sim.versao, tepid: tepid.versao },
        envelope_rms_mm: sim.envelope_rms_mm,
        nao_calibrado: simulacaoNaoCalibrada() || simulacoes.some((s) => s.nao_calibrado),
        aviso: AVISO_FIXO,
      },
      dados,
      simulacoes,
    },
    provedor,
  );
  // modo demonstração sintética (ADR 0018): marcado no payload (resposta, banco e PDF)
  const relatorio: RelatorioFinal = demoAtiva() ? { ...gerado, demo: true } : gerado;

  await transacao(async (c) => {
    await inserirRelatorio(relatorio, c);
    await registrarAuditoria(
      {
        usuarioId: usuarioAtual(),
        acao: "criou",
        entidade: "relatorios",
        entidadeId: relatorio.relatorio_id,
        desenho,
        detalhes: { atendimento_id: atendimento.id, prosa_origem: relatorio.prosa_origem, numeros_ok: relatorio.verificacao.ok, n_simulacoes: simulacoes.length, llm_modo: relatorio.llm.modo },
      },
      c,
    );
    if (relatorio.prosa_rejeitada) {
      // ADR 0006 item 6: prosa recusada vai à auditoria (sem o texto; só o motivo e os números intrusos).
      await registrarAuditoria(
        {
          usuarioId: usuarioAtual(),
          acao: "alterou",
          entidade: "relatorios",
          entidadeId: relatorio.relatorio_id,
          desenho,
          detalhes: { evento: "prosa_llm_rejeitada", motivo: relatorio.prosa_rejeitada.motivo, intrusos: relatorio.prosa_rejeitada.intrusos.slice(0, 20) },
        },
        c,
      );
    }
  });
  log.info("relatorio_gerado", {
    relatorio_id: relatorio.relatorio_id,
    atendimento_id: atendimento.id,
    pseudonimo: paciente.pseudonimo,
    prosa_origem: relatorio.prosa_origem,
    llm_modo: relatorio.llm.modo,
    modelo: relatorio.llm.modelo,
  });
  return relatorio;
}
