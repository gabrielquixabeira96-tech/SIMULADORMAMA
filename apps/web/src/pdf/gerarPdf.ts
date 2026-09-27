import { PDFDocument, PDFName, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { AVISO_FIXO } from "@/config/aviso";
import { ROTULO_IMF, ROTULO_LADO, ROTULO_PLANO, fmtNum, type RelatorioFinal } from "@/llm/relatorio";

/**
 * PDF do atendimento (Marco 2b) com `pdf-lib` (MIT), sem imagem real (nem snapshot da malha):
 * versão do software, parâmetros (desenho, versões de config, implantes, plano, IMF, envelope,
 * selo "coeficientes não calibrados"), simulações mostradas, relatório (template + prosa
 * verificada), aviso de caráter ilustrativo e placeholder de assinatura ICP-Brasil.
 * Sem link, anotação, anexo, JavaScript ou função de compartilhamento (Res. CFM 2.336/2023).
 */

export const TITULO_PDF = "Registro do atendimento — simulação de mamoplastia de aumento";
export const SELO_NAO_CALIBRADO = "COEFICIENTES NÃO CALIBRADOS";
export const PLACEHOLDER_ASSINATURA = "Assinatura digital ICP-Brasil: [placeholder — documento NÃO assinado digitalmente]";
export const RODAPE_SEM_COMPARTILHAMENTO = "Documento do prontuário; não destinado a divulgação ou uso publicitário.";

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 50;
const COR_TEXTO = rgb(0.1, 0.1, 0.12);
const COR_TARJA = rgb(0.72, 0.11, 0.11);
const COR_CINZA = rgb(0.4, 0.4, 0.45);

// WinAnsi (fontes padrão do PDF): Latin-1 + os extras de 0x80–0x9F.
const EXTRAS_WINANSI = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const TROCAS: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "×": "x", "−": "-", " ": " ", " ": " ", " ": " " };

/** Converte para caracteres que as fontes padrão (WinAnsi) conseguem desenhar. */
export function paraWinAnsi(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\t") out += " ";
    else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff && ch !== " ") || EXTRAS_WINANSI.has(ch)) out += ch;
    else if (TROCAS[ch] !== undefined) out += TROCAS[ch];
    else if (cp < 0x20) continue;
    else out += "?";
  }
  return out;
}

class Escritor {
  private pagina!: PDFPage;
  private y = 0;
  readonly paginas: PDFPage[] = [];
  constructor(
    private readonly doc: PDFDocument,
    readonly fonte: PDFFont,
    readonly negrito: PDFFont,
  ) {
    this.novaPagina();
  }

  private novaPagina(): void {
    this.pagina = this.doc.addPage(A4);
    this.paginas.push(this.pagina);
    this.y = A4[1] - MARGEM;
  }

  private garantir(altura: number): void {
    if (this.y - altura < MARGEM + 30) this.novaPagina();
  }

  private quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
    const linhas: string[] = [];
    for (const par of paraWinAnsi(texto).split("\n")) {
      let atual = "";
      for (const palavra of par.split(/ +/)) {
        const tentativa = atual ? `${atual} ${palavra}` : palavra;
        if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura || !atual) atual = tentativa;
        else {
          linhas.push(atual);
          atual = palavra;
        }
      }
      linhas.push(atual);
    }
    return linhas;
  }

  texto(t: string, o: { tamanho?: number; negrito?: boolean; cor?: ReturnType<typeof rgb>; recuo?: number; depois?: number } = {}): void {
    const tamanho = o.tamanho ?? 10;
    const fonte = o.negrito ? this.negrito : this.fonte;
    const recuo = o.recuo ?? 0;
    const alturaLinha = tamanho * 1.35;
    for (const linha of this.quebrar(t, fonte, tamanho, A4[0] - 2 * MARGEM - recuo)) {
      this.garantir(alturaLinha);
      this.y -= alturaLinha;
      this.pagina.drawText(linha, { x: MARGEM + recuo, y: this.y, size: tamanho, font: fonte, color: o.cor ?? COR_TEXTO });
    }
    this.y -= o.depois ?? 2;
  }

  titulo(t: string): void {
    this.garantir(40);
    this.y -= 10;
    this.texto(t, { tamanho: 12.5, negrito: true, depois: 4 });
  }

  caixa(linhas: string[], o: { cor: ReturnType<typeof rgb>; tamanho?: number; negrito?: boolean }): void {
    const tamanho = o.tamanho ?? 11;
    const alturaLinha = tamanho * 1.4;
    const quebradas = linhas.flatMap((l) => this.quebrar(l, o.negrito ? this.negrito : this.fonte, tamanho, A4[0] - 2 * MARGEM - 20));
    const altura = quebradas.length * alturaLinha + 12;
    this.garantir(altura + 6);
    this.y -= 6;
    this.pagina.drawRectangle({ x: MARGEM, y: this.y - altura, width: A4[0] - 2 * MARGEM, height: altura, borderColor: o.cor, borderWidth: 1.5 });
    let yy = this.y - 6;
    for (const l of quebradas) {
      yy -= alturaLinha;
      this.pagina.drawText(l, { x: MARGEM + 10, y: yy + 3, size: tamanho, font: o.negrito ? this.negrito : this.fonte, color: o.cor });
    }
    this.y -= altura + 6;
  }

  rodapes(versao: string): void {
    const total = this.paginas.length;
    this.paginas.forEach((p, i) => {
      const t = paraWinAnsi(`${AVISO_FIXO} · versão do software ${versao} · página ${i + 1} de ${total}`);
      p.drawText(t, { x: MARGEM, y: MARGEM - 12, size: 8, font: this.fonte, color: COR_CINZA });
      p.drawText(paraWinAnsi(RODAPE_SEM_COMPARTILHAMENTO), { x: MARGEM, y: MARGEM - 22, size: 7, font: this.fonte, color: COR_CINZA });
    });
  }
}

