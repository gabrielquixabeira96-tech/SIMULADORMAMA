import type { Metadata } from "next";
import { versaoSoftware } from "@/config/ambiente";
import { getDesenho } from "@/config/desenho";
import { AvisoFixo } from "@/ui/AvisoFixo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simulador mamário — consulta",
  description: "Ferramenta de consulta: ilustração, não previsão de resultado.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AvisoFixo versao={versaoSoftware()} desenho={getDesenho()} />
        <main className="conteudo">{children}</main>
      </body>
    </html>
  );
}
