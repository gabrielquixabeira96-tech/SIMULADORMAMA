import { unzipSync } from "fflate";

/**
 * Regras do upload de malhas (ADR 0003): OBJ (+MTL+PNG/JPG), PLY, ou ZIP contendo um deles.
 * Limite padrão 500 MB. Nomes são reduzidos ao basename e higienizados (sem subpastas, sem `..`).
 */
export const EXTENSOES_ACEITAS = [".obj", ".mtl", ".png", ".jpg", ".jpeg", ".ply", ".zip"] as const;
export const LIMITE_PADRAO_BYTES = 500 * 1024 * 1024;

export class ErroUpload extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroUpload";
  }
}

export interface ArquivoUpload {
  nome: string;
  dados: Uint8Array;
}

export interface UploadPreparado {
  arquivos: ArquivoUpload[];
  principal: string;
  formato: "obj" | "ply";
  bytes: number;
}

export function limiteUploadBytes(): number {
  const mb = Number(process.env.UPLOAD_MAX_MB);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : LIMITE_PADRAO_BYTES;
}

function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i).toLowerCase() : "";
}

/** basename + só [A-Za-z0-9._-]; recusa nomes vazios ou ocultos. */
export function nomeSeguro(bruto: string): string {
  const base = bruto.split(/[\\/]/).pop() ?? "";
  const limpo = base.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 128);
  if (!limpo || limpo === "." || limpo === "..") throw new ErroUpload(400, "nome_invalido", "nome de arquivo inválido");
  return limpo;
}

export function prepararUpload(entrada: ArquivoUpload[], limite = limiteUploadBytes()): UploadPreparado {
  if (entrada.length === 0) throw new ErroUpload(400, "sem_arquivos", "nenhum arquivo enviado");
  let arquivos: ArquivoUpload[] = [];
  let bytes = 0;
  const somar = (n: number) => {
    bytes += n;
    if (bytes > limite) throw new ErroUpload(413, "upload_grande_demais", `upload acima do limite de ${Math.round(limite / 1024 / 1024)} MB`);
  };
  for (const a of entrada) {
    const nome = nomeSeguro(a.nome);
    const ext = extensao(nome);
    if (!(EXTENSOES_ACEITAS as readonly string[]).includes(ext)) throw new ErroUpload(415, "formato_nao_aceito", `formato não aceito: ${ext || "(sem extensão)"}`);
    if (ext === ".zip") {
      somar(a.dados.byteLength);
      let conteudo: Record<string, Uint8Array>;
      try {
        conteudo = unzipSync(a.dados, {
          filter: (f) => {
            // proteção contra zip-bomb: soma o tamanho declarado antes de descompactar
            if (!f.name.endsWith("/")) somar(f.originalSize);
            return !f.name.endsWith("/") && !f.name.startsWith("__MACOSX/");
          },
        });
      } catch (e) {
        if (e instanceof ErroUpload) throw e;
        throw new ErroUpload(400, "zip_invalido", "arquivo zip inválido");
      }
      for (const [n, dados] of Object.entries(conteudo)) {
        const nomeInterno = nomeSeguro(n);
        const extInterna = extensao(nomeInterno);
        if (extInterna === ".zip") throw new ErroUpload(415, "formato_nao_aceito", "zip dentro de zip não é aceito");
        if ((EXTENSOES_ACEITAS as readonly string[]).includes(extInterna)) arquivos.push({ nome: nomeInterno, dados });
      }
    } else {
      somar(a.dados.byteLength);
      arquivos.push({ nome, dados: a.dados });
    }
  }
  // nomes duplicados (ex.: zip com subpastas achatadas) → recusa
  const vistos = new Set<string>();
  for (const a of arquivos) {
    if (vistos.has(a.nome)) throw new ErroUpload(400, "nome_duplicado", `arquivo duplicado: ${a.nome}`);
    vistos.add(a.nome);
  }
  arquivos = arquivos.sort((x, y) => x.nome.localeCompare(y.nome));
  const malhas = arquivos.filter((a) => [".obj", ".ply"].includes(extensao(a.nome)));
  if (malhas.length === 0) throw new ErroUpload(415, "sem_malha", "envie um arquivo .obj ou .ply");
  if (malhas.length > 1) throw new ErroUpload(400, "malhas_multiplas", "envie uma única malha (.obj ou .ply) por upload");
  // O arquivo de malha é renomeado para scan.<ext>: nomes de exportação às vezes carregam o
  // nome da paciente, e o nome vai para meta.json e para o banco. Nenhum outro arquivo
  // referencia o .obj/.ply pelo nome, então a troca é segura.
  const original = malhas[0]!;
  const principal = `scan${extensao(original.nome)}`;
  original.nome = principal;
  return { arquivos, principal, formato: extensao(principal) === ".obj" ? "obj" : "ply", bytes };
}
