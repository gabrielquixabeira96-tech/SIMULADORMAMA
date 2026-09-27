/**
 * Revisão PT6 (R1): a leitura do diretório de sessões falha FECHADO. Só "diretório ausente"
 * (ENOENT) significa "nenhuma sessão"; qualquer outro erro de `readdir` (não é diretório,
 * permissão, E/S) bloqueia todos os gabaritos, como um arquivo de sessão inválido (ADR 0017).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { caminhoEmDataDir } from "@/config/ambiente";
import { algumBloqueio, bloqueioGabarito, gabaritoBloqueado, listarSessoes } from "@/validacao/sessao";

const dir = () => caminhoEmDataDir("validacao/sessoes");
afterEach(() => rmSync(caminhoEmDataDir("validacao"), { recursive: true, force: true }));

describe("lerTodas: readdir falha fechado", () => {
  it("diretório ausente (ENOENT) → nenhuma sessão, nada bloqueado", async () => {
    const b = await bloqueioGabarito();
    expect(b.todos).toBe(false);
    expect(algumBloqueio(b)).toBe(false);
    expect(await listarSessoes()).toEqual([]);
  });

  it("caminho de sessões que não é diretório (ENOTDIR) → todos os gabaritos bloqueados", async () => {
    mkdirSync(caminhoEmDataDir("validacao"), { recursive: true });
    writeFileSync(dir(), "não sou um diretório");
    const b = await bloqueioGabarito();
    expect(b.todos).toBe(true);
    expect(gabaritoBloqueado(b, "t01_simetrico_300")).toBe(true);
    expect(b.invalidos).toHaveLength(1);
    expect(b.invalidos[0]).toMatch(/ENOTDIR/);
    // sem caminho absoluto na mensagem
    expect(b.invalidos[0]).not.toContain(caminhoEmDataDir("validacao"));
  });

  it("diretório vazio → nada bloqueado", async () => {
    mkdirSync(dir(), { recursive: true });
    expect((await bloqueioGabarito()).todos).toBe(false);
  });
});
