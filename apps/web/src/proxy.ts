import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_TOKEN, PARAM_TOKEN, avaliarRequisicao, confiarProxyTls, origemOriginal, type EntradaRequisicao } from "@/seguranca/requisicao";

/**
 * Proxy do Next.js 16 (o antigo `middleware.ts`, renomeado para `proxy.ts` no Next 16; roda no
 * runtime Node). Aplica as regras de `seguranca/requisicao.ts` a toda requisição fora dos
 * estáticos do Next: host em loopback, token local (`APP_TOKEN_LOCAL`) e, nas rotas `/api/*`
 * mutantes, Content-Type JSON e Origin do próprio app (ADR 0003 item 7). No modo demo sintética
 * (ADR 0018) fecha o upload e a anamnese e honra o proxy TLS no redirecionamento do `?token=`.
 */
export function proxy(req: NextRequest): NextResponse {
  const parametro = req.nextUrl.searchParams.get(PARAM_TOKEN);
  const env: EntradaRequisicao["env"] = {
    APP_TOKEN_LOCAL: process.env.APP_TOKEN_LOCAL,
    APP_HOSTS_PERMITIDOS: process.env.APP_HOSTS_PERMITIDOS,
    NODE_ENV: process.env.NODE_ENV,
    BENCHMARK_HABILITADO: process.env.BENCHMARK_HABILITADO,
    DEMO_SINTETICA: process.env.DEMO_SINTETICA,
    APP_CONFIAR_PROXY_TLS: process.env.APP_CONFIAR_PROXY_TLS,
  };
  const r = avaliarRequisicao(
    {
      metodo: req.method,
      caminho: req.nextUrl.pathname,
      cabecalho: (n) => req.headers.get(n),
      cookie: (n) => req.cookies.get(n)?.value ?? null,
      hostUrl: req.nextUrl.host,
      env,
    },
    parametro,
  );
  if (!r.ok) {
    if (r.recusa.status === 401 && navegacaoHtml(req)) return paginaAcesso();
    return NextResponse.json(
      { erro: { codigo: r.recusa.codigo, mensagem: r.recusa.mensagem } },
      { status: r.recusa.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (r.autenticacao === "param") {
    // grava o cookie e tira o token da URL (não fica no histórico nem em Referer)
    // Location com o MESMO host da requisição (já validado acima): o NextURL troca 127.0.0.1 por
    // localhost, e o cookie é por host. Atrás de proxy TLS confiável (modo demo ou
    // APP_CONFIAR_PROXY_TLS=1), protocolo e host originais vêm de X-Forwarded-Proto/-Host: nada de
    // Location http:// para quem chegou por https://, e o cookie sai Secure.
    const params = new URLSearchParams(req.nextUrl.search);
    params.delete(PARAM_TOKEN);
    const busca = params.toString();
    const origem = origemOriginal({
      protocoloUrl: req.nextUrl.protocol,
      host: req.headers.get("host") ?? req.nextUrl.host,
      xForwardedProto: req.headers.get("x-forwarded-proto"),
      xForwardedHost: req.headers.get("x-forwarded-host"),
      confiar: confiarProxyTls(env),
    });
    const destino = `${origem.protocolo}//${origem.host}${req.nextUrl.pathname}${busca ? `?${busca}` : ""}`;
    const resp = new NextResponse(null, { status: 303, headers: { Location: destino, "Cache-Control": "no-store" } });
    resp.cookies.set(COOKIE_TOKEN, parametro!, { httpOnly: true, sameSite: "strict", path: "/", secure: origem.protocolo === "https:" });
    return resp;
  }
  return NextResponse.next();
}

/**
 * Navegação de página (barra de endereço/link) de quem chega sem token: GET fora de /api/ que aceita
 * HTML. Só essa resposta vira página legível; fetch/XHR, /api/* e qualquer outro método continuam
 * com o 401 JSON de sempre.
 */
function navegacaoHtml(req: NextRequest): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (req.nextUrl.pathname.startsWith("/api/")) return false;
  const modo = req.headers.get("sec-fetch-mode");
  if (modo && modo !== "navigate") return false;
  return (req.headers.get("accept") ?? "").toLowerCase().includes("text/html");
}

/**
 * Página 401 mínima (P3): instrução legível, sem versão, caminho, código interno nem detalhes do
 * servidor. Status 401 mantido (o token continua obrigatório em todas as rotas).
 */
const HTML_ACESSO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Acesso</title>
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#1c2128;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box}main{max-width:32rem;background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:1.5rem 1.75rem}h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:.5rem 0;line-height:1.5}</style>
</head><body><main><h1>Acesso</h1><p>Abra o link enviado pelo administrador para entrar.</p><p>Se o link não funcionar, peça um novo ao administrador.</p></main></body></html>`;

function paginaAcesso(): NextResponse {
  return new NextResponse(HTML_ACESSO, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
