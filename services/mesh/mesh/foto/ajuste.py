"""Ajuste do template parametrico a 1-3 fotos (analysis-by-synthesis por minimos quadrados robustos).

Incognitas: theta (os 24 parametros de `template.ESPEC`, com os limites do esquema 1.1) + a pose de
cada foto (R = exp(w) R0, t; 6 por foto; K fixo pela focal 35 mm equivalente). Residuos:

1. **Landmarks 2D**: reprojecao dos 10 landmarks exatos do template contra os clicados, sigma 2 px.
2. **Silhueta**: para N linhas horizontais do template (y fixo, da regiao das mamas), os dois pontos
   extremos em u da linha projetada (refinados por parabola; sao pontos do contorno aparente) sao
   consultados no campo de distancia assinada (SDF) da mascara observada; sigma 1 px. E suave nos
   parametros (ao contrario de rasterizar o template), o que permite jacobiano por diferencas finitas.
3. **Escala** (sigma 0,5 mm): `ssn_n_fita` fixa |furcula - mamilo_<lado>| 3D; `base_digitada` fixa
   |base_medial - base_lateral|; `regua_foto` fixa a distancia entre 2 cliques da foto frontal
   levados ao plano da furcula (paralelo a imagem).
4. **Prior** gaussiano fraco em theta (`template.ESPEC`: media dos presets, sigma larga).

Otimizador: `scipy.optimize.least_squares` (TRF, `soft_l1`, f_scale 3 sigmas) em tres etapas (poses so
com landmarks; conjunto sem silhueta; conjunto com silhueta), jacobiano por diferencas progressivas
agrupadas (as colunas de pose de fotos diferentes sao perturbadas juntas: cada foto so mexe nos
proprios residuos). Deterministico (sem aleatoriedade).

Incerteza: covariancia (J^T J)^-1 * max(1, chi2/gl) no otimo, propagada a ~300 pontos das pegadas das
mamas -> desvio por eixo (RMS), com piso de 4,5 mm; z sem perfil: piso 8 mm com oblíqua e 12 mm so com
a frontal ("profundidade: so ilustracao"). Volume: desvio relativo com piso 15/20/25 %.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

from mesh.foto import camera as cam
from mesh.foto import template as tpl

SIGMA_LM_PX = 2.0
SIGMA_SIL_PX = 1.0
SIGMA_ESCALA_MM = 0.5
F_SCALE = 3.0
N_LINHAS = 40
N_S = 240
MARGEM_BORDA_PX = 4.0
LIMIAR_FORA_MM = 4.0
FRACAO_FORA = 0.10
LIMIAR_REFAZER_PX = 6.0
PISO_XY_MM = 4.5
PISO_Z_MM = {"perfil": 4.5, "obliqua": 8.0, "frente": 12.0}
PISO_VOLUME_PCT = {"perfil": 15.0, "obliqua": 20.0, "frente": 25.0}
PASSO_TEMPLATE = 1e-3  # fracao da escala tipica de cada parametro no jacobiano
PASSO_ROT = 1e-5
PASSO_T = 1e-2
MAX_ITER = int(os.environ.get("MESH_FOTO_MAX_ITER", "60"))


class ErroAjuste(ValueError):
    def __init__(self, codigo: str, mensagem: str):
        super().__init__(f"{codigo}: {mensagem}")
        self.codigo = codigo
        self.mensagem = mensagem


@dataclass
class FotoAjuste:
    vista: str
    K: np.ndarray
    largura: int
    altura: int
    landmarks_2d: dict[str, np.ndarray]
    mascara: np.ndarray | None = None
    k1: float = 0.0
    sdf: np.ndarray | None = field(default=None, repr=False)

    def preparar(self) -> None:
        if self.mascara is not None and self.sdf is None:
            self.sdf = sdf_da_mascara(self.mascara)


@dataclass
class EscalaAjuste:
    metodo: str                 # "ssn_n_fita" | "base_digitada" | "regua_foto"
    valor_mm: float
    lado: str = "dir"
    pontos_px: np.ndarray | None = None


def sdf_da_mascara(mascara: np.ndarray) -> np.ndarray:
    """Distancia assinada (px) a borda da mascara: < 0 dentro, > 0 fora; borda entre centros de pixel."""
    m = np.asarray(mascara, bool)
    fora = distance_transform_edt(~m)
    dentro = distance_transform_edt(m)
    sdf = np.where(m, -(dentro - 0.5), fora - 0.5)
    return gaussian_filter(sdf, 0.8).astype(np.float32)


def amostrar(campo: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Bilinear em pixels continuos (centro do pixel i em i + 0,5)."""
    return map_coordinates(campo, [uv[..., 1] - 0.5, uv[..., 0] - 0.5], order=1, mode="nearest")


