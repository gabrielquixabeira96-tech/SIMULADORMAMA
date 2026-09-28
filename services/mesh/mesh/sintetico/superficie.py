"""Superficie analitica do torso sintetico parametrico (contratos §4; Marco 0).

Tudo em mm, quadro anatomico (origem na furcula; +Y cranial, +Z anterior, +X esquerda da paciente).
A superficie e uma funcao fechada S(s, y) de dois parametros, avaliada exatamente tanto nos nos da
malha densa quanto nos landmarks — por isso os landmarks e o volume "verdadeiros" sao conhecidos.

Construcao
----------
1. **Parede toracica** W(s, y): tubo vertical cuja secao e uma superelipse
   |x/a|^q + |z/b|^q = 1 (a = largura/2, b = profundidade/2, q = 3: face anterior achatada, flancos
   arredondados), transladada para que o ponto anterior da linha media fique em z = 0.
   `s` e o comprimento de arco da secao a partir da linha media anterior (s > 0 para +X, lado
   esquerdo da paciente), de modo que as medidas da mama em (s, y) sao milimetros sobre a pele.
   Abaixo de y_afil = min(-300, sulco mais baixo - 30) a secao afina ate 90 % (cintura), suave (C1).
2. **Incisura jugular (furcula)**: depressao gaussiana (5 mm; sigma 14 x 10 mm) na linha media em
   y = 0; o fundo dela e a furcula e, apos a translacao final, a origem exata.
3. **Mamas**: deslocamento ao longo da normal externa da parede, h(s, y) = H * (1 - rho^2)^p(phi)
   dentro de uma "pegada" (base) com semieixos diferentes em cada quadrante (medial, lateral,
   superior, inferior), mais um relevo de mamilo gaussiano (2,5 mm; sigma 6 mm). p = 1 no polo
   inferior (angulo nitido = sulco inframamario), 2,2 no polo superior (transicao suave), 1,6 nos
   lados. A amplitude H e resolvida numericamente para que o volume adicionado seja o pedido.
4. **Topo**: a superficie continua 25 mm acima da furcula (base do pescoco/colar), para que a
   furcula seja um ponto interior; a base fica em y = -altura_torso_mm.

Semantica dos parametros (interpretacao documentada; ver README do servico)
--------------------------------------------------------------------------
- largura_toracica_mm: largura da parede (2a) — a caixa envolvente em X e exatamente essa largura.
- volume_ml: volume adicionado sobre a parede, por lado (verdade do gabarito).
- base (largura da pegada, em arco) = 17,5 * V^(1/3) mm (300 mL -> 117 mm); 45 % medial, 55 % lateral
  do mamilo; borda medial a 10 % da largura toracica da linha media.
- Altura do mamilo: y_n = -(165 + 60 * ptose) mm (+ delta_altura_mamilo_mm no lado esquerdo).
- n_imf_mm: distancia vertical (em Y) entre mamilo e sulco — o sulco fica em y_n - n_imf.
- ptose in [0, 1]: abaixa o mamilo (acima) e desloca o apice (ponto de projecao maxima) 0,3 * ptose
  * n_imf acima do mamilo, de modo que o mamilo passa a apontar para baixo no polo inferior. Como a
  superficie e um campo de altura sobre a parede (como um scan real, que nao ve sob a prega), nao ha
  "mamilo abaixo do sulco" literal: ptose = 1 e a maxima queda representavel.
- assimetria.delta_lateral_mamilo_mm: desloca a mama esquerda inteira lateralmente (em arco).

Fatores de forma (`torso_parametros/1.1`; contrato C2 do plano da reconstrucao por fotos)
-------------------------------------------------------------------------------------------
Opcionais; **ausentes = comportamento de hoje, byte a byte** (os valores padrao entram so como
multiplicacao por 1,0 ou soma de 0,0, que sao exatas em ponto flutuante; a parede so troca de ramo
quando `achatamento_anterior != 0`). Servem ao ajuste do template a fotos (mesh/foto/ajuste.py).
- `forma.<lado>.base_fator` (1,0): multiplica a largura da base (e_med e e_lat; o mamilo acompanha a
  borda medial como hoje).
- `forma.<lado>.largura_pegada_fator` (1,0): multiplica so a extensao lateral da pegada (e_lat).
- `forma.<lado>.polo_superior_fator` (1,0): multiplica a altura da pegada acima do apice (e_sup).
- `forma.<lado>.polo_inferior_fator` (1,0): multiplica o termo angular do expoente no polo inferior
  (p = 1,6 + 0,6 * fator * sen(phi) para sen < 0): > 1 polo inferior mais cheio e prega mais nitida.
- `forma.<lado>.apice_fator` (0,0): soma ao deslocamento do apice acima do mamilo, em fracao de
  n_imf (d_p = (0,3 * ptose + apice_fator) * n_imf).
- `forma.<lado>.projecao_fator` (1,0): multiplica o expoente do perfil inteiro (> 1: volume mais
  concentrado no apice, mais projecao para o mesmo volume).
- `parede.expoente_secao` (3,0): expoente q da superelipse da secao.
- `parede.achatamento_anterior` (0,0): na metade anterior da secao o expoente vira q * (1 + a)
  (a > 0: face anterior mais plana; a < 0: mais redonda). Continua C1 nos flancos.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EXPOENTE_SECAO = 3.0
FORMA_PADRAO = {"base_fator": 1.0, "apice_fator": 0.0, "polo_superior_fator": 1.0, "polo_inferior_fator": 1.0,
                "largura_pegada_fator": 1.0, "projecao_fator": 1.0}
PAREDE_PADRAO = {"expoente_secao": EXPOENTE_SECAO, "achatamento_anterior": 0.0}
TOPO_ACIMA_FURCULA_MM = 25.0
INCISURA_PROF_MM = 5.0
INCISURA_SIGMA_X_MM = 14.0
INCISURA_SIGMA_Y_MM = 10.0
MAMILO_AMP_MM = 2.5
MAMILO_SIGMA_MM = 6.0
AFINAMENTO = 0.10
AFINAMENTO_FAIXA_MM = 150.0


def _smooth(t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    t = np.clip(t, 0.0, 1.0)
    return 3 * t**2 - 2 * t**3, 6 * t - 6 * t**2


class Secao:
    """Secao superelipse parametrizada por comprimento de arco s (tabela fina + interpolacao)."""

    def __init__(self, a: float, b: float, q: float = EXPOENTE_SECAO, amostras: int = 400001,
                 achatamento: float = 0.0):
        th = np.linspace(-np.pi, np.pi, amostras)
        st, ct = np.sin(th), np.cos(th)
        if achatamento == 0.0:
            x = a * np.sign(st) * np.abs(st) ** (2.0 / q)
            z = b * np.sign(ct) * np.abs(ct) ** (2.0 / q) - b
        else:  # metade anterior (cos > 0) com expoente q (1 + a); x = +-a, z = -b nos flancos nos dois ramos
            e = np.where(ct > 0, 2.0 / (q * (1.0 + achatamento)), 2.0 / q)
            x = a * np.sign(st) * np.abs(st) ** e
            z = b * np.sign(ct) * np.abs(ct) ** e - b
        ds = np.hypot(np.diff(x), np.diff(z))
        s = np.concatenate([[0.0], np.cumsum(ds)])
        s -= np.interp(0.0, th, s)  # s = 0 na linha media anterior (theta = 0)
        self.perimetro = float(s[-1] - s[0])
        self.s, self.x, self.z = s, x, z
        tx = np.gradient(x, s)
        tz = np.gradient(z, s)
        n = np.hypot(tx, tz)
        self.tx, self.tz = tx / n, tz / n

    def avaliar(self, s: np.ndarray):
        s = np.asarray(s, dtype=np.float64)
        meio = self.perimetro / 2
        s = (s + meio) % self.perimetro - meio  # periodico
        return (np.interp(s, self.s, self.x), np.interp(s, self.s, self.z),
                np.interp(s, self.s, self.tx), np.interp(s, self.s, self.tz))


@dataclass
class Mama:
    lado: int            # +1 esquerda da paciente (+X), -1 direita
    volume_ml: float
    base_mm: float       # largura da pegada (arco)
    s_mamilo: float      # arco do mamilo (positivo, a partir da linha media)
    y_mamilo: float
    y_apice: float
    e_lat: float
    e_med: float
    e_sup: float
    e_inf: float
    amp_mamilo: float
    H: float = 0.0       # amplitude resolvida (mm)
    fator_inf: float = 1.0   # forma.polo_inferior_fator
    fator_proj: float = 1.0  # forma.projecao_fator

    @property
    def y_sulco(self) -> float:
        return self.y_apice - self.e_inf

    def forma(self, s: np.ndarray, y: np.ndarray) -> np.ndarray:
        """Perfil normalizado f(s,y) in [0,1] (sem amplitude, sem mamilo)."""
        du = self.lado * s - self.s_mamilo
        dv = y - self.y_apice
        A = np.where(du > 0, self.e_lat, self.e_med)
        B = np.where(dv > 0, self.e_sup, self.e_inf)
        un, vn = du / A, dv / B
        r2 = un**2 + vn**2
        dentro = r2 < 1.0
        r = np.sqrt(np.maximum(r2, 1e-30))
        sen = np.where(r2 > 1e-24, vn / r, 0.0)
        # com os fatores padrao (1,0) as multiplicacoes sao exatas: p = 1,6 + 0,6 sen, como na v1.0
        p = self.fator_proj * (1.6 + np.where(sen < 0, 0.6 * self.fator_inf, 0.6) * sen)
        return np.where(dentro, np.power(np.clip(1.0 - r2, 0.0, 1.0), p), 0.0)

    def relevo_mamilo(self, s: np.ndarray, y: np.ndarray) -> np.ndarray:
        du = self.lado * s - self.s_mamilo
        dv = y - self.y_mamilo
        return self.amp_mamilo * np.exp(-(du**2 + dv**2) / (2 * MAMILO_SIGMA_MM**2))

    def altura(self, s: np.ndarray, y: np.ndarray, H: float | None = None) -> np.ndarray:
        H = self.H if H is None else H
        return H * self.forma(s, y) + self.relevo_mamilo(s, y)

    # parametros (s, y) dos landmarks deste lado --------------------------------------------------
    def param_mamilo(self) -> tuple[float, float]:
        return self.lado * self.s_mamilo, self.y_mamilo

    def param_sulco(self) -> tuple[float, float]:
        return self.lado * self.s_mamilo, self.y_sulco

    def _du_borda_na_altura_do_mamilo(self, extensao: float) -> float:
        vn = (self.y_mamilo - self.y_apice) / self.e_inf
        return extensao * float(np.sqrt(max(0.0, 1.0 - vn**2)))

    def param_base_medial(self) -> tuple[float, float]:
        du = -self._du_borda_na_altura_do_mamilo(self.e_med)
        return self.lado * (self.s_mamilo + du), self.y_mamilo

    def param_base_lateral(self) -> tuple[float, float]:
        du = self._du_borda_na_altura_do_mamilo(self.e_lat)
        return self.lado * (self.s_mamilo + du), self.y_mamilo


def forma_lado(p: dict, chave: str) -> dict:
    """Fatores de forma de um lado (torso_parametros/1.1), completados com os padroes."""
    f = dict(FORMA_PADRAO)
    f.update(((p.get("forma") or {}).get(chave) or {}))
    return {k: float(v) for k, v in f.items()}


def parede_parametros(p: dict) -> dict:
    f = dict(PAREDE_PADRAO)
    f.update(p.get("parede") or {})
    return {k: float(v) for k, v in f.items()}


def criar_mama(lado: int, p: dict) -> Mama:
    chave = "esq" if lado > 0 else "dir"
    fo = forma_lado(p, chave)
    V = float(p["volume_ml"][chave])
    ptose = float(p["ptose"][chave])
    n_imf = float(p["n_imf_mm"][chave])
    W = float(p["largura_toracica_mm"])
    assim = p.get("assimetria", {})
    d_alt = float(assim.get("delta_altura_mamilo_mm", 0.0)) if lado > 0 else 0.0
    d_lat = float(assim.get("delta_lateral_mamilo_mm", 0.0)) if lado > 0 else 0.0
    base = (max(17.5 * V ** (1.0 / 3.0), 60.0) if V > 0 else 60.0) * fo["base_fator"]
    e_med, e_lat = 0.45 * base, 0.55 * base * fo["largura_pegada_fator"]
    s_n = 0.10 * W + e_med + d_lat
    y_n = -(165.0 + 60.0 * ptose) + d_alt
    U = 0.55 * base + 20.0 * ptose
    d_p = (0.3 * ptose + fo["apice_fator"]) * n_imf
    return Mama(lado=lado, volume_ml=V, base_mm=base, s_mamilo=s_n, y_mamilo=y_n, y_apice=y_n + d_p,
                e_lat=e_lat, e_med=e_med, e_sup=max(U - d_p, 15.0) * fo["polo_superior_fator"],
                e_inf=n_imf + d_p, amp_mamilo=MAMILO_AMP_MM if V >= 5.0 else 0.0,
                fator_inf=fo["polo_inferior_fator"], fator_proj=fo["projecao_fator"])


class Torso:
    """S(s, y) = W(s, y) + (h_dir + h_esq + incisura) * n_W(s, y) + (0, 0, INCISURA_PROF_MM)."""

    def __init__(self, parametros: dict, amostras_secao: int = 400001):
        self.p = parametros
        self.largura = float(parametros["largura_toracica_mm"])
        self.profundidade = float(parametros.get("profundidade_toracica_mm", 200))
        self.altura = float(parametros.get("altura_torso_mm", 450))
        pa = parede_parametros(parametros)
        self.secao = Secao(self.largura / 2, self.profundidade / 2, pa["expoente_secao"], amostras_secao,
                           pa["achatamento_anterior"])
        self.mama_dir = criar_mama(-1, parametros)
        self.mama_esq = criar_mama(+1, parametros)
        sulco_min = min(self.mama_dir.y_sulco, self.mama_esq.y_sulco)
        self.y_afil = min(-300.0, sulco_min - 30.0)
        self.y_topo = TOPO_ACIMA_FURCULA_MM
        self.y_base = -self.altura

    @property
    def mamas(self) -> tuple[Mama, Mama]:
        return self.mama_dir, self.mama_esq

    def _escala(self, y: np.ndarray):
        t = (self.y_afil - y) / AFINAMENTO_FAIXA_MM
        sm, dsm = _smooth(t)
        k = 1.0 - AFINAMENTO * sm
        dk = AFINAMENTO * dsm / AFINAMENTO_FAIXA_MM * ((t > 0) & (t < 1))
        return k, dk

    def parede(self, s: np.ndarray, y: np.ndarray):
        """Ponto e normal externa unitaria da parede (sem mama, sem incisura)."""
        s = np.asarray(s, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        x, z, tx, tz = self.secao.avaliar(s)
        k, dk = self._escala(y)
        P = np.stack([k * x, y, k * z], axis=-1)
        ds = np.stack([k * tx, np.zeros_like(y), k * tz], axis=-1)
        dy = np.stack([dk * x, np.ones_like(y), dk * z], axis=-1)
        n = np.cross(ds, dy)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        return P, n

    def incisura(self, s: np.ndarray, y: np.ndarray) -> np.ndarray:
        return -INCISURA_PROF_MM * np.exp(-(s**2) / (2 * INCISURA_SIGMA_X_MM**2)
                                          - (y**2) / (2 * INCISURA_SIGMA_Y_MM**2))

    def avaliar(self, s, y, H_dir: float | None = None, H_esq: float | None = None,
                sem: str | None = None) -> np.ndarray:
        """Ponto da superficie final. `sem='dir'|'esq'` omite aquela mama (para medir volume)."""
        s = np.asarray(s, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        P, n = self.parede(s, y)
        h = self.incisura(s, y)
        if sem != "dir":
            h = h + self.mama_dir.altura(s, y, H_dir)
        if sem != "esq":
            h = h + self.mama_esq.altura(s, y, H_esq)
        out = P + h[..., None] * n
        out[..., 2] += INCISURA_PROF_MM
        return out

    def ponto(self, s: float, y: float) -> np.ndarray:
        return self.avaliar(np.array([s]), np.array([y]))[0]
