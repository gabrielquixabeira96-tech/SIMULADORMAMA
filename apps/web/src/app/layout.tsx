import type { Metadata, Viewport } from "next";
import { versaoSoftware } from "@/config/ambiente";
import { demoAtiva } from "@/config/demo";
import { getDesenho } from "@/config/desenho";
import { AvisoFixo } from "@/ui/AvisoFixo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simulador mamário — consulta",
  description: "Ferramenta de consulta: ilustração, não previsão de resultado.",
  robots: { index: false, follow: false },
  // ícone: src/app/icon.svg (vetor escrito à mão; o Next publica o <link rel="icon">)
  appleWebApp: { capable: true, title: "Simulador", statusBarStyle: "default" },
};

/** iPad em paisagem/retrato: largura do aparelho; o zoom continua permitido (acessibilidade). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b5cad",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AvisoFixo versao={versaoSoftware()} desenho={getDesenho()} demo={demoAtiva()} />
        <main className={demoAtiva() ? "conteudo conteudo-demo" : "conteudo"}>{children}</main>
      </body>
    </html>
  );
}