def _giro(vista: str) -> float:
    return cam.GIROS_VISTAS.get(vista, 0.0)


def _tipo_cobertura(fotos) -> str:
    vs = {f.vista for f in fotos}
    if vs & {"perfil_dir", "perfil_esq"}:
        return "perfil"
    if vs & {"obliqua_dir", "obliqua_esq"}:
        return "obliqua"
    return "frente"


@dataclass
class ResultadoAjuste:
    parametros: dict
    theta: np.ndarray
    torso: object
    landmarks_3d: dict[str, np.ndarray]
    poses: list[tuple[np.ndarray, np.ndarray]]
    residuos_px: list[dict[str, float]]
    rms_px: list[float]
    reprojecao_rms_px: float
    residuo_silhueta_mm: float
    fracao_silhueta_fora: float
    forma_fora_do_modelo: bool
    incerteza_por_eixo_mm: dict[str, float]
    incerteza_volume_pct: float
    incerteza_ajuste_mm: dict[str, float]
    qualidade: str
    avisos: list[str]
    diagnostico: dict


class Problema:
    def __init__(self, fotos: list[FotoAjuste], escala: EscalaAjuste | None):
        self.fotos = fotos
        self.escala = escala
        self.n = len(fotos)
        self.R0 = [np.eye(3)] * self.n
        self.linhas_y = np.linspace(-25.0, -300.0, N_LINHAS)
        self.com_silhueta = False
        self.so_poses = False
        self.theta_fixo = tpl.vetor_media()
        self._cache = (None, None)
        self.escalas_theta = np.array([p.escala for p in tpl.ESPEC])
        self.lo, self.hi = tpl.limites()

    # ---- empacotamento
    def x_de(self, theta, poses) -> np.ndarray:
        partes = [] if self.so_poses else [theta]
        for _R, t in poses:
            partes.append(np.zeros(3))
            partes.append(np.asarray(t, float))
        for i, (R, _) in enumerate(poses):
            self.R0[i] = np.asarray(R, float)
        return np.concatenate(partes)

    def desempacotar(self, x):
        if self.so_poses:
            theta, resto = self.theta_fixo, x
        else:
            theta, resto = x[:tpl.N_PARAMS], x[tpl.N_PARAMS:]
        poses = []
        for i in range(self.n):
            w, t = resto[6 * i:6 * i + 3], resto[6 * i + 3:6 * i + 6]
            poses.append((Rotation.from_rotvec(w).as_matrix() @ self.R0[i], t))
        return theta, poses

    def definir_linhas(self, theta) -> None:
        torso = tpl.torso_rapido(tpl.parametros_de_vetor(theta))
        y_sulco = min(torso.mama_dir.y_sulco, torso.mama_esq.y_sulco)
        self.linhas_y = np.linspace(-25.0, y_sulco - 60.0, N_LINHAS)

    # ---- residuos
    def avaliar(self, x):
        theta, poses = self.desempacotar(x)
        p = tpl.parametros_de_vetor(theta)
        torso = tpl.torso_rapido(p)
        L = tpl.landmarks_do_template(torso)
        res, dono, tipo = [], [], []
        pontos = None
        if self.com_silhueta:
            P = torso.secao.perimetro
            s = -P / 2 + (np.arange(N_S) + 0.5) * (P / N_S)
            S, Y = np.meshgrid(s, self.linhas_y)
            pontos = torso.avaliar(S, Y)
        for i, (f, (R, t)) in enumerate(zip(self.fotos, poses, strict=True)):
            ids = [k for k in f.landmarks_2d if k in L]
            if ids:
                uvp = cam.projetar(np.array([L[k] for k in ids]), f.K, R, t, f.k1)
                obs = np.array([f.landmarks_2d[k] for k in ids])
                d = ((uvp - obs) / SIGMA_LM_PX).reshape(-1)
                res.append(d)
                dono += [i] * len(d)
                tipo += ["lm"] * len(d)
            if self.com_silhueta and f.sdf is not None:
                r = self._silhueta(pontos, f, R, t)
                res.append(r / SIGMA_SIL_PX)
                dono += [i] * len(r)
                tipo += ["sil"] * len(r)
        if self.escala is not None and not self.so_poses:
            r, d = self._escala(L, poses)
            res.append(np.array([r / SIGMA_ESCALA_MM]))
            dono.append(d)
            tipo.append("escala")
        if not self.so_poses:
            res.append((theta - tpl.vetor_media()) / np.array([q.sigma for q in tpl.ESPEC]))
            dono += [-1] * tpl.N_PARAMS
            tipo += ["prior"] * tpl.N_PARAMS
        return np.concatenate(res), np.array(dono), np.array(tipo), torso, L, poses

    def _extremos(self, pontos, f, R, t):
        uv = cam.projetar(pontos, f.K, R, t, f.k1)  # (linhas, N_S, 2)
        u, v = uv[..., 0], uv[..., 1]
        out = []
        for sinal in (-1.0, 1.0):
            i0 = np.argmax(sinal * u, axis=1)
            ln = np.arange(u.shape[0])
            im, ip = (i0 - 1) % N_S, (i0 + 1) % N_S
            um, u0, up = u[ln, im], u[ln, i0], u[ln, ip]
            vm, v0, vp = v[ln, im], v[ln, i0], v[ln, ip]
            den = um - 2 * u0 + up
            with np.errstate(divide="ignore", invalid="ignore"):
                dl = np.where(np.abs(den) > 1e-12, 0.5 * (um - up) / den, 0.0)
            dl = np.clip(dl, -0.5, 0.5)
            ue = u0 + 0.5 * dl * (up - um) + 0.5 * dl * dl * den
            ve = v0 + 0.5 * dl * (vp - vm) + 0.5 * dl * dl * (vm - 2 * v0 + vp)
            out.append(np.stack([ue, ve], -1))
        return np.concatenate(out)  # (2 * linhas, 2)

    def _silhueta(self, pontos, f, R, t):
        uv = self._extremos(pontos, f, R, t)
        ok = ((uv[:, 0] > MARGEM_BORDA_PX) & (uv[:, 0] < f.largura - MARGEM_BORDA_PX)
              & (uv[:, 1] > MARGEM_BORDA_PX) & (uv[:, 1] < f.altura - MARGEM_BORDA_PX))
        r = amostrar(f.sdf, uv)
        return np.where(ok, r, 0.0)

    def _escala(self, L, poses):
        e = self.escala
        if e.metodo == "ssn_n_fita":
            return np.linalg.norm(L["mamilo_" + e.lado] - L["furcula"]) - e.valor_mm, -1
        if e.metodo == "base_digitada":
            return np.linalg.norm(L["base_lateral_" + e.lado] - L["base_medial_" + e.lado]) - e.valor_mm, -1
        if e.metodo == "regua_foto":
            i = next(k for k, f in enumerate(self.fotos) if f.vista == "frente")
            f, (R, t) = self.fotos[i], poses[i]
            zf = cam.para_camera(L["furcula"][None], R, t)[0, 2]
            q = np.column_stack([e.pontos_px, np.ones(2)]) @ np.linalg.inv(f.K).T * zf
            return np.linalg.norm(q[0] - q[1]) - e.valor_mm, i
        raise ErroAjuste("escala_ausente", f"metodo de escala desconhecido: {e.metodo}")

    def fun(self, x):
        r, dono, _, _, _, _ = self.avaliar(x)
        self._cache = (x.copy(), r, dono)
        return r

    def jac(self, x):
        if self._cache[0] is not None and np.array_equal(self._cache[0], x):
            _, r0, dono = self._cache
        else:
            r0 = self.fun(x)
            dono = self._cache[2]
        J = np.zeros((len(r0), len(x)))
        base = 0 if self.so_poses else tpl.N_PARAMS
        tarefas = []
        for j in range(base):
            h = PASSO_TEMPLATE * self.escalas_theta[j]
            if x[j] + h > self.hi[j]:
                h = -h
            xx = x.copy()
            xx[j] += h
            tarefas.append((j, None, h, xx))
        for k in range(6):
            h = PASSO_ROT if k < 3 else PASSO_T
            xx = x.copy()
            xx[base + k::6] += h
            tarefas.append((None, k, h, xx))
        rs = [self.avaliar(tr[3])[0] for tr in tarefas]
        for (j, k, h, _), r in zip(tarefas, rs, strict=True):
            dr = (r - r0) / h
            if j is not None:
                J[:, j] = dr
                continue
            for i in range(self.n):
                sel = dono == i
                J[sel, base + 6 * i + k] = dr[sel]
        return J

    def escalas_x(self):
        ex = [] if self.so_poses else [self.escalas_theta]
        for _ in range(self.n):
            ex.append(np.array([0.01, 0.01, 0.01, 5.0, 5.0, 20.0]))
        return np.concatenate(ex)

    def limites_x(self):
        lo = [] if self.so_poses else [self.lo]
        hi = [] if self.so_poses else [self.hi]
        lo.append(np.full(6 * self.n, -np.inf))
        hi.append(np.full(6 * self.n, np.inf))
        return np.concatenate(lo), np.concatenate(hi)

    def resolver(self, theta, poses, max_nfev):
        x0 = self.x_de(theta, poses)
        lo, hi = self.limites_x()
        x0 = np.clip(x0, lo + 1e-12, hi - 1e-12)
        r = least_squares(self.fun, x0, jac=self.jac, bounds=(lo, hi), method="trf", loss="soft_l1",
                          f_scale=F_SCALE, x_scale=self.escalas_x(), max_nfev=max_nfev, xtol=1e-10, ftol=1e-10)
        theta_n, poses_n = self.desempacotar(r.x)
        return (theta if self.so_poses else theta_n), poses_n, r


