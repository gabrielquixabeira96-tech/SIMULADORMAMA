/**
 * Revisão v0.1.1, item 10: o limite do corpo é aplicado pelo STREAM (bytes recebidos), então
 * `Transfer-Encoding: chunked` (sem Content-Length) não contorna o upload, e as rotas JSON têm
 * teto de 1 MB. Nada aqui toca o banco: o 413 sai antes de qualquer acesso a dados.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITE_JSON_BYTES, lerJson } from "@/api/respostas";
import { POST as postAvaliar } from "@/app/api/tepid/avaliar/route";
import { POST as postMalha } from "@/app/api/malhas/route";

afterEach(() => vi.unstubAllEnvs());

/** Corpo em pedaços de 64 KB, SEM Content-Length (como chunked). */
function streamDe(total: number, prefixo = "", sufixo = ""): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let enviado = 0;
  let fase = 0;
  return new ReadableStream({
    pull(ctl) {
      if (fase === 0) {
        fase = 1;
        if (prefixo) return ctl.enqueue(enc.encode(prefixo));
      }
      if (enviado < total) {
        const n = Math.min(65536, total - enviado);
        enviado += n;
        return ctl.enqueue(new Uint8Array(n).fill(0x61));
      }
      if (sufixo && fase === 1) {
        fase = 2;
        return ctl.enqueue(enc.encode(sufixo));
      }
      ctl.close();
    },
  });
}
const req = (url: string, corpo: ReadableStream<Uint8Array>, tipo: string) =>
  new Request(url, { method: "POST", headers: { "Content-Type": tipo }, body: corpo, duplex: "half" } as RequestInit);

describe("limite do corpo por stream", () => {
  it("rota JSON: corpo chunked de 2 MB → 413 corpo_grande_demais", async () => {
    const r = await postAvaliar(req("http://x/api/tepid/avaliar", streamDe(2 * 1024 * 1024, '{"valores":"', '"}'), "application/json"));
    expect(r.status).toBe(413);
    expect((await r.json()).erro.codigo).toBe("corpo_grande_demais");
  });

  it("rota JSON: Content-Length declarado acima do teto → 413 sem ler o corpo", async () => {
    await expect(lerJson(new Request("http://x", { method: "POST", headers: { "Content-Length": String(LIMITE_JSON_BYTES + 1) }, body: "{}" }))).rejects.toThrow(/limite/);
  });

  it("rota JSON: corpo pequeno continua funcionando", async () => {
    const r = await postAvaliar(new Request("http://x/api/tepid/avaliar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores: {} }) }));
    expect(r.status).toBe(400); // valores inválidos, mas o corpo foi lido
  });

  it("upload multipart chunked acima de UPLOAD_MAX_MB → 413 (antes só o Content-Length era checado)", async () => {
    vi.stubEnv("UPLOAD_MAX_MB", "1");
    const b = "----limite";
    const cab = `--${b}\r\nContent-Disposition: form-data; name="arquivos"; filename="scan.obj"\r\nContent-Type: text/plain\r\n\r\n`;
    const r = await postMalha(req("http://x/api/malhas", streamDe(3 * 1024 * 1024, cab, `\r\n--${b}--\r\n`), `multipart/form-data; boundary=${b}`));
    expect(r.status).toBe(413);
    expect((await r.json()).erro.codigo).toBe("upload_grande_demais");
  });
});
