import { bloquearSeDesligado, json, lerJson } from "@/api/respostas";
import { getDesenho } from "@/config/desenho";
import { auditarSessao, erroValidacao, RECURSO_VALIDACAO } from "@/validacao/http";
import { criarSessao, listarSessoes, vistaPublica } from "@/validacao/sessao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/validacao/sessoes — abre uma sessão de Bland-Altman cega ao gabarito (ADR 0017).
 * Corpo: { operador: "<código pseudônimo>", tipo_operador?: "humano"|"simulado", repeticoes?: 2..5,
 * torsos?: [...], semente?: n }. Resposta: a vista pública (códigos de scan, sem torso nem gabarito).
 * DESENHO=A → 403 (a sessão mede distâncias: mesma regra de `medicao_automatica_3d`).
 */
export async function POST(req: Request) {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    const s = await criarSessao(await lerJson(req), getDesenho());
    await auditarSessao("criou", s.id, { operador: s.operador, tipo_operador: s.tipo_operador, repeticoes: s.repeticoes, n_scans: s.scans.length, n_itens: s.itens.length, semente: s.semente });
    return json(vistaPublica(s), 201);
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.criar");
  }
}

/** GET /api/validacao/sessoes — lista (vista pública de cada sessão). */
export async function GET() {
  const bloqueio = bloquearSeDesligado(RECURSO_VALIDACAO);
  if (bloqueio) return bloqueio;
  try {
    return json({ sessoes: (await listarSessoes()).map(vistaPublica) });
  } catch (e) {
    return erroValidacao(e, "validacao.sessoes.listar");
  }
}