def pose_inicial_orbital(R_f, t_f, centro, giro_graus):
    """A paciente gira `giro` em torno do eixo y que passa por `centro` diante da camera frontal."""
    Q = Rotation.from_rotvec([0.0, np.radians(giro_graus), 0.0]).as_matrix()
    return R_f @ Q, t_f + R_f @ (centro - Q @ centro)


def validar_entrada(fotos: list[FotoAjuste]) -> int:
    frentes = [i for i, f in enumerate(fotos) if f.vista == "frente"]
    if len(frentes) != 1:
        raise ErroAjuste("landmarks_2d_incompletos", "exatamente uma foto frontal e obrigatoria")
    ff = fotos[frentes[0]]
    obrig = ("furcula", "mamilo_dir", "mamilo_esq", "linha_media_inferior")
    faltam = [k for k in obrig if k not in ff.landmarks_2d]
    if len(ff.landmarks_2d) < 6 or faltam:
        raise ErroAjuste("landmarks_2d_incompletos",
                         f"a foto frontal precisa de >= 6 landmarks incluindo {', '.join(obrig)}")
    for f in fotos:
        if f.vista != "frente" and len(f.landmarks_2d) < 1 and f.mascara is None:
            raise ErroAjuste("landmarks_2d_incompletos", f"foto {f.vista} sem landmarks e sem mascara")
    return frentes[0]


