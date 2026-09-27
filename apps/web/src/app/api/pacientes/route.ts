import { json, tratarErro } from "@/api/respostas";
import { usuarioAtual } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { criarPaciente, listarPacientes } from "@/db/repositorio";

export const dynamic = "force-dynamic";

/**
 * POST /api/pacientes — cria paciente PSEUDONIMIZADO. Não aceita nome, CPF, contato ou
 * nascimento: o corpo é ignorado; o vínculo com a identidade fica no prontuário (ADR 0002).
 */
export async function POST() {
  try {
    const desenho = getDesenho();
    // escrita + auditoria na MESMA transação: sem auditoria, sem paciente
    const p = await transacao(async (c) => {
      const novo = await criarPaciente(c);
      await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "criou", entidade: "pacientes", entidadeId: novo.id, desenho }, c);
      return novo;
    });
    return json({ id: p.id, pseudonimo: p.pseudonimo, criado_em: p.criado_em }, 201);
  } catch (e) {
    return tratarErro(e, "pacientes.criar");
  }
}

export async function GET() {
  try {
    const desenho = getDesenho();
    const lista = await listarPacientes();
    await registrarAuditoria({ usuarioId: usuarioAtual(), acao: "visualizou", entidade: "pacientes", entidadeId: "lista", desenho, detalhes: { n: lista.length } });
    return json({ pacientes: lista.map((p) => ({ id: p.id, pseudonimo: p.pseudonimo, criado_em: p.criado_em })) });
  } catch (e) {
    return tratarErro(e, "pacientes.listar");
  }
}
