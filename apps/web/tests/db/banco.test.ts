/**
 * Banco de teste real (simulador_test; ADR 0007). Pulado se o Postgres não estiver no ar.
 */
import { afterAll, describe, expect, it } from "vitest";
import { listarAuditoria, registrarAuditoria } from "@/db/auditoria";
import { consultar, fecharPools } from "@/db/pool";
import { criarPaciente } from "@/db/repositorio";
import { dbDisponivel } from "../helpers/banco";

afterAll(fecharPools);

describe.skipIf(!dbDisponivel())("migrations e DDL (contratos §17)", () => {
  it("todas as tabelas do contrato existem", async () => {
    const r = await consultar<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
    const tabelas = r.rows.map((x) => x.table_name);
    for (const t of ["pacientes", "malhas", "medidas", "tepid", "implantes", "simulacoes", "atendimentos", "auditoria", "schema_migrations"]) expect(tabelas).toContain(t);
  });

  it("migrations registradas com hash", async () => {
    const r = await consultar<{ nome: string; sha256: string }>("select arquivo as nome, sha256 from schema_migrations order by arquivo");
    expect(r.rows.map((x) => x.nome)).toEqual(["0001_inicial.sql", "0002_auditoria_append_only.sql"]);
    for (const x of r.rows) expect(x.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("nenhuma coluna de identificação pessoal em nenhuma tabela", async () => {
    const r = await consultar<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public'");
    const proibidas = /^(nome|name|cpf|rg|email|telefone|celular|nascimento|data_nascimento|endereco|cns)$/;
    expect(r.rows.map((x) => x.column_name).filter((c) => proibidas.test(c))).toEqual([]);
  });

  it("pacientes só aceita pseudônimo no formato P-XXXXXX (sem I/O)", async () => {
    const p = await criarPaciente();
    expect(p.pseudonimo).toMatch(/^P-[0-9A-HJ-NP-Z]{6}$/);
    await expect(consultar("insert into pacientes (pseudonimo) values ('Maria Silva')")).rejects.toThrow(/check/);
    await expect(consultar("insert into pacientes (pseudonimo) values ('P-ABCDEI')")).rejects.toThrow(/check/);
  });

  it("colunas desenho só aceitam A|B", async () => {
    await expect(consultar("insert into auditoria (usuario_id, acao, entidade, entidade_id, desenho) values ('t','criou','x','1','C')")).rejects.toThrow(/check/);
  });
});

describe.skipIf(!dbDisponivel())("auditoria (quem viu o quê, quando)", () => {
  it("grava usuário, ação, entidade, desenho e data", async () => {
    const id = crypto.randomUUID();
    await registrarAuditoria({ usuarioId: "teste", acao: "visualizou", entidade: "malhas", entidadeId: id, desenho: "B", detalhes: { nome: "processada.glb" } });
    const linhas = await listarAuditoria("malhas", id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ usuario_id: "teste", acao: "visualizou", entidade: "malhas", entidade_id: id, desenho: "B" });
    expect(linhas[0]!.ocorrido_em).toBeInstanceOf(Date);
  });

  it("é append-only: UPDATE, DELETE e TRUNCATE são bloqueados", async () => {
    const id = crypto.randomUUID();
    await registrarAuditoria({ usuarioId: "teste", acao: "criou", entidade: "medidas", entidadeId: id, desenho: "A" });
    await expect(consultar("update auditoria set usuario_id = 'outro' where entidade_id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(consultar("delete from auditoria where entidade_id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(consultar("truncate auditoria")).rejects.toThrow(/append-only/);
    expect(await listarAuditoria("medidas", id)).toHaveLength(1);
  });

  it("detalhes são higienizados: sem dado pessoal e sem caminho absoluto", async () => {
    const id = crypto.randomUUID();
    await registrarAuditoria({
      usuarioId: "teste",
      acao: "visualizou",
      entidade: "arquivo",
      entidadeId: id,
      desenho: "B",
      detalhes: { nome_completo: "Fulana de Tal", cpf: "111.222.333-44", obs: "arquivo em /home/claude/data/x.glb, contato fulana@x.com" },
    });
    const [linha] = await listarAuditoria("arquivo", id);
    const txt = JSON.stringify(linha!.detalhes);
    expect(txt).not.toMatch(/Fulana|111\.222|\/home\/claude|fulana@x\.com/);
  });

  it("recusa ação fora da lista e evento incompleto", async () => {
    await expect(registrarAuditoria({ usuarioId: "t", acao: "leu" as never, entidade: "x", entidadeId: "1", desenho: "B" })).rejects.toThrow(/ação/);
    await expect(registrarAuditoria({ usuarioId: "", acao: "criou", entidade: "x", entidadeId: "1", desenho: "B" })).rejects.toThrow(/incompleto/);
  });
});