def ajustar(fotos: list[FotoAjuste], escala: EscalaAjuste | None, max_iter: int = MAX_ITER,
            theta0: np.ndarray | None = None) -> ResultadoAjuste:
    t_ini = time.perf_counter()
    i_f = validar_entrada(fotos)
    if escala is None:
        raise ErroAjuste("escala_ausente", "informe a referencia de escala (ssn_n_fita, regua_foto ou base_digitada)")
    for f in fotos:
        f.preparar()
    tempos = {}
    theta = tpl.vetor_media() if theta0 is None else np.asarray(theta0, float)
    torso = tpl.torso_rapido(tpl.parametros_de_vetor(theta))
    L = tpl.landmarks_do_template(torso)
    ff = fotos[i_f]
    ids = [k for k in ff.landmarks_2d if k in L]
    try:
        pnp = cam.resolver_pnp(np.array([L[k] for k in ids]), np.array([ff.landmarks_2d[k] for k in ids]), ff.K,
                               ff.k1, giros_graus=[0.0])
    except cam.ErroCamera as e:
        raise ErroAjuste(e.codigo, e.mensagem) from e
    etapas = []
    # etapa 1: so a frontal (template + pose) com landmarks, escala e prior: escala e disposicao
    t0 = time.perf_counter()
    pf = Problema([ff], escala)
    theta, (pose_f,), sol = pf.resolver(theta, [(pnp.R, pnp.t)], 30)
    etapas.append(("frontal_landmarks", float(sol.cost), int(sol.nfev)))
    torso = tpl.torso_rapido(tpl.parametros_de_vetor(theta))
    L = tpl.landmarks_do_template(torso)
    centro = 0.5 * (L["mamilo_dir"] + L["mamilo_esq"])
    tempos["frontal_s"] = time.perf_counter() - t0
    # etapa 2: pose de cada outra foto (template fixo) com landmarks + silhueta, a partir da orbita
    t0 = time.perf_counter()
    poses = []
    for f in fotos:
        if f is ff:
            poses.append(pose_f)
            continue
        po = Problema([f], escala)
        po.so_poses, po.com_silhueta, po.theta_fixo = True, f.sdf is not None, theta
        po.definir_linhas(theta)
        _, (pose,), sol = po.resolver(theta, [pose_inicial_orbital(*pose_f, centro, _giro(f.vista))], 40)
        etapas.append((f"pose_{f.vista}", float(sol.cost), int(sol.nfev)))
        poses.append(pose)
    tempos["poses_s"] = time.perf_counter() - t0
    # etapa 3: tudo junto, com silhueta
    t0 = time.perf_counter()
    prob = Problema(fotos, escala)
    prob.com_silhueta = True
    prob.definir_linhas(theta)
    theta, poses, sol = prob.resolver(theta, poses, max_iter)
    etapas.append(("conjunto", float(sol.cost), int(sol.nfev)))
    tempos["com_silhueta_s"] = time.perf_counter() - t0
    tempos["n_avaliacoes"] = int(sol.nfev)
    x = sol.x
    r, dono, tipo, torso, L, poses = prob.avaliar(x)
    J = prob.jac(x)
    res = _resumo(prob, x, r, dono, tipo, torso, L, poses, J, theta)
    res.diagnostico["tempos"] = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in tempos.items()}
    res.diagnostico["etapas"] = [{"etapa": e, "custo": round(c, 3), "nfev": n} for e, c, n in etapas]
    res.diagnostico["tempo_total_s"] = round(time.perf_counter() - t_ini, 2)
    res.diagnostico["otimizador"] = {"status": int(sol.status), "mensagem": str(sol.message), "nfev": int(sol.nfev),
                                     "custo": float(sol.cost)}
    return res


