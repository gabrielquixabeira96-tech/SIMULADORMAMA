import type { FotoRealEntrada } from "@/simulacao/RenderizadorFotos";
import type { FotoRealPublica } from "./publica";

/**
 * Carrega (navegador) a reconstrução por fotos de uma malha para a vista "Foto real": o resumo
 * (`/api/malhas/<id>/foto-real`), as fotos e o `observado.png` pela rota de arquivo (lista fixa,
 * auditada, `no-store`). As imagens ficam só na memória (ImageBitmap): nada em localStorage,
 * IndexedDB ou cache do navegador; nada sai do navegador.
 */

export interface FotoRealCliente {
  publica: FotoRealPublica;
  entradas: FotoRealEntrada[];
  observado: ImageBitmap | null;
}

const urlArquivo = (malhaId: string, nome: string) => `/api/malhas/${malhaId}/arquivo?nome=${encodeURIComponent(nome)}`;

async function bitmap(url: string): Promise<ImageBitmap> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`foto indisponível (${r.status})`);
  return createImageBitmap(await r.blob());
}

/** null = a malha não veio de fotos (scan ou torso sintético). */
export async function carregarFotoReal(malhaId: string): Promise<FotoRealCliente | null> {
  const r = await fetch(`/api/malhas/${malhaId}/foto-real`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`reconstrução indisponível (${r.status})`);
  const publica = (await r.json()) as FotoRealPublica;
  const entradas = await Promise.all(
    publica.fotos.map(async (f) => {
      const imagem = await bitmap(urlArquivo(malhaId, f.arquivo));
      if (imagem.width !== f.largura_px || imagem.height !== f.altura_px) {
        imagem.close();
        throw new Error(`foto ${f.vista} com ${imagem.width}×${imagem.height} px, diferente do registro da câmera (${f.largura_px}×${f.altura_px})`);
      }
      return { vista: f.vista, camera: { K: f.K, R: f.R, t: f.t, largura_px: f.largura_px, altura_px: f.altura_px }, imagem } satisfies FotoRealEntrada;
    }),
  );
  const observado = publica.observado ? await bitmap(urlArquivo(malhaId, "observado.png")).catch(() => null) : null;
  return { publica, entradas, observado };
}

