import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { landmarksSchema, uuidSchema, type MedirResposta } from "@simulador/contratos";
import { z } from "zod";
import { desligadoNoDesenhoA, erro, json, lerJson, tratarErro } from "@/api/respostas";
import { caminhoEmDataDir, isoComFuso, usuarioAtual, versaoSoftware } from "@/config/ambiente";
import { carregarConfigSimulacaoUI, carregarTepidConfig } from "@/config/arquivosConfig";
import { getDesenho } from "@/config/desenho";
import { recursoAtivoEm } from "@/config/recursos";
import { registrarAuditoria } from "@/db/auditoria";
import { transacao } from "@/db/pool";
import { inserirMedidas, malhaPorId } from "@/db/repositorio";
import { distanciasEuclidianas } from "@/medidas/geometria";
import { escalaDaMeta, montarRegistroMedidas } from "@/medidas/registro";
import { ClienteMesh } from "@/mesh/cliente";
import { validarValoresTepid } from "@/tepid/avaliar";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  malha_id: uuidSchema,
  landmarks: landmarksSchema,
  medidas_digitadas: z.unknown().optional(),
  // Aceitos só para recusar explicitamente em A (o servidor nunca confia nesses valores).
  distancias: z.unknown().optional(),
  volumes: z.unknown().optional(),
});

/**
 * POST /api/medidas — grava um registro medidas/1.0 (contratos §6). O servidor recalcula tudo:
 * em B chama /medir (geodésicas + volume); em A não calcula nada e recusa (403) qualquer
 * distância/volume enviado pelo cliente. Sem services/mesh em B → 503 e nada é gravado.
 */
export async function POST(req: Request) {
  try {
    const desenho = getDesenho();
    const corpo = corpoSchema.parse(await lerJson(req));
    if (!recursoAtivoEm(desenho, "medicao_automatica_3d") && corpo.distancias != null) return desligadoNoDesenhoA("medicao_automatica_3d");
    if (!recursoAtivoEm(desenho, "volume_calculado") && corpo.volumes != null) return desligadoNoDesenhoA("volume_calculado");

    const tepid = carregarTepidConfig();
    let medidasDigitadas = null;
    if (corpo.medidas_digitadas != null) {
      const v = validarValoresTepid(corpo.medidas_digitadas, tepid);
      if (!v.ok) return erro(400, "medidas_digitadas_invalidas", "medidas digitadas fora das faixas de config/tepid.json", { erros: v.erros });
      medidasDigitadas = v.valores;
    }
    if (desenho === "A" && !medidasDigitadas) {
      return erro(400, "medidas_digitadas_obrigatorias", "no desenho A as medidas são digitadas (TEPID)");
    }

    const m = await malhaPorId(corpo.malha_id);
    if (!m) return erro(404, "malha_nao_encontrada", "malha não encontrada");

    let medicao: MedirResposta | null = null;
    if (recursoAtivoEm(desenho, "medicao_automatica_3d")) {
      const euclidianas = Object.fromEntries(Object.entries(distanciasEuclidianas(corpo.landmarks)).filter(([, v]) => v !== null)) as Record<string, number>;
      if (Object.keys(euclidianas).length > 0) {
        medicao = await new ClienteMesh({ desenho }).medir(m.malha_dir, corpo.landmarks, euclidianas);
      }
    }

    const medidaId = randomUUID();
    const registro = montarRegistroMedidas({
      medidaId,
      malhaId: m.id,
      pseudonimo: m.pseudonimo,
      desenho,
      versaoSoftware: versaoSoftware(),
      versaoConfig: { tepid: tepid.versao, simulacao: carregarConfigSimulacaoUI().versao },
      quadro: m.meta.quadro,
      geradoEm: isoComFuso(),
      usuarioId: usuarioAtual(),
      escala: escalaDaMeta(m.meta, m.sintetica),
      landmarks: corpo.landmarks,
      medidasDigitadas,
      medicao,
    });

    const rel = `pacientes/${m.pseudonimo}/medidas/${medidaId}.json`;
    const abs = caminhoEmDataDir(rel);
    await transacao(async (c) => {
      await inserirMedidas(registro, usuarioAtual(), c);
      await registrarAuditoria(
        {
          usuarioId: usuarioAtual(),
          acao: "criou",
          entidade: "medidas",
          entidadeId: medidaId,
          desenho,
          detalhes: { malha_id: m.id, n_landmarks: Object.keys(corpo.landmarks).length, com_distancias: registro.distancias !== null, com_volumes: registro.volumes !== null },
        },
        c,
      );
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, JSON.stringify(registro, null, 2), { flag: "wx" });
    });
    return json(registro, 201);
  } catch (e) {
    return tratarErro(e, "medidas.gravar");
  }
}
