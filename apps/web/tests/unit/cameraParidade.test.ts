/**
 * Paridade da câmera do C1 (reconstrucao/1.0) com o services/mesh (plano "foto → 3D"): a fixture
 * tem câmeras e landmarks 3D de uma reconstrução REAL do pipeline (t01, frente + oblíqua D + perfil D)
 * e os pixels que o `camera.projetar` do Python dá (u, v contínuos, origem no canto). A câmera three
 * (`cameraDaFoto`) e a textura projetiva (`matrizTexturaFoto`) têm de cair nos mesmos pixels (≤ 0,5 px;
 * na prática ~1e-6). O mesmo arquivo é conferido em services/mesh/tests/test_paridade_camera.py.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cameraDaFoto, encaixeDaFoto, matrizTexturaFoto, pixelDaFoto, pixelNoQuadro, uvDaFoto, type ParametrosCameraFoto } from "@/simulacao/cameraDaFoto";

interface FotoFixture extends ParametrosCameraFoto {
  vista: string;
  k1: number;
  pixels: Record<string, [number, number]>;
}
const FIX = JSON.parse(readFileSync(join(__dirname, "../fixtures/foto3d/paridade_camera.json"), "utf8")) as {
  landmarks_3d: Record<string, [number, number, number]>;
  fotos: FotoFixture[];
};
const TOL_PX = 0.5;

describe("câmera do C1: web = services/mesh", () => {
  it("3 fotos, 10 landmarks: pixelDaFoto, a PerspectiveCamera e a textura projetiva caem nos pixels do Python", () => {
    expect(FIX.fotos.map((f) => f.vista)).toEqual(["frente", "obliqua_dir", "perfil_dir"]);
    let pior = 0;
    for (const f of FIX.fotos) {
      expect(f.k1).toBe(0);
      const W = f.largura_px, H = f.altura_px;
      const camCheia = cameraDaFoto(f, W, H, { centro: [0, -150, 60], raio: 300 });
      // quadro menor e de outra proporção (como no comparador): pixel = u·s + deslocamento
      const [w, h] = [640, 360];
      const e = encaixeDaFoto(W, H, w, h);
      const camQuadro = cameraDaFoto(f, w, h, { centro: [0, -150, 60], raio: 300 });
      const tex = matrizTexturaFoto(f);
      for (const [id, X] of Object.entries(FIX.landmarks_3d)) {
        const [u, v] = f.pixels[id]!;
        const ref = pixelDaFoto(f, X)!;
        const cheio = pixelNoQuadro(camCheia, X, W, H);
        const q = pixelNoQuadro(camQuadro, X, w, h);
        const [s, t] = uvDaFoto(tex, X);
        const d = [
          Math.hypot(ref[0] - u, ref[1] - v),
          Math.hypot(cheio[0] - u, cheio[1] - v),
          Math.hypot((q[0] - e.x) / e.escala - u, (q[1] - e.y) / e.escala - v),
          Math.hypot(s * W - u, t * H - v),
        ];
        pior = Math.max(pior, ...d);
      }
    }
    console.log(`[paridade câmera] web × Python: pior ${pior.toExponential(2)} px`);
    expect(pior).toBeLessThan(TOL_PX);
    expect(pior).toBeLessThan(1e-2);
  });
});
