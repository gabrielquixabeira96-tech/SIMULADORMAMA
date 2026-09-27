import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { CaminhoInvalidoError, caminhoEmDataDir } from "@/config/ambiente";
import { ALFABETO_PSEUDONIMO, gerarPseudonimo } from "@/db/pseudonimo";
import { tipoDoArquivo } from "@/malhas/arquivos";
import { ErroUpload, nomeSeguro, prepararUpload } from "@/malhas/upload";

const txt = (s: string) => strToU8(s);

describe("upload de malhas (ADR 0003)", () => {
  it("OBJ + MTL + PNG", () => {
    const r = prepararUpload([
      { nome: "scan.obj", dados: txt("v 0 0 0") },
      { nome: "scan.mtl", dados: txt("newmtl a") },
      { nome: "textura.png", dados: new Uint8Array([137, 80]) },
    ]);
    expect(r.principal).toBe("scan.obj");
    expect(r.formato).toBe("obj");
    expect(r.arquivos).toHaveLength(3);
  });

  it("PLY sozinho", () => {
    expect(prepararUpload([{ nome: "x.PLY", dados: txt("ply") }]).formato).toBe("ply");
  });

  it("a malha é renomeada para scan.<ext> (nome de exportação pode conter nome da paciente)", () => {
    const r = prepararUpload([{ nome: "Fulana de Tal 2026.obj", dados: txt("v 0 0 0") }]);
    expect(r.principal).toBe("scan.obj");
    expect(r.arquivos.map((a) => a.nome)).toEqual(["scan.obj"]);
  });

  it("ZIP é extraído e achatado; lixo do macOS é ignorado", () => {
    const zip = zipSync({ "pasta/scan.obj": txt("v 0 0 0"), "pasta/scan.mtl": txt("m"), "__MACOSX/._scan.obj": txt("x"), "leia.txt": txt("x") });
    const r = prepararUpload([{ nome: "export.zip", dados: zip }]);
    expect(r.arquivos.map((a) => a.nome)).toEqual(["scan.mtl", "scan.obj"]);
  });

  it("recusa formato não aceito (415), sem malha, duas malhas e limite de tamanho", () => {
    const erroDe = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e as ErroUpload;
      }
      throw new Error("não lançou");
    };
    expect(erroDe(() => prepararUpload([{ nome: "a.stl", dados: txt("x") }])).status).toBe(415);
    expect(erroDe(() => prepararUpload([{ nome: "a.png", dados: txt("x") }])).codigo).toBe("sem_malha");
    expect(erroDe(() => prepararUpload([{ nome: "a.obj", dados: txt("x") }, { nome: "b.ply", dados: txt("x") }])).codigo).toBe("malhas_multiplas");
    expect(erroDe(() => prepararUpload([{ nome: "a.obj", dados: new Uint8Array(2048) }], 1024)).status).toBe(413);
    const bomba = zipSync({ "a.obj": new Uint8Array(4096) });
    expect(erroDe(() => prepararUpload([{ nome: "z.zip", dados: bomba }], 2048)).status).toBe(413);
  });

  it("nomes são reduzidos ao basename e higienizados", () => {
    expect(nomeSeguro("../../etc/passwd.obj")).toBe("passwd.obj");
    expect(nomeSeguro("C:\\scans\\Maria Silva.obj")).toBe("Maria_Silva.obj");
    expect(() => nomeSeguro("..")).toThrow(ErroUpload);
  });
});

describe("caminhos relativos a DATA_DIR (contratos §5.4)", () => {
  const base = "/tmp/dados-teste";
  it("aceita relativo e resolve dentro da base", () => {
    expect(caminhoEmDataDir("pacientes/P-7K2M9Q/malhas/x/processada.glb", base)).toBe(`${base}/pacientes/P-7K2M9Q/malhas/x/processada.glb`);
  });
  it.each(["/etc/passwd", "../fora", "pacientes/../../fora", "C:\\x", ""])("recusa %s", (p) => {
    expect(() => caminhoEmDataDir(p, base)).toThrow(CaminhoInvalidoError);
  });
});

describe("lista fixa de arquivos servidos", () => {
  it.each([
    ["processada.glb", "model/gltf-binary"],
    ["morphs/manifest.json", "application/json"],
    ["morphs/dual_plane__rebaixar.glb", "model/gltf-binary"],
    ["processada.obj", null],
    ["original/scan.obj", null],
    ["../meta.json", null],
    ["morphs/outro__manter.glb", null],
    ["toString", null],
  ])("%s → %s", (nome, tipo) => {
    expect(tipoDoArquivo(nome)).toBe(tipo);
  });
});

describe("pseudônimo (contratos §1.2)", () => {
  it("formato P-XXXXXX sem I nem O", () => {
    expect(ALFABETO_PSEUDONIMO).not.toMatch(/[IO]/);
    for (let i = 0; i < 500; i++) expect(gerarPseudonimo()).toMatch(/^P-[0-9A-HJ-NP-Z]{6}$/);
  });
});
