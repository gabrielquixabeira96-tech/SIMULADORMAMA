import type { AvaliacaoReconstrucao, IncertezaPorEixo, Reconstrucao, VistaFoto } from "@simulador/contratos";
import { AVISO_FORMA_FORA_DO_MODELO } from "@simulador/contratos";

/**
 * O que o navegador recebe de uma malha reconstruída de fotos (`GET /api/malhas/<id>/foto-real`),
 * derivado do C1 (`reconstrucao.json` ou `asset.extras` do `processada.glb`). Módulo puro (cliente
 * e servidor).
 *
 * Desenho A/B (ADR 0005): as câmeras (K, R, t) são parâmetros de desenho e vão nos dois; o halo
 * (`halo_mm` = max(envelope; incerteza em z)) também — é a incerteza, sempre visível. Os NÚMEROS
 * da reconstrução (incerteza por eixo em mm, volume %, cobertura, reprojeção) e o erro contra o
 * gabarito só saem em B (`medicao_automatica_3d`); em A o cartão de incerteza é qualitativo.
 */

export const ESQUEMA_FOTO_REAL = "foto_real/1.0" as const;

export interface CameraFotoPublica {
  vista: VistaFoto;
  /** caminho relativo à pasta da malha (lista fixa: original/foto_<vista>.jpg|png) */
  arquivo: string;
  largura_px: number;
  altura_px: number;
  K: number[];
  R: number[];
  t: [number, number, number];
}

export interface NumerosReconstrucao {
  incerteza_por_eixo_mm: IncertezaPorEixo;
  incerteza_volume_pct: number | null;
  cobertura_observada_pct: number | null;
  reprojecao_rms_px: number | null;
  residuo_silhueta_mm: number | null;
}

export interface ErroGabarito {
  rms_mm: IncertezaPorEixo;
  volume_erro_pct: number | { dir: number; esq: number };
  landmarks_erro_mm: { medio: number; max: number } | null;
  reprojecao_rms_px: number | null;
}

export interface FotoRealPublica {
  esquema: typeof ESQUEMA_FOTO_REAL;
  n_fotos: number;
  fotos: CameraFotoPublica[];
  /** largura do halo (mm): max(envelope do modelo; incerteza da reconstrução em z) */
  halo_mm: number;
  /** sem foto de perfil a profundidade é o prior do template: só ilustração (e `previsto` nulo) */
  profundidade_so_ilustracao: boolean;
  forma_fora_do_modelo: boolean;
  qualidade: "boa" | "regular" | "ruim";
  /** a pasta tem `observado.png` (C3) — a hachura do não observado */
  observado: boolean;
  /** só em B */
  numeros: NumerosReconstrucao | null;
  /** erro contra o gabarito (torso sintético), só em B */
  erro_gabarito: ErroGabarito | null;
  /** método da referência de escala (C1 `escala.metodo`; sem o valor): o texto da UI explica como medir */
  escala_metodo: string | null;
  avisos: string[];
}

export const temPerfil = (r: Pick<Reconstrucao, "fotos">): boolean => r.fotos.some((f) => f.vista === "perfil_dir" || f.vista === "perfil_esq");

