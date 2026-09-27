import { afterEach, describe, expect, it } from "vitest";
import { CAMINHO, REMOVIDO, higienizar, higienizarTexto } from "@/log/higienizar";
import { configurarSaidaLog, log, type LinhaLog } from "@/log/logger";

let restaurar: (() => void) | null = null;
afterEach(() => restaurar?.());

function capturar(): LinhaLog[] {
  const linhas: LinhaLog[] = [];
  restaurar = configurarSaidaLog((l) => linhas.push(l));
  return linhas;
}

describe("logger sem dado pessoal (LGPD)", () => {
  it("remove valores de chaves sensíveis", () => {
    const linhas = capturar();
    log.info("paciente_criado", {
      nome: "Maria da Silva",
      cpf: "123.456.789-09",
      email: "maria@exemplo.com",
      dataNascimento: "01/02/1990",
      telefone: "(65) 99999-8888",
      Endereço: "Rua X, 10",
      anamnese: { queixa_principal: "assimetria" },
      pseudonimo: "P-7K2M9Q",
      malha_id: "c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0",
    });
    const l = linhas[0]!;
    expect(l.evento).toBe("paciente_criado");
    for (const k of ["nome", "cpf", "email", "dataNascimento", "telefone", "Endereço", "anamnese"]) expect(l[k]).toBe(REMOVIDO);
    expect(l.pseudonimo).toBe("P-7K2M9Q");
    expect(l.malha_id).toBe("c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0");
    const texto = JSON.stringify(l);
    for (const proibido of ["Maria", "123.456.789-09", "maria@exemplo.com", "1990", "99999", "Rua X"]) expect(texto).not.toContain(proibido);
  });

  it("remove padrões em texto livre, inclusive aninhado", () => {
    const linhas = capturar();
    log.error("falha", {
      mensagem: "paciente 12345678909 ligou de +55 65 98888-7777, escreveu para a@b.co em 03/04/2025",
      contexto: { lista: ["arquivo /home/claude/data/pacientes/P-ABC123/x.obj", "C:\\Users\\medico\\scan.obj"] },
    });
    const txt = JSON.stringify(linhas[0]);
    expect(txt).not.toMatch(/12345678909|98888|a@b\.co|03\/04\/2025|\/home\/claude|Users\\\\medico/);
    expect(txt).toContain(REMOVIDO);
    expect(txt).toContain(CAMINHO);
  });

  it("preserva UUIDs, pseudônimos, números e caminhos relativos a DATA_DIR", () => {
    const entrada = {
      malha_dir: "pacientes/P-7K2M9Q/malhas/c9f0f895-fb98-4b91-a8c3-ffb1e6d2a9b0",
      id: "12345678-1234-4234-8234-123456789012",
      n_vertices: 40011,
      url: "http://127.0.0.1:8765/processar",
    };
    expect(higienizar(entrada)).toEqual(entrada);
  });

  it("erros viram {nome, mensagem} higienizados, sem stack", () => {
    const e = new Error("falhou para joao@x.com em /var/lib/dados");
    const h = higienizar({ erro: e }) as { erro: { nome: string; mensagem: string } };
    expect(h.erro.nome).toBe("Error");
    expect(h.erro.mensagem).not.toContain("joao@x.com");
    expect(h.erro.mensagem).not.toContain("/var/lib");
    expect(JSON.stringify(h)).not.toContain("at ");
  });

  it("URL de banco com senha é removida", () => {
    expect(higienizarTexto("conectando em postgres://simulador:segredo@127.0.0.1:5432/simulador")).not.toContain("segredo");
  });
});
