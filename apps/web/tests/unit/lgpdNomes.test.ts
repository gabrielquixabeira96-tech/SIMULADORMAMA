/**
 * Revisão v0.1.1, item 3 (LGPD): nome de pessoa no texto livre é RECUSADO (422) antes do LLM, a
 * guarda do payload também recusa, e o CPF com espaços/pontos é removido por inteiro.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postAnamnese } from "@/app/api/llm/anamnese/route";
import { carregarCatalogo } from "@/catalogo/catalogo";
import { estruturarAnamnese, NomeProprioError } from "@/llm/anamnese";
import { higienizarTextoLLM } from "@/llm/higienizar";
import { ProvedorMock } from "@/llm/mock";
import { detectarNomes } from "@/llm/nomes";
import { assegurarPayloadSeguro, PayloadProibidoError } from "@/llm/payload";
import { higienizarTexto } from "@/log/higienizar";

afterEach(() => vi.unstubAllEnvs());

const COM_NOME = [
  "Maria Souza, 32 anos, deseja aumento moderado.",
  "Sra. Ana Lima relata duas gestações e amamentou.",
  "Dona Joana nega tabagismo e alergias.",
  "Encaminhada pela colega Carla Mendes Rocha, deseja prótese.",
  "Deseja prótese; acompanhada do marido, Seu Antônio.",
  "Paciente relata que a Dra. Beatriz indicou a consulta.",
];

const SEM_NOME = [
  "Paciente de 32 anos, G2P2, nega tabagismo. Deseja implante de 300 mL em plano dual plane.",
  "Deseja aumento moderado, nunca fumou, duas gestações, amamentou. CPF 123.456.789-09, tel (65) 99999-8888.",
  "Queixa de assimetria. Prefere resultado natural. Nega cirurgias prévias. Uso de anticoncepcional oral.",
  "Considera Motiva Ergonomix ou Polytech Sublime Line em setembro.",
];

describe("detecção de nome de pessoa (heurística)", () => {
  for (const t of COM_NOME) it(`detecta: ${t}`, () => expect(detectarNomes(higienizarTextoLLM(t)).length).toBeGreaterThan(0));
  for (const t of SEM_NOME) it(`não acusa: ${t}`, () => expect(detectarNomes(higienizarTextoLLM(t))).toEqual([]));

  it("nenhum rótulo do catálogo dispara os sinais fortes (entram no payload do relatório)", () => {
    for (const i of carregarCatalogo()) {
      const rotulo = `${i.fabricante} ${i.modelo} ${i.referencia_fabricante ?? ""}`;
      expect(detectarNomes(rotulo).filter((n) => n.sinal !== "palavras_capitalizadas"), rotulo).toEqual([]);
    }
  });
});

describe("recusa do envio", () => {
  it("estruturarAnamnese lança NomeProprioError e o provedor nunca é chamado", async () => {
    const p = new ProvedorMock();
    const espiao = vi.spyOn(p, "registrarAnamnese");
    for (const t of COM_NOME.slice(0, 3)) await expect(estruturarAnamnese(t, p)).rejects.toBeInstanceOf(NomeProprioError);
    expect(espiao).not.toHaveBeenCalled();
  });

  it("POST /api/llm/anamnese → 422 nome_proprio_detectado, com mensagem pedindo para remover o nome (sem ecoar o nome)", async () => {
    for (const texto of COM_NOME.slice(0, 3)) {
      const r = await postAnamnese(
        new Request("http://x/api/llm/anamnese", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paciente_id: "c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0", texto }) }),
      );
      expect(r.status).toBe(422);
      const j = await r.json();
      expect(j.erro.codigo).toBe("nome_proprio_detectado");
      expect(j.erro.mensagem).toMatch(/Remova o nome/);
      expect(JSON.stringify(j)).not.toMatch(/Maria|Souza|Ana|Lima|Joana/);
    }
  });

  it("guarda do payload (última barreira antes do provedor real) recusa os mesmos textos", () => {
    for (const text of COM_NOME.slice(0, 3)) {
      expect(() => assegurarPayloadSeguro({ messages: [{ role: "user", content: [{ type: "text", text }] }] }), text).toThrow(PayloadProibidoError);
    }
  });
});

describe("CPF com espaço e ponto", () => {
  for (const cpf of ["123 456 789 09", "123.456.789.09", "123.456.789 09", "123 456 789-09"]) {
    it(`remove "${cpf}" inteiro (LLM e log)`, () => {
      for (const h of [higienizarTextoLLM(`cpf: ${cpf}; deseja prótese`), higienizarTexto(`cpf: ${cpf}; deseja prótese`)]) {
        expect(h).toContain("[removido]");
        expect(h).not.toMatch(/\d/);
      }
      expect(() => assegurarPayloadSeguro({ messages: [{ role: "user", content: [{ type: "text", text: `cpf ${cpf}` }] }] })).toThrow(PayloadProibidoError);
    });
  }
});
