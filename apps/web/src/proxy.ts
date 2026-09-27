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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
