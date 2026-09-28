/**
 * Selo gravado NOS PIXELS de toda imagem do modo foto (ADR 0019; Res. CFM 2.336/2023): uma faixa
 * inferior sólida com o aviso em branco (≥ 16 px, contraste > 7:1) e uma marca diagonal repetida a
 * 8 % sobre a imagem inteira, para que recortar a faixa não apague o aviso. Nada aqui baixa,
 * exporta ou compartilha imagem: o selo existe porque uma captura de tela é sempre possível.
 */

export interface ConfigSelo {
  envelopeMm: number;
  versao: string;
  demo: boolean;
}

export const COR_FAIXA_SELO = "#1c2128";
export const COR_TEXTO_SELO = "#ffffff";
export const ALFA_MARCA_DIAGONAL = 0.08;
export const FONTE_MIN_PX = 16;

const mm = (v: number) => String(v).replace(".", ",");

/** Linhas do selo (puro). `compacto` = miniaturas. Nunca promete resultado. */
export function linhasDoSelo(c: ConfigSelo, opts: { compacto?: boolean } = {}): string[] {
  if (opts.compacto) {
    const l = ["ILUSTRAÇÃO — NÃO É PREVISÃO", `não calibrado · faixa ±${mm(c.envelopeMm)} mm`];
    if (c.demo) l.push("DEMONSTRAÇÃO — TORSO SINTÉTICO");
    return l;
  }
  const l = ["ILUSTRAÇÃO — NÃO É PREVISÃO DE RESULTADO", `simulação geométrica não generativa · modelo não calibrado · faixa ±${mm(c.envelopeMm)} mm · v${c.versao}`];
  if (c.demo) l.push("DEMONSTRAÇÃO — TORSO SINTÉTICO");
  return l;
}

/** Texto da marca diagonal. */
export const TEXTO_MARCA_DIAGONAL = "ILUSTRAÇÃO · NÃO É PREVISÃO";

/** Subconjunto do CanvasRenderingContext2D usado aqui (permite testar sem navegador). */
export interface Contexto2D {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  save(): void;
  restore(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  translate(x: number, y: number): void;
  rotate(a: number): void;
}

export function tamanhoFonteSelo(largura: number): number {
  return Math.max(FONTE_MIN_PX, Math.round(largura / 52));
}

/** Quebra uma linha em pedaços que cabem em `max` px (primeiro em " · ", depois em palavras). */
export function quebrarLinha(ctx: Pick<Contexto2D, "measureText">, texto: string, max: number): string[] {
  const cabe = (t: string) => ctx.measureText(t).width <= max;
  if (cabe(texto)) return [texto];
  const pedacos = texto.split(" · ");
  const unidades: string[] = [];
  pedacos.forEach((p, i) => {
    const comSep = i < pedacos.length - 1 ? `${p} ·` : p;
    if (cabe(comSep)) unidades.push(comSep);
    else unidades.push(...comSep.split(" "));
  });
  const out: string[] = [];
  let atual = "";
  for (const u of unidades) {
    const tentativa = atual ? `${atual} ${u}` : u;
    if (!atual || cabe(tentativa)) atual = tentativa;
    else {
      out.push(atual);
      atual = u;
    }
  }
  if (atual) out.push(atual);
  return out;
}

/**
 * Desenha a marca diagonal (8 %) e a faixa do selo na parte de baixo. Devolve a altura da faixa.
 * A faixa é desenhada por último, por cima de tudo.
 */
export function desenharSelo(ctx: Contexto2D, largura: number, altura: number, linhas: readonly string[]): { alturaFaixa: number; fontePx: number } {
  const fonte = tamanhoFonteSelo(largura);
  const pad = Math.round(fonte * 0.6);
  const familia = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // marca diagonal repetida (−30°), branca a 8 %
  const fonteMarca = Math.max(12, Math.round(largura / 40));
  ctx.save();
  ctx.globalAlpha = ALFA_MARCA_DIAGONAL;
  ctx.fillStyle = COR_TEXTO_SELO;
  ctx.font = `700 ${fonteMarca}px ${familia}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.translate(largura / 2, altura / 2);
  ctx.rotate(-Math.PI / 6);
  const passoX = ctx.measureText(TEXTO_MARCA_DIAGONAL).width + fonteMarca * 3;
  const passoY = fonteMarca * 6;
  const alcance = Math.hypot(largura, altura);
  for (let y = -alcance, linha = 0; y <= alcance; y += passoY, linha++) {
    const desloc = (linha % 2) * (passoX / 2);
    for (let x = -alcance - desloc; x <= alcance; x += passoX) ctx.fillText(TEXTO_MARCA_DIAGONAL, x, y);
  }
  ctx.restore();

  // faixa inferior sólida com o texto
  ctx.save();
  ctx.font = `600 ${fonte}px ${familia}`;
  const quebradas: Array<{ t: string; forte: boolean }> = [];
  linhas.forEach((l, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${fonte}px ${familia}`;
    for (const q of quebrarLinha(ctx, l, largura - 2 * pad)) quebradas.push({ t: q, forte: i === 0 });
  });
  const entre = Math.round(fonte * 1.3);
  const alturaFaixa = Math.min(altura, quebradas.length * entre + 2 * pad - (entre - fonte));
  ctx.globalAlpha = 1;
  ctx.fillStyle = COR_FAIXA_SELO;
  ctx.fillRect(0, altura - alturaFaixa, largura, alturaFaixa);
  ctx.fillStyle = COR_TEXTO_SELO;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  quebradas.forEach((q, i) => {
    ctx.font = `${q.forte ? 700 : 500} ${fonte}px ${familia}`;
    ctx.fillText(q.t, pad, altura - alturaFaixa + pad + i * entre);
  });
  ctx.restore();
  return { alturaFaixa, fontePx: fonte };
}

/** Razão de contraste WCAG entre duas cores hex (#rrggbb). */
export function contrasteWcag(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