def _pontos_pegadas(torso, n: int = 150) -> tuple[np.ndarray, np.ndarray]:
    """(s, y) deterministicos dentro das pegadas das duas mamas."""
    ss, yy = [], []
    g = np.linspace(-1, 1, 25)
    U, V = np.meshgrid(g, g)
    for mama in torso.mamas:
        dentro = U ** 2 + V ** 2 < 0.9
        u, v = U[dentro], V[dentro]
        du = np.where(u > 0, u * mama.e_lat, u * mama.e_med)
        dv = np.where(v > 0, v * mama.e_sup, v * mama.e_inf)
        k = np.linspace(0, len(du) - 1, min(n, len(du))).astype(int)
        ss.append(mama.lado * (mama.s_mamilo + du[k]))
        yy.append(mama.y_apice + dv[k])
    return np.concatenate(ss), np.concatenate(yy)


def _incerteza(prob: Problema, theta, J, r, cobertura: str):
    n = tpl.N_PARAMS
    Jt = J[:, :]
    gl = max(1, len(r) - J.shape[1])
    s2 = max(1.0, float(r @ r) / gl)
    esc = prob.escalas_x()
    Js = Jt * esc[None, :]
    try:
        C = np.linalg.pinv(Js.T @ Js, rcond=1e-10) * s2
    except np.linalg.LinAlgError:
        C = np.eye(len(esc)) * 1e6
    C = C * esc[:, None] * esc[None, :]
    Ct = C[:n, :n]
    p = tpl.parametros_de_vetor(theta)
    torso = tpl.torso_rapido(p)
    s, y = _pontos_pegadas(torso)

    def amostra(tr):
        L = tpl.landmarks_do_template(tr)
        return tr.avaliar(s, y), np.array([L[k] for k in tpl.LANDMARKS])

    P0, L0 = amostra(torso)
    Nm = np.cross(torso.avaliar(s + 0.5, y) - torso.avaliar(s - 0.5, y),
                  torso.avaliar(s, y + 0.5) - torso.avaliar(s, y - 0.5))
    Nm /= np.linalg.norm(Nm, axis=1, keepdims=True)
    G = np.zeros((len(s), 3, n))
    GL = np.zeros((len(L0), 3, n))
    for j, e in enumerate(tpl.ESPEC):
        h = PASSO_TEMPLATE * e.escala * 10
        th = theta.copy()
        th[j] = th[j] + h if th[j] + h <= e.hi else th[j] - h
        hh = th[j] - theta[j]
        Pj, Lj = amostra(tpl.torso_rapido(tpl.parametros_de_vetor(th)))
        G[:, :, j] = (Pj - P0) / hh
        GL[:, :, j] = (Lj - L0) / hh
    # superficie: so o deslocamento normal importa (o tangencial e reparametrizacao), decomposto por eixo;
    # landmarks: o deslocamento 3D inteiro (dao a incerteza em y, p. ex. a altura do mamilo)
    Gn = np.einsum("pi,pij->pj", Nm, G)
    sig_n = np.sqrt(np.maximum(np.einsum("pj,jk,pk->p", Gn, Ct, Gn), 0.0))
    dp_sup = np.abs(Nm) * sig_n[:, None]
    dp_lm = np.sqrt(np.maximum(np.einsum("pij,jk,pik->pi", GL, Ct, GL), 0.0))
    dp = np.concatenate([dp_sup, dp_lm])
    bruto = {ax: float(np.sqrt(np.mean(dp[:, i] ** 2))) for i, ax in enumerate("xyz")}
    iv = [k for k, e in enumerate(tpl.ESPEC) if e.caminho.startswith("volume_ml")]
    vol_pct = max(float(np.sqrt(max(Ct[k, k], 0.0)) / max(theta[k], 1.0) * 100) for k in iv)
    final = {"x": max(PISO_XY_MM, bruto["x"]), "y": max(PISO_XY_MM, bruto["y"]),
             "z": max(PISO_Z_MM[cobertura], bruto["z"])}
    return ({k: round(v, 2) for k, v in final.items()}, round(max(PISO_VOLUME_PCT[cobertura], vol_pct), 1),
            {k: round(v, 3) for k, v in bruto.items()}, round(vol_pct, 2))


