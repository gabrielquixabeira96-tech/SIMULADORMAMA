import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_TOKEN, PARAM_TOKEN, avaliarRequisicao } from "@/seguranca/requisicao";

/**
 * Proxy do Next.js 16 (o antigo `middleware.ts`, renomeado para `proxy.ts` no Next 16; roda no
 * runtime Node). Aplica as regras de `seguranca/requisicao.ts` a toda requisição fora dos
 * estáticos do Next: host em loopback, token local (`APP_TOKEN_LOCAL`) e, nas rotas `/api/*`
 * mutantes, Content-Type JSON e Origin do próprio app (ADR 0003 item 7).
 */
export function proxy(req: NextRequest): NextResponse {
  const parametro = req.nextUrl.searchParams.get(PARAM_TOKEN);
  const r = avaliarRequisicao(
    {
      metodo: req.method,
      caminho: req.nextUrl.pathname,
      cabecalho: (n) => req.headers.get(n),
      cookie: (n) => req.cookies.get(n)?.value ?? null,
      hostUrl: req.nextUrl.host,
      env: { APP_TOKEN_LOCAL: process.env.APP_TOKEN_LOCAL, APP_HOSTS_PERMITIDOS: process.env.APP_HOSTS_PERMITIDOS, NODE_ENV: process.env.NODE_ENV },
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
    // localhost, e o cookie é por host.
    const params = new URLSearchParams(req.nextUrl.search);
    params.delete(PARAM_TOKEN);
    const busca = params.toString();
    const host = req.headers.get("host") ?? req.nextUrl.host;
    const destino = `${req.nextUrl.protocol}//${host}${req.nextUrl.pathname}${busca ? `?${busca}` : ""}`;
    const resp = new NextResponse(null, { status: 303, headers: { Location: destino, "Cache-Control": "no-store" } });
    resp.cookies.set(COOKIE_TOKEN, parametro!, { httpOnly: true, sameSite: "strict", path: "/", secure: req.nextUrl.protocol === "https:" });
    return resp;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
