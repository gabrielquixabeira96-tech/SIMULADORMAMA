/**
 * Regras de segurança de borda aplicadas pelo `src/proxy.ts` a toda requisição (ADR 0003 item 7,
 * revisão v0.1.1). Funções puras (sem Next), testadas em `tests/unit/proxy.test.ts`.
 *
 * 1. Host: só loopback (`127.0.0.1`, `localhost`, `::1`) ou os nomes de `APP_HOSTS_PERMITIDOS`
 *    — barra DNS rebinding.
 * 2. Token local: com `APP_TOKEN_LOCAL` definido, toda rota exige o token, por cabeçalho
 *    `Authorization: Bearer <token>` ou pelo cookie `simulador_token` (HttpOnly, SameSite=Strict),
 *    que é gravado quando a página é aberta uma vez com `?token=<token>`. Em produção
 *    (`NODE_ENV=production`, ou seja, `next start`) o token é obrigatório: sem ele o servidor
 *    responde 503 (e `instrumentation.ts` recusa subir).
 * 3. Rotas `/api/*` mutantes (POST/PUT/PATCH/DELETE): `Content-Type: application/json`
 *    (exceção: `multipart/form-data` só em `POST /api/malhas`, o upload), e `Origin` igual ao
 *    próprio app. Sem `Origin`, só passa quem se autenticou pelo cabeçalho `Authorization`
 *    (cliente não-navegador; um navegador sempre manda `Origin` em POST, e um site de terceiros
 *    não consegue pôr `Authorization` sem CORS, que o app não habilita).
 */

export const COOKIE_TOKEN = "simulador_token";
export const PARAM_TOKEN = "token";

const METODOS_MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HOSTS_LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
/** Rotas que aceitam multipart/form-data (upload de malhas; ADR 0003 item 2). */
const ROTAS_MULTIPART = new Set(["/api/malhas"]);

export interface Recusa {
  status: 400 | 401 | 403 | 415 | 503;
  codigo: string;
  mensagem: string;
}

export interface EntradaRequisicao {
  metodo: string;
  caminho: string;
  /** cabeçalhos em minúsculas */
  cabecalho: (nome: string) => string | null;
  cookie: (nome: string) => string | null;
  /** host da URL (fallback quando não há cabeçalho Host) */
  hostUrl: string;
  env: {
    APP_TOKEN_LOCAL?: string | undefined;
    APP_HOSTS_PERMITIDOS?: string | undefined;
    NODE_ENV?: string | undefined;
  };
}

/** Comparação em tempo constante (independe de onde as strings divergem). */
export function tokenIgual(a: string, b: string): boolean {
  let dif = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) dif |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return dif === 0;
}

function nomeDoHost(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const i = h.lastIndexOf(":");
  return i >= 0 ? h.slice(0, i) : h;
}

export function hostPermitido(host: string, extras: string | undefined): boolean {
  const nome = nomeDoHost(host);
  if (HOSTS_LOOPBACK.has(nome)) return true;
  const lista = (extras ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return lista.includes(nome);
}

function tipoDeMidia(ct: string | null): string {
  return (ct ?? "").split(";")[0]!.trim().toLowerCase();
}

export type Autenticacao = "desligada" | "cabecalho" | "cookie" | "param";

/**
 * Avalia a requisição. Devolve a recusa (status + código) ou `{ ok, autenticacao }`.
 * `param` = token veio em `?token=`: o proxy grava o cookie e redireciona sem o parâmetro.
 */
export function avaliarRequisicao(r: EntradaRequisicao, parametroToken: string | null = null): { ok: true; autenticacao: Autenticacao } | { ok: false; recusa: Recusa } {
  const host = r.cabecalho("host") ?? r.hostUrl;
  if (!host || !hostPermitido(host, r.env.APP_HOSTS_PERMITIDOS)) {
    return { ok: false, recusa: { status: 403, codigo: "host_nao_permitido", mensagem: "host não permitido (o app só atende em loopback)" } };
  }

  // ---- token local
  const token = r.env.APP_TOKEN_LOCAL ?? "";
  let autenticacao: Autenticacao = "desligada";
  if (token) {
    const auth = r.cabecalho("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? null;
    const cookie = r.cookie(COOKIE_TOKEN);
    if (bearer !== null && tokenIgual(bearer, token)) autenticacao = "cabecalho";
    else if (cookie !== null && tokenIgual(cookie, token)) autenticacao = "cookie";
    else if (parametroToken !== null && r.metodo === "GET" && tokenIgual(parametroToken, token)) autenticacao = "param";
    else return { ok: false, recusa: { status: 401, codigo: "nao_autenticado", mensagem: "token local ausente ou inválido (abra o app com ?token=<APP_TOKEN_LOCAL>)" } };
  } else if (r.env.NODE_ENV === "production") {
    return { ok: false, recusa: { status: 503, codigo: "token_local_nao_configurado", mensagem: "APP_TOKEN_LOCAL não configurado" } };
  }

  // ---- rotas mutantes da API
  const metodo = r.metodo.toUpperCase();
  if (r.caminho.startsWith("/api/") && METODOS_MUTANTES.has(metodo)) {
    const midia = tipoDeMidia(r.cabecalho("content-type"));
    const multipartOk = midia === "multipart/form-data" && ROTAS_MULTIPART.has(r.caminho);
    if (midia !== "application/json" && !multipartOk) {
      return { ok: false, recusa: { status: 415, codigo: "content_type_invalido", mensagem: "envie Content-Type: application/json" } };
    }
    const origem = r.cabecalho("origin");
    const sfs = r.cabecalho("sec-fetch-site");
    if (sfs && sfs !== "same-origin" && sfs !== "none") {
      return { ok: false, recusa: { status: 403, codigo: "origem_nao_permitida", mensagem: "requisição de outra origem recusada" } };
    }
    if (origem === null) {
      if (autenticacao !== "cabecalho") {
        return { ok: false, recusa: { status: 403, codigo: "origem_ausente", mensagem: "cabeçalho Origin obrigatório" } };
      }
    } else {
      let hostOrigem: string | null = null;
      try {
        const u = new URL(origem);
        hostOrigem = u.protocol === "http:" || u.protocol === "https:" ? u.host.toLowerCase() : null;
      } catch {
        hostOrigem = null;
      }
      if (hostOrigem === null || hostOrigem !== host.trim().toLowerCase()) {
        return { ok: false, recusa: { status: 403, codigo: "origem_nao_permitida", mensagem: "requisição de outra origem recusada" } };
      }
    }
  }
  return { ok: true, autenticacao };
}