function dataHoraLegivel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}

const ROTULO_DESENHO = { A: "A (medidas digitadas pelo cirurgião; sem números calculados)", B: "B (medição automática e volume calculado ativos)" } as const;

export async function gerarPdfAtendimento(r: RelatorioFinal, geradoEm: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(paraWinAnsi("Registro do atendimento"));
  doc.setSubject(paraWinAnsi(`Atendimento ${r.atendimento_id}`));
  doc.setProducer(`simulador-mamario ${r.versao_software}`);
  doc.setCreator(`simulador-mamario ${r.versao_software}`);
  doc.setAuthor("");
  doc.setKeywords([]);
  const criado = new Date(geradoEm);
  if (!Number.isNaN(criado.getTime())) {
    doc.setCreationDate(criado);
    doc.setModificationDate(criado);
  }
  const w = new Escritor(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.texto(TITULO_PDF, { tamanho: 15, negrito: true, depois: 6 });
  w.caixa([AVISO_FIXO], { cor: COR_TARJA, tamanho: 13, negrito: true });

  w.titulo("Identificação (pseudonimizada)");
  w.texto(`Paciente: ${r.pseudonimo}`);
  w.texto(`Atendimento: ${r.atendimento_id}`);
  w.texto(`Relatório: ${r.relatorio_id} (gerado em ${dataHoraLegivel(r.gerado_em)})`);
  w.texto(`PDF gerado em: ${dataHoraLegivel(geradoEm)}`);

  w.titulo("Software");
  w.texto(`Versão do software: ${r.versao_software}`);

  w.titulo("Parâmetros");
  w.texto(`Desenho: ${ROTULO_DESENHO[r.desenho]}`);
  w.texto(`Configuração da simulação: versão ${r.parametros.versao_config.simulacao}`);
  w.texto(`Configuração TEPID: versão ${r.parametros.versao_config.tepid}`);
  w.texto(`Envelope de incerteza da superfície simulada: ±${fmtNum(r.parametros.envelope_rms_mm)} mm (RMS)`);
  if (r.parametros.nao_calibrado) w.caixa([`Selo: ${SELO_NAO_CALIBRADO}`], { cor: COR_TARJA, tamanho: 10, negrito: true });
  w.texto("Implantes mostrados:", { negrito: true });
  if (r.dados_travados.implantes_mostrados.length === 0) w.texto("nenhum", { recuo: 12 });
  for (const i of r.dados_travados.implantes_mostrados) {
    const specs = [i.volume_ml !== undefined ? `${fmtNum(i.volume_ml)} mL` : null, i.base_mm !== undefined ? `base ${fmtNum(i.base_mm)} mm` : null, i.projecao_mm !== undefined ? `projeção ${fmtNum(i.projecao_mm)} mm` : null]
      .filter(Boolean)
      .join(", ");
    w.texto(`• ${i.rotulo} [${i.id}] — ${specs} — plano: ${ROTULO_PLANO[i.plano]} — IMF: ${ROTULO_IMF[i.imf]}`, { recuo: 12 });
  }

  w.titulo("Simulações mostradas");
  if (r.simulacoes_mostradas.length === 0) w.texto("Nenhuma simulação registrada neste atendimento.");
  for (const s of r.simulacoes_mostradas) {
    w.texto(
      `• ${dataHoraLegivel(s.mostrada_em)} — ${s.rotulo} — plano: ${ROTULO_PLANO[s.plano]} — IMF: ${ROTULO_IMF[s.imf]} — ${ROTULO_LADO[s.lado]} — config. simulação ${s.versao_config_simulacao}${s.nao_calibrado ? " — não calibrado" : ""}`,
      { recuo: 12 },
    );
  }
  w.texto("Imagens da simulação não são incluídas neste documento.", { cor: COR_CINZA, tamanho: 8.5 });

  w.titulo("Relatório para a paciente");
  w.texto(
    r.prosa_origem === "llm"
      ? "Parágrafos redigidos por modelo de linguagem a partir de dados pseudonimizados; todos os números foram conferidos com os dados do atendimento."
      : "Parágrafos-padrão do sistema (texto fixo, sem números).",
    { cor: COR_CINZA, tamanho: 8.5, depois: 6 },
  );
  for (const s of r.secoes) {
    w.texto(s.titulo, { negrito: true, tamanho: 10.5 });
    for (const l of s.linhas) w.texto(l, { recuo: s.origem === "template" ? 12 : 0 });
    w.texto("", { depois: 2 });
  }

  w.titulo("Assinatura");
  w.caixa([PLACEHOLDER_ASSINATURA, "Responsável técnico: ______________________________   CRM: __________"], { cor: COR_TEXTO, tamanho: 10 });

  w.rodapes(r.versao_software);
  // Nenhuma anotação (link, formulário, anexo): remove até o /Annots vazio que o pdf-lib cria.
  for (const p of doc.getPages()) p.node.delete(PDFName.of("Annots"));
  return doc.save({ useObjectStreams: false });
}
