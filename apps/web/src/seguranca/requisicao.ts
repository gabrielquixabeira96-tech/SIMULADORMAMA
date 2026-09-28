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
 * 4. Modo "benchmark na rede" (ADR 0003, revisão v0.1.2): decidido pela CONFIGURAÇÃO, nunca pela
 *    requisição (o Host é do cliente e pode ser forjado). Com `BENCHMARK_HABILITADO=1` e algum host
 *    fora do loopback em `APP_HOSTS_PERMITIDOS`, a instância inteira só atende `/benchmark`,
 *    `/api/benchmark` e `/api/benchmark/arquivo` — qualquer outra rota → 403
 *    `rota_restrita_benchmark`, seja qual for o Host (inclusive `localhost`). A subida também
 *    recusa esse modo com `DATABASE_URL` definido ou `DATA_DIR/pacientes` existente (`config/subida.ts`).
 * 5. Modo "demonstração sintética" (ADR 0018, v0.1.3): `DEMO_SINTETICA=1`, também só pela
 *    configuração. A instância é dedicada, atestada na subida como contendo SÓ dado sintético
 *    (`config/subida.ts`), e fecha as duas entradas de dado real: `POST /api/malhas` (upload) e
 *    `POST /api/llm/anamnese` (texto livre) → 403 `desligado_na_demo`. Nesse modo o "benchmark na
 *    rede" (item 4) NÃO se aplica: o app inteiro e o /benchmark atendem no host público de
 *    `APP_HOSTS_PERMITIDOS`, porque a restrição do item 4 protege dado de paciente e aqui não há
 *    nenhum. Token, Host, Origin e Content-Type continuam valendo em todas as rotas.
 * 6. Proxy TLS (ADR 0018): `X-Forwarded-Proto`/`X-Forwarded-Host` só são levados em conta com
 *    `DEMO_SINTETICA=1` ou `APP_CONFIAR_PROXY_TLS=1`; no modo local padrão são ignorados. O host
 *    encaminhado também tem de estar permitido e passa a ser o host comparado com o `Origin`. Vale
 *    o ÚLTIMO valor de cada cabeçalho (o acrescentado pelo proxy de borda).
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
    BENCHMARK_HABILITADO?: string | undefined;
    DEMO_SINTETICA?: string | undefined;
    APP_CONFIAR_PROXY_TLS?: string | undefined;
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

/**
 * Únicas rotas atendidas no modo "benchmark na rede" (nenhuma toca banco nem dado de paciente).
 * Os estáticos do Next (`/_next/static`, `/_next/image`, `favicon.ico`) já ficam fora do matcher do proxy.
 */
export const ROTAS_BENCHMARK_NA_REDE: ReadonlySet<string> = new Set(["/benchmark", "/api/benchmark", "/api/benchmark/arquivo"]);