export function fotoRealPublica(
  r: Reconstrucao,
  o: { envelopeMm: number; numerosPermitidos: boolean; observado: boolean; avaliacao?: AvaliacaoReconstrucao | null },
): FotoRealPublica {
  const reprojecao = r.reprojecao_rms_px ?? (r.fotos.every((f) => typeof f.rms_px === "number") ? Math.sqrt(r.fotos.reduce((s, f) => s + f.rms_px! ** 2, 0) / r.fotos.length) : null);
  const av = o.avaliacao ?? null;
  return {
    esquema: ESQUEMA_FOTO_REAL,
    n_fotos: r.fotos.length,
    fotos: r.fotos.map((f) => ({ vista: f.vista, arquivo: f.arquivo, largura_px: f.largura_px, altura_px: f.altura_px, K: [...f.K], R: [...f.R], t: [f.t[0], f.t[1], f.t[2]] })),
    halo_mm: Math.max(o.envelopeMm, r.incerteza_por_eixo_mm.z),
    profundidade_so_ilustracao: !temPerfil(r),
    forma_fora_do_modelo: r.forma_fora_do_modelo === true || r.avisos.includes(AVISO_FORMA_FORA_DO_MODELO),
    qualidade: r.qualidade,
    observado: o.observado,
    numeros: o.numerosPermitidos
      ? {
          incerteza_por_eixo_mm: { ...r.incerteza_por_eixo_mm },
          incerteza_volume_pct: r.incerteza_volume_pct ?? null,
          cobertura_observada_pct: r.cobertura_observada_pct ?? null,
          reprojecao_rms_px: reprojecao,
          residuo_silhueta_mm: r.residuo_silhueta_mm ?? null,
        }
      : null,
    erro_gabarito:
      o.numerosPermitidos && av
        ? {
            rms_mm: { ...av.rms_mm },
            volume_erro_pct: typeof av.volume_erro_pct === "number" ? av.volume_erro_pct : { ...av.volume_erro_pct },
            landmarks_erro_mm: av.landmarks_erro_mm ? { medio: av.landmarks_erro_mm.medio, max: av.landmarks_erro_mm.max } : null,
            reprojecao_rms_px: av.reprojecao_rms_px ?? null,
          }
        : null,
    escala_metodo: typeof r.escala?.metodo === "string" ? r.escala.metodo : null,
    avisos: [...r.avisos],
  };
}

/**
 * Como a escala foi fixada, em linguagem do consultório (sem números; vale em A e B). A fita SSN–N
 * entra no ajuste como distância EUCLIDIANA (reta) fúrcula–mamilo: medida esticada em linha reta,
 * não acompanhando a curva da pele (ADR 0021).
 */
export function textoEscala(metodo: string | null): string | null {
  switch (metodo) {
    case "ssn_n_fita":
      return "Escala pela distância fúrcula–mamilo (SSN–N) medida com a fita esticada em linha reta — não acompanhando a curva da pele.";
    case "regua_foto":
      return "Escala pela régua fotografada junto do tórax, no plano da fúrcula.";
    case "base_digitada":
      return "Escala pela largura da base digitada (a referência menos precisa).";
    default:
      return null;
  }
}

const mm1 = (v: number) => v.toFixed(1).replace(".", ",");
/** % inteiro com sinal; o que arredonda para 0 sai "0 %" (nunca "−0 %"). */
const pct0 = (v: number) => {
  const r = Math.sign(v) * Math.round(Math.abs(v)); // meio para longe do zero, como toFixed
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} %`;
};

/** Linhas do cartão "Incerteza por eixo" (B com números; A qualitativo, sem nenhum dígito). */
export function linhasIncerteza(f: FotoRealPublica): string[] {
  const n = f.numeros;
  const prof = f.profundidade_so_ilustracao ? " — só ilustração (sem foto de perfil)" : "";
  if (!n) {
    return [
      "Largura e altura (no plano da foto): incerteza menor",
      `Profundidade (projeção da mama): incerteza maior${prof}`,
      "Volume: incerteza grande",
    ];
  }
  const e = n.incerteza_por_eixo_mm;
  const l = [`Largura ±${mm1(e.x)} mm · altura ±${mm1(e.y)} mm`, `Profundidade ±${mm1(e.z)} mm${prof}`];
  if (n.incerteza_volume_pct !== null) l.push(`Volume ±${n.incerteza_volume_pct.toFixed(0)} %`);
  return l;
}

/** Linhas do cartão "Erro contra o gabarito" (só B; torso sintético). */
export function linhasErroGabarito(e: ErroGabarito): string[] {
  const v = e.volume_erro_pct;
  const l = [
    `RMS na região das mamas: x ${mm1(e.rms_mm.x)} mm · y ${mm1(e.rms_mm.y)} mm · z ${mm1(e.rms_mm.z)} mm`,
    `Volume: ${typeof v === "number" ? pct0(v) : `${pct0(v.dir)} D / ${pct0(v.esq)} E`}`,
  ];
  if (e.landmarks_erro_mm) l.push(`Pontos anatômicos: médio ${mm1(e.landmarks_erro_mm.medio)} mm · máximo ${mm1(e.landmarks_erro_mm.max)} mm`);
  if (e.reprojecao_rms_px !== null) l.push(`Reprojeção: ${mm1(e.reprojecao_rms_px)} px`);
  return l;
}
