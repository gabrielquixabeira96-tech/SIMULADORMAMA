import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

/** Extrai o texto de um PDF (pdfjs-dist, Apache-2.0; só em teste). Uma linha por item de texto. */
export async function extrairTextoPdf(bytes: Uint8Array): Promise<{ texto: string; paginas: number; links: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = `${resolve(dirname(createRequire(__filename).resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, standardFontDataUrl });
  const doc = await tarefa.promise;
  const partes: string[] = [];
  let links = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const c = await pg.getTextContent();
    for (const it of c.items) if ("str" in it) partes.push(it.str);
    links += (await pg.getAnnotations()).length;
  }
  const paginas = doc.numPages;
  await tarefa.destroy();
  return { texto: partes.filter((l) => l.trim() !== "").join("\n"), paginas, links };
}