/** Nomes extras de `APP_HOSTS_PERMITIDOS` que NÃO são loopback (exposição na rede). */
export function hostsForaDoLoopback(extras: string | undefined): string[] {
  return (extras ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((n) => n && !HOSTS_LOOPBACK.has(n));
}

/** Modo "demonstração sintética" (ADR 0018)? Só pela configuração; qualquer valor diferente de "1" = desligado. */
export function modoDemoSintetica(env: { DEMO_SINTETICA?: string | undefined }): boolean {
  return env.DEMO_SINTETICA === "1";
}

/**
 * Rotas fechadas no modo demo (qualquer método mutante): são as entradas de dado real — o upload
 * de malha e a anamnese em texto livre (ADR 0018).
 */
export const ROTAS_FECHADAS_NA_DEMO: ReadonlySet<string> = new Set(["/api/malhas", "/api/llm/anamnese"]);
export const CODIGO_DESLIGADO_NA_DEMO = "desligado_na_demo";

/** Confia em `X-Forwarded-Proto`/`X-Forwarded-Host`? Só no modo demo ou com `APP_CONFIAR_PROXY_TLS=1`. */
export function confiarProxyTls(env: { DEMO_SINTETICA?: string | undefined; APP_CONFIAR_PROXY_TLS?: string | undefined }): boolean {
  return modoDemoSintetica(env) || env.APP_CONFIAR_PROXY_TLS === "1";
}

/**
 * A instância está no modo "benchmark na rede"? Só pela configuração (env), nunca pela requisição.
 * No modo demo sintética, não: a demo já é atestada sem dado de paciente e precisa do app inteiro.
 */
export function modoBenchmarkNaRede(env: { BENCHMARK_HABILITADO?: string | undefined; APP_HOSTS_PERMITIDOS?: string | undefined; DEMO_SINTETICA?: string | undefined }): boolean {
  if (modoDemoSintetica(env)) return false;
  return env.BENCHMARK_HABILITADO === "1" && hostsForaDoLoopback(env.APP_HOSTS_PERMITIDOS).length > 0;
}

/**
 * ÚLTIMO valor de um cabeçalho encaminhado (`a, b` → `b`), em minúsculas; vazio → null. O último é
 * o que o proxy de borda (o mais próximo do Next) acrescentou; os anteriores podem vir do cliente.
 */
function ultimoValor(v: string | null): string | null {
  const x = (v ?? "").split(",").pop()!.trim().toLowerCase();
  return x ? x : null;
}

/**
 * Protocolo e host ORIGINAIS da requisição (o que o navegador vê), para o `Location` do
 * redirecionamento do `?token=` e o `Secure` do cookie. Sem confiança no proxy: o protocolo da URL
 * e o `Host` (comportamento da v0.1.2). Com confiança: `X-Forwarded-Proto` (só http/https) e
 * `X-Forwarded-Host` (último valor da lista), quando presentes.
 */
export function origemOriginal(a: {
  protocoloUrl: string;
  host: string;
  xForwardedProto: string | null;
  xForwardedHost: string | null;
  confiar: boolean;
}): { protocolo: "http:" | "https:"; host: string } {
  const doUrl = a.protocoloUrl === "https:" ? "https:" : "http:";
  if (!a.confiar) return { protocolo: doUrl, host: a.host };
  const xfp = ultimoValor(a.xForwardedProto);
  const protocolo = xfp === "https" ? "https:" : xfp === "http" ? "http:" : doUrl;
  return { protocolo, host: ultimoValor(a.xForwardedHost) ?? a.host };
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
  const hostCabecalho = r.cabecalho("host") ?? r.hostUrl;
  if (!hostCabecalho || !hostPermitido(hostCabecalho, r.env.APP_HOSTS_PERMITIDOS)) {
    return { ok: false, recusa: { status: 403, codigo: "host_nao_permitido", mensagem: "host não permitido (o app só atende em loopback)" } };
  }
  // Atrás de proxy TLS confiável, o host público (X-Forwarded-Host) também tem de ser permitido e
  // é ele que o navegador põe no Origin.
  let host = hostCabecalho;
  if (confiarProxyTls(r.env)) {
    const encaminhado = ultimoValor(r.cabecalho("x-forwarded-host"));
    if (encaminhado !== null) {
      if (!hostPermitido(encaminhado, r.env.APP_HOSTS_PERMITIDOS)) {
        return { ok: false, recusa: { status: 403, codigo: "host_nao_permitido", mensagem: "host encaminhado não permitido" } };
      }
      host = encaminhado;
    }
  }
  if (modoBenchmarkNaRede(r.env) && !ROTAS_BENCHMARK_NA_REDE.has(r.caminho)) {
    return { ok: false, recusa: { status: 403, codigo: "rota_restrita_benchmark", mensagem: "instância de benchmark na rede: só /benchmark e /api/benchmark são atendidas" } };
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
  // modo demo: entradas de dado real fechadas (antes do Content-Type: o upload multipart também cai aqui)
  if (modoDemoSintetica(r.env) && METODOS_MUTANTES.has(metodo) && ROTAS_FECHADAS_NA_DEMO.has(r.caminho.replace(/\/+$/, "") || "/")) {
    return { ok: false, recusa: { status: 403, codigo: CODIGO_DESLIGADO_NA_DEMO, mensagem: "desligado na demonstração sintética: só torsos sintéticos, sem upload de malha nem anamnese em texto livre" } };
  }
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