def _resumo(prob, x, r, dono, tipo, torso, L, poses, J, theta) -> ResultadoAjuste:
    fotos = prob.fotos
    residuos_px, rms_px, todos = [], [], []
    sil_mm = []
    for i, (f, (R, t)) in enumerate(zip(fotos, poses, strict=True)):
        ids = [k for k in f.landmarks_2d if k in L]
        d = {}
        if ids:
            uvp = cam.projetar(np.array([L[k] for k in ids]), f.K, R, t, f.k1)
            e = np.linalg.norm(uvp - np.array([f.landmarks_2d[k] for k in ids]), axis=1)
            d = {k: round(float(v), 3) for k, v in zip(ids, e, strict=True)}
            todos += list(e)
        residuos_px.append(d)
        rms_px.append(round(float(np.sqrt(np.mean(np.square(list(d.values()))))) if d else 0.0, 3))
        if f.sdf is not None:
            sel = (dono == i) & (tipo == "sil")
            rs = r[sel] * SIGMA_SIL_PX
            valid = rs != 0.0
            z = float(cam.para_camera(np.array([L["mamilo_dir"], L["mamilo_esq"]]), R, t)[:, 2].mean())
            sil_mm += list(rs[valid] * z / f.K[0, 0])
    rms = float(np.sqrt(np.mean(np.square(todos)))) if todos else 0.0
    sil = np.abs(np.array(sil_mm)) if sil_mm else np.zeros(0)
    residuo_sil = float(np.sqrt(np.mean(sil ** 2))) if len(sil) else 0.0
    fracao_fora = float(np.mean(sil > LIMIAR_FORA_MM)) if len(sil) else 0.0
    fora = fracao_fora > FRACAO_FORA
    cobertura = _tipo_cobertura(fotos)
    inc, inc_vol, bruto, vol_bruto = _incerteza(prob, theta, J, r, cobertura)
    avisos = []
    if cobertura == "frente":
        avisos.append("sem_perfil:profundidade_so_ilustracao")
    elif cobertura == "obliqua":
        avisos.append("sem_perfil:profundidade_estimada_pela_obliqua")
    if fora:
        avisos.append("forma_fora_do_modelo")
    for f, d in zip(fotos, residuos_px, strict=True):
        if not d:
            continue
        vals = np.array(list(d.values()))
        for k, v in d.items():
            outros = vals[vals != v]
            if v > LIMIAR_REFAZER_PX and (len(outros) == 0 or v > 2.0 * np.median(outros)):
                avisos.append(f"refazer_ponto:{f.vista}:{k}")
    if rms <= 3.0 and residuo_sil <= 2.0 and not fora:
        qualidade = "boa"
    elif rms <= 6.0 and residuo_sil <= 4.0:
        qualidade = "regular"
    else:
        qualidade = "ruim"
    lo, hi = tpl.limites()
    no_limite = [e.caminho for e, v, a, b in zip(tpl.ESPEC, theta, lo, hi, strict=True)
                 if min(v - a, b - v) < 1e-6 * (b - a)]
    p = tpl.parametros_de_vetor(theta)
    return ResultadoAjuste(
        parametros=p, theta=theta, torso=torso, landmarks_3d=L, poses=poses, residuos_px=residuos_px, rms_px=rms_px,
        reprojecao_rms_px=round(rms, 3), residuo_silhueta_mm=round(residuo_sil, 3),
        fracao_silhueta_fora=round(fracao_fora, 4), forma_fora_do_modelo=bool(fora),
        incerteza_por_eixo_mm=inc, incerteza_volume_pct=inc_vol, incerteza_ajuste_mm=bruto, qualidade=qualidade,
        avisos=avisos, diagnostico={"parametros_no_limite": no_limite, "incerteza_volume_ajuste_pct": vol_bruto,
                                    "cobertura_vistas": cobertura, "n_residuos": int(len(r))})
