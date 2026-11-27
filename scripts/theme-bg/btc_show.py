#!/usr/bin/env python3
"""Живые обои «Биткоин-шоу» для темы «Оранжевая».

Знак ₿ в центре — один неподвижный слой, одинаковый во всех кадрах: литой
металлический знак без круга-монеты (Дима 27.11: «не нравится, что она в круге»).
Вокруг по очереди сменяются эффекты (вихрь, салют, молнии, график, пульс,
протуберанцы, монетный дождь, блокчейн-сеть, хэш-дождь, пламя), соседние сцены
плавно перетекают. Гиперпрыжок и орбиты убраны 27.11 — не понравились.

Кадр — чистая функция времени: рендер идёт параллельно, а длина ролика кратна
периоду фона, поэтому последний кадр стыкуется с первым без шва.

  python3 btc_show.py --size 1920x1080 --out ember-show.mp4
  python3 btc_show.py --size 1080x1920 --out ember-show-tall.mp4
  python3 btc_show.py --size 1920x1080 --sheet 3,16,29 --out sheet.jpg   # контрольные кадры
  --font <путь к ttf с ₿> — на Windows (по умолчанию SF Pro мака)
"""
import argparse
import math
import os
import subprocess
import sys
from multiprocessing import Pool

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 24
SLOT = 13.0  # длительность сцены без перехода, с
XF = 2.5  # перекрытие соседних сцен, с
FONT = os.environ.get("BTC_SHOW_FONT", "/System/Library/Fonts/SFNS.ttf")

ORANGE = np.array([1.0, 0.42, 0.08], np.float32)
GOLD = np.array([1.0, 0.62, 0.20], np.float32)
HOT = np.array([1.0, 0.80, 0.52], np.float32)
RED = np.array([1.0, 0.24, 0.04], np.float32)
EMBER = np.array([0.85, 0.16, 0.02], np.float32)
WHITE = np.array([1.0, 0.94, 0.84], np.float32)


def smooth(e0, e1, x):
    t = np.clip((np.asarray(x, np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hash01(a):
    return np.abs(np.modf(np.sin(np.asarray(a, np.float64) * 12.9898 + 78.233) * 43758.5453)[0])


class Ctx:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.cx, self.cy = W / 2.0, H / 2.0
        m = min(W, H)
        self.s = m / 1080.0
        self.R = 0.21 * m
        self.Rmax = math.hypot(W, H) / 2.0
        # растяжка вдоль длинной стороны кадра: сеть и орбиты занимают весь экран
        self.ex = math.sqrt(W / m)
        self.ey = math.sqrt(H / m)


def glyph_mask(ctx):
    """Маска знака ₿ (0..1) во весь кадр; считается один раз на процесс."""
    if getattr(ctx, "_glyph", None) is not None:
        return ctx._glyph
    W, H, R = ctx.W, ctx.H, ctx.R
    ss = 4
    font = ImageFont.truetype(FONT, int(R * 1.95 * ss))
    try:
        font.set_variation_by_name(b"Bold")
    except Exception:
        pass  # шрифт без осей (Segoe UI Bold на Windows) — уже жирный
    box = font.getbbox("₿")
    gw, gh = box[2] - box[0], box[3] - box[1]
    img = Image.new("L", (W * ss, H * ss), 0)
    ImageDraw.Draw(img).text((ctx.cx * ss - gw / 2 - box[0], ctx.cy * ss - gh / 2 - box[1]), "₿", font=font, fill=255)
    img = img.rotate(-12, resample=Image.BICUBIC, center=(ctx.cx * ss, ctx.cy * ss))
    ctx._glyph = np.asarray(img.resize((W, H), Image.LANCZOS), np.float32) / 255.0
    return ctx._glyph


def glyph_contours(ctx):
    """Контуры знака: список (точки Nx2, наружные нормали Nx2) — по ним бегут разряды."""
    if getattr(ctx, "_contours", None) is not None:
        return ctx._contours
    m8 = (glyph_mask(ctx) > 0.5).astype(np.uint8)
    cs, _ = cv2.findContours(m8, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        P = c[:, 0, :].astype(np.float64)
        if len(P) < 60:
            continue
        d = np.roll(P, -3, 0) - np.roll(P, 3, 0)
        n = np.stack([d[:, 1], -d[:, 0]], 1)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        # нормаль должна смотреть из знака наружу: проверяем по маске
        probe = np.clip(np.round(P + n * 4), 0, [ctx.W - 1, ctx.H - 1]).astype(np.int64)
        if m8[probe[:, 1], probe[:, 0]].mean() > 0.5:
            n = -n
        out.append((P, n))
    ctx._contours = out
    return out


class Canvas:
    """Собирает всё, что нарисовано за кадр, и разом раскладывает в буфер энергии."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.px, self.py, self.pc = [], [], []
        self.gx, self.gy, self.gc = [], [], []
        self.fields = []

    @staticmethod
    def _colors(w, col):
        col = np.asarray(col, np.float32)
        w = np.asarray(w, np.float32)
        return w[:, None] * (col[None, :] if col.ndim == 1 else col)

    def pts(self, x, y, w, col):
        x = np.asarray(x, np.float32).ravel()
        y = np.asarray(y, np.float32).ravel()
        w = np.broadcast_to(np.asarray(w, np.float32), x.shape).ravel()
        col = np.asarray(col, np.float32)
        if col.ndim == 2:
            col = col.reshape(-1, 3)
        self.px.append(x)
        self.py.append(y)
        self.pc.append(self._colors(w, col))

    def glow(self, x, y, w, col):
        x = np.atleast_1d(np.asarray(x, np.float32))
        y = np.atleast_1d(np.asarray(y, np.float32))
        w = np.broadcast_to(np.asarray(w, np.float32), x.shape)
        self.gx.append(x)
        self.gy.append(y)
        self.gc.append(self._colors(w, col))

    def segs(self, x0, y0, x1, y1, w, col, step=0.75):
        """Отрезки; w — энергия на пиксель длины (скаляр или по отрезку)."""
        x0 = np.asarray(x0, np.float32).ravel()
        y0 = np.asarray(y0, np.float32).ravel()
        x1 = np.asarray(x1, np.float32).ravel()
        y1 = np.asarray(y1, np.float32).ravel()
        if x0.size == 0:
            return
        w = np.broadcast_to(np.asarray(w, np.float32), x0.shape).ravel()
        col = np.asarray(col, np.float32)
        L = np.hypot(x1 - x0, y1 - y0)
        n = np.maximum(1, np.ceil(L / step)).astype(np.int64)
        n = np.minimum(n, 4000)
        idx = np.repeat(np.arange(x0.size), n)
        start = np.cumsum(n) - n
        k = np.arange(n.sum()) - start[idx]
        f = ((k + 0.5) / n[idx]).astype(np.float32)
        x = x0[idx] + (x1 - x0)[idx] * f
        y = y0[idx] + (y1 - y0)[idx] * f
        wp = (w * np.maximum(L, 0.5) / n)[idx]
        c = col if col.ndim == 1 else col.reshape(-1, 3)[idx]
        self.pts(x, y, wp, c)

    def poly(self, P, w, col, step=0.75):
        P = np.asarray(P, np.float32)
        if len(P) < 2:
            return
        w = np.asarray(w, np.float32)
        if w.ndim and w.size == len(P):
            w = 0.5 * (w[:-1] + w[1:])
        self.segs(P[:-1, 0], P[:-1, 1], P[1:, 0], P[1:, 1], w, col, step)

    def field(self, F):
        self.fields.append(F)

    @staticmethod
    def _splat(W, H, x, y, c):
        x0 = np.floor(x)
        y0 = np.floor(y)
        fx = (x - x0).astype(np.float32)
        fy = (y - y0).astype(np.float32)
        x0 = x0.astype(np.int64)
        y0 = y0.astype(np.int64)
        m = (x0 >= 0) & (y0 >= 0) & (x0 < W - 1) & (y0 < H - 1)
        x0, y0, fx, fy, c = x0[m], y0[m], fx[m], fy[m], c[m]
        out = np.zeros((H * W, 3), np.float32)
        if x0.size == 0:
            return out.reshape(H, W, 3)
        idx = y0 * W + x0
        ids = np.concatenate([idx, idx + 1, idx + W, idx + W + 1])
        wa = np.concatenate([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy])
        cc = np.concatenate([c, c, c, c])
        for ch in range(3):
            out[:, ch] = np.bincount(ids, weights=wa * cc[:, ch], minlength=H * W)
        return out.reshape(H, W, 3)

    def render(self):
        W, H, s = self.ctx.W, self.ctx.H, self.ctx.s
        if self.px:
            E = self._splat(W, H, np.concatenate(self.px), np.concatenate(self.py), np.concatenate(self.pc))
        else:
            E = np.zeros((H, W, 3), np.float32)
        for F in self.fields:
            E += F if F.shape[:2] == (H, W) else cv2.resize(F, (W, H), interpolation=cv2.INTER_LINEAR)
        w4, h4 = W // 4, H // 4
        d4 = cv2.resize(E, (w4, h4), interpolation=cv2.INTER_AREA)
        if self.gx:
            d4 += self._splat(w4, h4, np.concatenate(self.gx) / 4.0, np.concatenate(self.gy) / 4.0, np.concatenate(self.gc))
        b1 = cv2.GaussianBlur(d4, (0, 0), 1.6 * s)
        d16 = cv2.resize(d4, (W // 16, H // 16), interpolation=cv2.INTER_AREA)
        b2 = cv2.GaussianBlur(d16, (0, 0), 2.6 * s)
        E += 0.9 * cv2.resize(b1, (W, H), interpolation=cv2.INTER_LINEAR)
        E += 1.3 * cv2.resize(b2, (W, H), interpolation=cv2.INTER_LINEAR)
        return E


# ---------------------------------------------------------------- сцены

class Scene:
    name = ""
    gain = 1.0

    def __init__(self, ctx, seed):
        self.ctx = ctx
        self.rng = np.random.default_rng(seed)

    def halo(self, t):
        return 1.0

    def dur(self):
        return SLOT + XF


class Vortex(Scene):
    gain = 3.0
    name = "vortex"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        self.N = 6500
        self.arm = r.integers(0, 3, self.N)
        self.u0 = r.random(self.N)
        self.jit = r.normal(0, 1, self.N)
        self.jr = r.normal(0, 1, self.N)
        self.br = r.uniform(0.35, 1.0, self.N)
        self.M = 11000
        self.marm = r.integers(0, 3, self.M)
        self.mu0 = r.random(self.M)
        self.mjit = r.normal(0, 1, self.M)
        self.K = 1400
        self.k0 = r.uniform(0, 2 * np.pi, self.K)
        self.kr = r.uniform(1.04, 1.5, self.K)
        self.kb = r.uniform(0.3, 1.0, self.K)

    def _pos(self, u0, arm, jit, jr, t, spread):
        c = self.ctx
        rin, rout = c.R * 1.06, c.Rmax * 1.08
        u = (u0 + t * 0.085) % 1.0
        r = rout * (rin / rout) ** u
        width = spread * (0.10 + 0.32 * (1 - u))
        th = arm * (2 * np.pi / 3) + 2.4 * np.log(r / c.R) - 0.55 * t + jit * width
        r = r * (1 + 0.05 * jr * (1 - u))
        return c.cx + r * np.cos(th), c.cy + r * np.sin(th), u, r

    def render(self, cv, t, amp):
        c = self.ctx
        lags = [0.0, 0.035, 0.07, 0.105]
        P = [self._pos(self.u0, self.arm, self.jit, self.jr, t - lag, 1.0) for lag in lags]
        u, r = P[0][2], P[0][3]
        w = amp * self.br * 0.55 * (c.R / r) ** 0.5 * smooth(0, 0.08, u) * smooth(1.0, 0.94, u)
        col = np.where((u > 0.75)[:, None], GOLD, ORANGE)
        for j in range(len(lags) - 1):
            cv.segs(P[j][0], P[j][1], P[j + 1][0], P[j + 1][1], w * (1 - j / len(lags)) * 0.9, col)
        x, y, mu, mr = self._pos(self.mu0, self.marm, self.mjit, np.zeros(self.M), t, 2.2)
        cv.pts(x, y, amp * 0.11 * (c.R / mr) ** 0.4 * smooth(0, 0.1, mu), EMBER)
        # быстрое кольцо аккреции у самой монеты
        for lag, k in ((0.0, 1.0), (0.04, 0.6), (0.08, 0.35)):
            th = self.k0 - 2.6 * (t - lag) * (1.25 / self.kr) ** 1.5
            rr = c.R * self.kr
            cv.pts(c.cx + rr * np.cos(th), c.cy + rr * np.sin(th), amp * k * 0.7 * self.kb, GOLD)


class Fireworks(Scene):
    gain = 3.2
    name = "fireworks"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        s = c.s
        times = []
        t = 0.3
        while t < self.dur() - 2.2:
            times.append(t)
            t += r.uniform(0.28, 0.6)
        self.ts = np.array(times)
        n = len(times)
        self.phi = r.uniform(0, 2 * np.pi, n)
        d = r.uniform(0.32, 0.78, n)
        dx, dy = np.cos(self.phi), np.sin(self.phi)
        self.sx = c.cx + dx * c.R * 1.05
        self.sy = c.cy + dy * c.R * 1.05
        self.bx = c.cx + dx * (c.R + d * (c.W / 2 - c.R))
        self.by = c.cy + dy * (c.R + d * (c.H / 2 - c.R))
        self.tb = r.uniform(0.55, 0.85, n)
        kinds = r.choice(4, n, p=[0.4, 0.25, 0.2, 0.15])
        palettes = [GOLD, ORANGE, HOT, RED]
        sh, vx, vy, kk, gg, life, cols, tw = [], [], [], [], [], [], [], []
        for i in range(n):
            kind = kinds[i]
            m = int(r.integers(200, 320))
            if kind == 2:  # кольцо
                a = r.uniform(0, 2 * np.pi, m)
                tilt = r.uniform(0.25, 1.0)
                rot = r.uniform(0, np.pi)
                ux, uy = np.cos(a), np.sin(a) * tilt
                ux, uy = ux * np.cos(rot) - uy * np.sin(rot), ux * np.sin(rot) + uy * np.cos(rot)
                spd = np.full(m, r.uniform(330, 430))
            else:
                v = r.normal(0, 1, (m, 3))
                v /= np.linalg.norm(v, axis=1, keepdims=True)
                ux, uy = v[:, 0], v[:, 1]
                spd = r.uniform(340, 480) * r.uniform(0.9, 1.08, m)
            willow = kind == 1
            sh.append(np.full(m, i))
            vx.append(ux * spd * s)
            vy.append(uy * spd * s)
            kk.append(np.full(m, 1.0 if willow else 1.7))
            gg.append(np.full(m, (55 if willow else 120) * s))
            life.append(r.uniform(2.6, 3.4, m) if willow else r.uniform(1.6, 2.3, m))
            base = GOLD if willow else palettes[int(r.integers(0, 4))]
            cols.append(np.repeat(base[None, :], m, 0))
            tw.append(r.uniform(0, 1000, m))
        self.sh = np.concatenate(sh)
        self.vx = np.concatenate(vx)
        self.vy = np.concatenate(vy)
        self.k = np.concatenate(kk)
        self.g = np.concatenate(gg)
        self.life = np.concatenate(life)
        self.col = np.concatenate(cols).astype(np.float32)
        self.tw = np.concatenate(tw)
        self.flash = np.zeros(1)

    def _spark(self, idx, a):
        k, g = self.k[idx], self.g[idx]
        e = (1 - np.exp(-k * a)) / k
        sh = self.sh[idx]
        x = self.bx[sh] + self.vx[idx] * e
        y = self.by[sh] + (self.vy[idx] + g / k) * e - g * a / k
        return x, y

    def render(self, cv, t, amp):
        # полёт снаряда
        for i in np.nonzero((t >= self.ts) & (t < self.ts + self.tb))[0]:
            tau = t - self.ts[i]
            lag = np.clip(tau - np.arange(12) * 0.016, 0, None)
            f = 1 - (1 - lag / self.tb[i]) ** 2
            x = self.sx[i] + (self.bx[i] - self.sx[i]) * f
            y = self.sy[i] + (self.by[i] - self.sy[i]) * f
            cv.poly(np.stack([x, y], 1), amp * np.linspace(3.0, 0.0, 12), HOT)
            cv.glow(x[0], y[0], amp * 3.0, GOLD)
        # искры после разрыва
        age_all = t - self.ts[self.sh] - self.tb[self.sh]
        idx = np.nonzero((age_all >= 0) & (age_all < self.life))[0]
        if idx.size:
            a = age_all[idx]
            life = self.life[idx]
            fade = (1 - a / life) ** 1.4
            twinkle = np.where(a > 0.55 * life, (hash01(self.tw[idx] + np.floor(a * 16)) > 0.45) * 1.6, 1.0)
            col = self.col[idx] * (1 - a / life)[:, None] * 0.0 + self.col[idx]
            col = col + (RED[None, :] - col) * np.clip(a / life * 1.2, 0, 1)[:, None]
            J = 9
            xs, ys = [], []
            for j in range(J):
                x, y = self._spark(idx, np.clip(a - j * 0.03, 0, None))
                xs.append(x)
                ys.append(y)
            base = amp * fade * twinkle * 0.75
            for j in range(J - 1):
                cv.segs(xs[j], ys[j], xs[j + 1], ys[j + 1], base * (1 - j / J), col)
            cv.pts(xs[0], ys[0], base * 1.2, HOT)
        # вспышки разрыва
        for i in np.nonzero((t >= self.ts + self.tb) & (t < self.ts + self.tb + 0.35))[0]:
            a = t - self.ts[i] - self.tb[i]
            cv.glow(self.bx[i], self.by[i], amp * 70 * (1 - a / 0.35) ** 2, GOLD)

    def halo(self, t):
        launches = np.sum(np.exp(-np.clip(t - self.ts, 0, None) / 0.25) * (t >= self.ts))
        return 1.0 + 0.25 * min(launches, 2.0)


def bolt_path(rng, p0, p1, levels, rough):
    P = np.array([p0, p1], np.float64)
    disp = np.linalg.norm(np.subtract(p1, p0)) * rough
    for _ in range(levels):
        a, b = P[:-1], P[1:]
        mid = (a + b) / 2
        d = b - a
        nrm = np.stack([-d[:, 1], d[:, 0]], 1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        mid += nrm * rng.normal(0, 1, (len(mid), 1)) * disp
        out = np.empty((len(P) * 2 - 1, 2))
        out[0::2] = P
        out[1::2] = mid
        P = out
        disp *= 0.55
    return P


class Lightning(Scene):
    """Гроза: разряды из ауры знака во все стороны, удары с краёв экрана прямо
    в знак со вспышкой на весь кадр, ток бегает по контуру ₿.
    27.11 усилено по просьбе Димы («молнии можно посильнее»)."""

    gain = 2.4
    name = "lightning"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        self.contours = glyph_contours(ctx)
        self.bolts = []
        t = 0.2
        while t < self.dur() - 0.6:
            group = int(r.choice([1, 2, 3], p=[0.7, 0.18, 0.12]))
            for _ in range(group):
                a = r.uniform(0, 2 * np.pi)
                p0 = (c.cx + np.cos(a) * c.R * 1.0, c.cy + np.sin(a) * c.R * 1.0)
                a2 = a + r.normal(0, 0.35)
                dist = r.uniform(0.9, 1.4) * c.Rmax
                p1 = (c.cx + np.cos(a2) * dist, c.cy + np.sin(a2) * dist)
                self.bolts.append((t + r.uniform(0, 0.05), self._tree(r, p0, p1, dist), self._restrikes(r), p0, 1.0))
            t += r.uniform(0.12, 0.3) * (1.8 if group > 1 else 1.0)
        # удары с края экрана в знак: редкие, толстые, со вспышкой
        self.strikes = []
        t = 0.9
        while t < self.dur() - 0.8:
            side = r.choice(4, p=[0.55, 0.15, 0.15, 0.15])
            if side == 0:
                p0 = (r.uniform(0.1, 0.9) * c.W, -20.0)
            elif side == 1:
                p0 = (r.uniform(0.1, 0.9) * c.W, c.H + 20.0)
            elif side == 2:
                p0 = (-20.0, r.uniform(0.1, 0.9) * c.H)
            else:
                p0 = (c.W + 20.0, r.uniform(0.1, 0.9) * c.H)
            # точка удара — на контуре знака, на стороне, смотрящей к источнику
            best = None
            for P, n in self.contours:
                d = np.hypot(P[:, 0] - p0[0], P[:, 1] - p0[1])
                i = int(np.argmin(d))
                if best is None or d[i] < best[0]:
                    best = (d[i], P[i] + n[i] * 2.0)
            p1 = tuple(best[1])
            dist = float(best[0])
            self.strikes.append((t, self._tree(r, p0, p1, dist, main_k=1.6, branches=(4, 8)), self._restrikes(r, 3), p1, p0))
            t += r.uniform(0.9, 1.7)

    @staticmethod
    def _restrikes(r, n_max=2):
        return [(0.0, 1.0)] + [(r.uniform(0.07, 0.32), r.uniform(0.5, 0.95)) for _ in range(int(r.integers(1, n_max + 1)))]

    @staticmethod
    def _tree(r, p0, p1, dist, main_k=1.0, branches=(3, 7)):
        main = bolt_path(r, p0, p1, 8, 0.15)
        segs = [(main, main_k)]
        for _ in range(int(r.integers(*branches))):
            i0 = int(r.integers(len(main) // 8, len(main) * 3 // 4))
            q0 = main[i0]
            d = main[min(i0 + 8, len(main) - 1)] - q0
            ang = math.atan2(d[1], d[0]) + r.choice([-1, 1]) * r.uniform(0.3, 0.9)
            ln = r.uniform(0.15, 0.45) * dist
            br = bolt_path(r, q0, (q0[0] + math.cos(ang) * ln, q0[1] + math.sin(ang) * ln), 6, 0.18)
            segs.append((br, 0.45 * main_k))
            for _ in range(int(r.integers(0, 3))):
                j0 = int(r.integers(len(br) // 4, len(br) * 3 // 4))
                ang2 = ang + r.choice([-1, 1]) * r.uniform(0.3, 0.8)
                ln2 = ln * r.uniform(0.3, 0.6)
                q1 = br[j0]
                segs.append((bolt_path(r, q1, (q1[0] + math.cos(ang2) * ln2, q1[1] + math.sin(ang2) * ln2), 5, 0.2), 0.22 * main_k))
        return segs

    @staticmethod
    def _intensity(tau, restr):
        if tau < 0 or tau > 0.7:
            return 0.0
        return sum(k * math.exp(-(tau - t0) / 0.07) for t0, k in restr if tau >= t0)

    def _draw(self, cv, segs, I, amp):
        for P, k in segs:
            w = amp * I * k
            cv.poly(P, w * 3.2, WHITE, step=0.6)
            cv.glow(P[::3, 0], P[::3, 1], w * 9.0, ORANGE)
            if k >= 1.0:
                for off, kk, col in ((1.3, 1.8, HOT), (2.6, 0.9, GOLD)):
                    cv.poly(P + off, w * kk, col, step=0.8)
                    cv.poly(P - off, w * kk, col, step=0.8)

    def render(self, cv, t, amp):
        c = self.ctx
        for t0, segs, restr, p0, _ in self.bolts:
            I = self._intensity(t - t0, restr)
            if I < 0.02:
                continue
            self._draw(cv, segs, I, amp)
            cv.glow(p0[0], p0[1], amp * I * 30, GOLD)
        flash = 0.0
        for t0, segs, restr, p1, p0 in self.strikes:
            I = self._intensity(t - t0, restr)
            if I < 0.02:
                continue
            self._draw(cv, segs, I, amp)
            cv.glow(p0[0], p0[1], amp * I * 60, HOT)
            flash += I
        if flash > 0:
            # вспышка на весь кадр: небо озаряется, ярче у источника
            h, w = 18, 32
            F = np.full((h, w, 3), 1.0, np.float32) * (0.10 * min(flash, 2.0) * amp / self.gain)
            cv.field(F * HOT[None, None, :])

    def render_front(self, cv, t, amp):
        """Поверх знака: ток бежит по контуру ₿, удар зажигает точку касания."""
        c = self.ctx
        win = math.floor(t / 0.06)
        rr = np.random.default_rng(10_000 + win)
        charge = 0.0
        for t0, segs, restr, p1, p0 in self.strikes:
            tau = t - t0
            if -0.5 < tau < 0:
                charge = max(charge, 1 + tau / 0.5)
            I = self._intensity(tau, restr)
            if I > 0.02:
                charge = max(charge, 1.0)
                cv.glow(p1[0], p1[1], amp * I * 90, WHITE)
                cv.glow(p1[0], p1[1], amp * I * 160, GOLD)
        n_arcs = 4 + int(6 * charge)
        for _ in range(n_arcs):
            P, nrm = self.contours[int(rr.integers(0, len(self.contours)))]
            L = int(rr.integers(30, min(160, len(P))))
            i0 = int(rr.integers(0, len(P)))
            idx = (i0 + np.arange(0, L, 3)) % len(P)
            prof = np.sin(np.linspace(0, np.pi, len(idx)))
            off = (2.0 + 9.0 * prof * rr.uniform(0.4, 1.3)) * c.s + rr.normal(0, 1.6 * c.s, len(idx))
            Q = P[idx] + nrm[idx] * off[:, None]
            cv.poly(Q, amp * (0.7 + 0.6 * charge), HOT, step=0.6)
            cv.glow(Q[::4, 0], Q[::4, 1], amp * (1.2 + charge), GOLD)

    def halo(self, t):
        I = sum(self._intensity(t - t0, restr) for t0, _, restr, _, _ in self.bolts)
        I += 2 * sum(self._intensity(t - t0, restr) for t0, _, restr, _, _ in self.strikes)
        return 1.0 + 0.4 * min(I, 2.5)


class Heartbeat(Scene):
    gain = 2.6
    name = "heartbeat"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        beats = []
        t = 0.5
        while t < self.dur() - 1.0:
            beats.append((t, 1.0))
            beats.append((t + 0.3, 0.55))
            t += 1.65
        self.beats = beats
        self.ph = [r.uniform(0, 2 * np.pi, 8) for _ in beats]
        m = 260
        self.deb = []
        for _ in beats:
            ang = r.uniform(0, 2 * np.pi, m)
            spd = r.uniform(250, 950, m) * ctx.s
            self.deb.append((np.cos(ang) * spd, np.sin(ang) * spd, r.uniform(0.9, 1.7, m), r.uniform(0.4, 1.0, m)))
        self.rays = r.uniform(0, 2 * np.pi, 56)
        self.rayl = r.uniform(0.25, 0.8, 56)

    def render(self, cv, t, amp):
        c = self.ctx
        for bi, (tb, k) in enumerate(self.beats):
            a = t - tb
            if a < 0 or a > 2.6:
                continue
            rad = c.R * 1.04 + c.Rmax * 0.62 * a ** 0.85
            I = amp * k * math.exp(-a / 0.95) * smooth(c.Rmax * 1.15, c.Rmax * 0.9, rad)
            n = int(2 * np.pi * rad / 0.8)
            th = np.linspace(0, 2 * np.pi, n, endpoint=False)
            noise = sum(np.sin((j + 3) * th + self.ph[bi][j]) / (j + 3) for j in range(8))
            rr = rad + noise * (6 + 26 * a) * c.s
            x, y = c.cx + rr * np.cos(th), c.cy + rr * np.sin(th)
            cv.pts(x, y, I * 1.5, HOT)
            rr2 = rr - (10 + 30 * a) * c.s
            cv.pts(c.cx + rr2 * np.cos(th), c.cy + rr2 * np.sin(th), I * 0.45, ORANGE)
            cv.glow(c.cx + rr[::6] * np.cos(th[::6]), c.cy + rr[::6] * np.sin(th[::6]), I * 2.0, ORANGE)
            vx, vy, life, br = self.deb[bi]
            alive = a < life
            if alive.any():
                xs, ys = [], []
                for j in range(6):
                    aa = max(a - j * 0.03, 0)
                    e = (1 - math.exp(-2.2 * aa)) / 2.2
                    xs.append(c.cx + vx[alive] * e + np.sign(vx[alive]) * 0)
                    ys.append(c.cy + vy[alive] * e)
                # обломки стартуют с кромки монеты
                d = np.hypot(vx[alive], vy[alive])
                ox, oy = vx[alive] / d * c.R * 1.05, vy[alive] / d * c.R * 1.05
                w = amp * k * br[alive] * (1 - a / life[alive]) ** 1.5 * 0.9
                for j in range(5):
                    cv.segs(xs[j] + ox, ys[j] + oy, xs[j + 1] + ox, ys[j + 1] + oy, w * (1 - j / 6), GOLD)
            if a < 0.35:
                f = amp * k * (1 - a / 0.35) ** 2
                r0 = c.R * 1.05
                r1 = c.R * (1.05 + self.rayl * (0.4 + 1.6 * a))
                cv.segs(c.cx + r0 * np.cos(self.rays), c.cy + r0 * np.sin(self.rays),
                        c.cx + r1 * np.cos(self.rays), c.cy + r1 * np.sin(self.rays), f * 1.2, HOT)

    def halo(self, t):
        v = 0.0
        for tb, k in self.beats:
            if t >= tb:
                v += k * math.exp(-(t - tb) / 0.18)
        return 1.0 + 0.7 * min(v, 1.5)


class Plasma(Scene):
    gain = 3.2
    name = "plasma"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        self.loops = []
        t = -3.0
        while t < self.dur():
            a1 = r.uniform(0, 2 * np.pi)
            self.loops.append(dict(t0=t, life=r.uniform(3.8, 5.5), a1=a1, a2=a1 + r.choice([-1, 1]) * r.uniform(0.3, 0.75),
                                   hmax=r.uniform(0.5, 1.15) * ctx.R, s0=r.random(280), lj=r.normal(0, 1, 280), tw=r.uniform(0.6, 1.4),
                                   ph=r.uniform(0, 6.28)))
            t += r.uniform(0.45, 0.8)
        self.cme = []
        for tc in (r.uniform(2, 5), r.uniform(8, 11)):
            a = r.uniform(0, 2 * np.pi)
            m = 700
            self.cme.append(dict(tc=tc, a=a, da=r.normal(0, 0.28, m), sp=r.uniform(0.6, 1.0, m), rj=r.normal(0, 1, m)))
        self.sp_a = r.uniform(0, 2 * np.pi, 110)
        self.sp_w = r.uniform(2, 6, 110)
        self.sp_p = r.uniform(0, 6.28, 110)
        self.sp_l = r.uniform(8, 34, 110) * ctx.s

    def _loop(self, L, tau, s, hk=1.0):
        c = self.ctx
        h = L["hmax"] * math.sin(math.pi * min(max(tau / L["life"], 0), 1)) ** 0.7 * hk
        ang = L["a1"] + (L["a2"] - L["a1"]) * s + 0.035 * np.sin(2 * np.pi * s) * h / c.R * L["tw"]
        rad = c.R * 1.01 + h * np.sin(np.pi * s) * (1 + 0.12 * np.sin(3 * np.pi * s + L["ph"] + tau))
        return c.cx + rad * np.cos(ang), c.cy + rad * np.sin(ang)

    def render(self, cv, t, amp):
        c = self.ctx
        s = np.linspace(0, 1, 90)
        for L in self.loops:
            tau = t - L["t0"]
            if tau < 0 or tau > L["life"]:
                continue
            f = math.sin(math.pi * tau / L["life"]) ** 0.6
            for hk, k in ((1.0, 0.22), (0.93, 0.12), (1.07, 0.1)):
                x, y = self._loop(L, tau, s, hk)
                cv.poly(np.stack([x, y], 1), amp * f * k, GOLD)
            cv.glow(x[::2], y[::2], amp * f * 2.2 * np.sin(np.pi * s[::2]) ** 0.5, ORANGE)
            sj = (L["s0"] + 0.55 * tau) % 1.0
            hk = 1.0 + 0.06 * L["lj"]
            x, y = self._loop(L, tau, sj, hk)
            cv.pts(x, y, amp * f * 0.9 * np.sin(np.pi * sj) ** 0.5, HOT)
            x2, y2 = self._loop(L, tau, (sj - 0.015) % 1.0, hk)
            cv.segs(x2, y2, x, y, amp * f * 0.5, GOLD)
        for C in self.cme:
            a = t - C["tc"]
            if a < 0 or a > 3.0:
                continue
            rc = c.R * 1.1 + c.Rmax * 0.45 * a * C["sp"]
            ang = C["a"] + C["da"] * (1 + a)
            rr = rc + C["rj"] * 14 * c.s * (1 + 2 * a)
            w = amp * 0.6 * (1 - a / 3.0) ** 1.5
            cv.pts(c.cx + rr * np.cos(ang), c.cy + rr * np.sin(ang), w, GOLD)
            if a < 0.4:
                cv.glow(c.cx + c.R * 1.1 * math.cos(C["a"]), c.cy + c.R * 1.1 * math.sin(C["a"]), amp * 30 * (1 - a / 0.4), HOT)
        ln = self.sp_l * (0.45 + 0.55 * np.sin(self.sp_w * t + self.sp_p) ** 2)
        r0 = c.R * 1.02
        r1 = r0 + ln
        cv.segs(c.cx + r0 * np.cos(self.sp_a), c.cy + r0 * np.sin(self.sp_a),
                c.cx + r1 * np.cos(self.sp_a), c.cy + r1 * np.sin(self.sp_a), amp * 0.55, ORANGE)

    def halo(self, t):
        return 1.12


class Network(Scene):
    gain = 2.4
    name = "network"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        rings = [(1.75, 9), (2.6, 13), (3.5, 17), (4.5, 21), (5.6, 25)]
        nodes, ring_of = [], []
        for ri, (k, n) in enumerate(rings):
            off = r.uniform(0, 2 * np.pi)
            for j in range(n):
                a = off + 2 * np.pi * j / n + r.normal(0, 0.06)
                rad = c.R * k * r.uniform(0.94, 1.06)
                nodes.append((rad * math.cos(a) * c.ex, rad * math.sin(a) * c.ey))
                ring_of.append(ri)
        self.nodes = np.array(nodes)
        self.ring = np.array(ring_of)
        edges = set()
        inner = {}
        for i in range(len(nodes)):
            same = np.nonzero(self.ring == self.ring[i])[0]
            d = np.hypot(*(self.nodes[same] - self.nodes[i]).T)
            for j in same[np.argsort(d)[1:3]]:
                edges.add(tuple(sorted((i, int(j)))))
            if self.ring[i] > 0:
                inn = np.nonzero(self.ring == self.ring[i] - 1)[0]
                d = np.hypot(*(self.nodes[inn] - self.nodes[i]).T)
                choice = [int(j) for j in inn[np.argsort(d)[:2]]]
                inner[i] = choice
                for j in choice:
                    edges.add(tuple(sorted((i, j))))
        self.edges = np.array(sorted(edges))
        self.inner = inner
        # маршруты пакетов: от внешнего узла по связям к монете (или обратно)
        self.pulses = []
        t = 0.0
        outer = np.nonzero(self.ring >= 3)[0]
        while t < self.dur():
            i = int(r.choice(outer))
            route = [i]
            while self.ring[route[-1]] > 0:
                route.append(int(r.choice(self.inner[route[-1]])))
            outward = r.random() < 0.3
            self.pulses.append(dict(t0=t, route=route[::-1] if outward else route, outward=outward,
                                    speed=r.uniform(280, 380) * c.s))
            t += r.uniform(0.08, 0.2)
        self.rot_speed = 0.035

    def _xy(self, t):
        c = self.ctx
        a = self.rot_speed * t
        ca, sa = math.cos(a), math.sin(a)
        x = self.nodes[:, 0] / c.ex
        y = self.nodes[:, 1] / c.ey
        return c.cx + (x * ca - y * sa) * c.ex, c.cy + (x * sa + y * ca) * c.ey

    def _route_pts(self, X, Y, route, outward):
        c = self.ctx
        P = [(X[i], Y[i]) for i in route]
        first = P[-1] if not outward else P[0]
        d = np.array(first) - (c.cx, c.cy)
        anchor = (c.cx + d[0] / np.linalg.norm(d) * c.R * 1.02, c.cy + d[1] / np.linalg.norm(d) * c.R * 1.02)
        return np.array([anchor] + P if outward else P + [anchor], np.float64)

    def render(self, cv, t, amp):
        c = self.ctx
        X, Y = self._xy(t)
        e = self.edges
        cv.segs(X[e[:, 0]], Y[e[:, 0]], X[e[:, 1]], Y[e[:, 1]], amp * 0.07, ORANGE)
        inner0 = np.nonzero(self.ring == 0)[0]
        dx, dy = X[inner0] - c.cx, Y[inner0] - c.cy
        dn = np.hypot(dx, dy)
        cv.segs(c.cx + dx / dn * c.R * 1.02, c.cy + dy / dn * c.R * 1.02, X[inner0], Y[inner0], amp * 0.09, ORANGE)
        node_heat = np.zeros(len(X))
        for p in self.pulses:
            tau = t - p["t0"]
            if tau < 0:
                continue
            P = self._route_pts(X, Y, p["route"], p["outward"])
            seg = np.hypot(*np.diff(P, axis=0).T)
            cum = np.concatenate([[0], np.cumsum(seg)])
            dist = tau * p["speed"]
            if dist > cum[-1] + 60 * c.s:
                continue
            ds = np.clip(dist - np.linspace(0, 55 * c.s, 14), 0, cum[-1])
            px = np.interp(ds, cum, P[:, 0])
            py = np.interp(ds, cum, P[:, 1])
            head = dist <= cum[-1]
            cv.poly(np.stack([px, py], 1), amp * np.linspace(1.5, 0, 14) * (1.0 if head else 0.5), HOT)
            if head:
                cv.glow(px[0], py[0], amp * 6, GOLD)
            # узлы, через которые пакет прошёл недавно, вспыхивают
            nodes_on = p["route"] if not p["outward"] else p["route"]
            offs = cum[:-1] if not p["outward"] else cum[1:]
            for node, d0 in zip(nodes_on, offs):
                dt = (dist - d0) / p["speed"]
                if 0 <= dt < 0.6:
                    node_heat[node] += math.exp(-dt / 0.15)
        sz = 6.0 * c.s
        corners = np.array([(0, -1), (1, 0), (0, 1), (-1, 0), (0, -1)], np.float32) * sz
        w = amp * (0.35 + 1.6 * np.minimum(node_heat, 1.5))
        for k in range(4):
            cv.segs(X + corners[k, 0], Y + corners[k, 1], X + corners[k + 1, 0], Y + corners[k + 1, 1], w, GOLD, step=0.6)
        hot = node_heat > 0.05
        cv.glow(X[hot], Y[hot], amp * 8 * np.minimum(node_heat[hot], 1.5), GOLD)

    def halo(self, t):
        v = 0.0
        for p in self.pulses:
            if p["outward"]:
                continue
            tau = t - p["t0"]
            if tau < 0:
                continue
            X, Y = self._xy(p["t0"])
            P = self._route_pts(X, Y, p["route"], False)
            total = np.sum(np.hypot(*np.diff(P, axis=0).T))
            ta = total / p["speed"]
            if 0 <= tau - ta < 0.8:
                v += math.exp(-(tau - ta) / 0.2)
        return 1.0 + 0.18 * min(v, 2.0)


class Flame(Scene):
    gain = 3.0
    name = "flame"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        self.rate = 1100
        n = int(self.rate * (self.dur() + 2))
        self.a = r.uniform(0, 2 * np.pi, n)
        self.vr = r.uniform(20, 90, n) * c.s
        self.buoy = r.uniform(140, 300, n) * c.s
        self.life = r.uniform(1.0, 2.0, n)
        self.sw = r.uniform(2, 5, n)
        self.sp = r.uniform(0, 6.28, n)
        self.sa = r.uniform(6, 22, n) * c.s
        self.br = r.uniform(0.4, 1.0, n)
        hw, hh = c.W // 2, c.H // 2
        yy, xx = np.mgrid[0:hh, 0:hw].astype(np.float32)
        dx = (xx + 0.5) * 2 - c.cx
        dy = (yy + 0.5) * 2 - c.cy
        self.rr = np.hypot(dx, dy)
        self.th = np.arctan2(dy, dx)
        self.ray_n = [9, 14, 23, 31]
        self.ray_w = [0.22, -0.15, 0.09, -0.06]
        self.ray_p = r.uniform(0, 6.28, 4)

    def _xy(self, idx, tau):
        c = self.ctx
        a = self.a[idx]
        x = c.cx + np.cos(a) * (c.R * 1.02 + self.vr[idx] * tau) + self.sa[idx] * np.sin(self.sw[idx] * tau + self.sp[idx]) * tau
        y = c.cy + np.sin(a) * (c.R * 1.02 + self.vr[idx] * tau) - 0.5 * self.buoy[idx] * tau ** 2
        return x, y

    def render(self, cv, t, amp):
        c = self.ctx
        f = np.zeros_like(self.th)
        for n, w, p in zip(self.ray_n, self.ray_w, self.ray_p):
            f += np.maximum(0, np.cos(n * (self.th - w * t) + p)) ** 6
        fall = np.exp(-np.maximum(self.rr - c.R, 0) / (0.32 * c.Rmax)) * smooth(c.R * 0.98, c.R * 1.15, self.rr)
        E = (f * fall * amp / self.gain * 0.16)[..., None] * ORANGE[None, None, :]
        cv.field(E.astype(np.float32))
        lo = max(0, int((t - 2.0) * self.rate))
        hi = min(len(self.a), int(t * self.rate))
        idx = np.arange(lo, hi)
        tau = t - idx / self.rate
        alive = tau < self.life[idx]
        idx, tau = idx[alive], tau[alive]
        if not idx.size:
            return
        k = tau / self.life[idx]
        col = HOT[None, :] * (1 - k)[:, None] ** 2 + RED[None, :] * (1 - (1 - k) ** 2)[:, None]
        w = amp * self.br[idx] * (1 - k) ** 1.3 * smooth(0, 0.08, tau) * 0.7
        pts = [self._xy(idx, np.maximum(tau - j * 0.035, 0)) for j in range(5)]
        for j in range(4):
            cv.segs(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], w * (1 - j / 5), col)
        cv.pts(pts[0][0], pts[0][1], w * 1.6, col)

    def halo(self, t):
        return 1.15 + 0.08 * math.sin(t * 7.0) * math.sin(t * 2.3)


class Candles(Scene):
    """График: свечи бегут справа налево и ползут вверх, «к луне»."""

    gain = 3.2
    name = "candles"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        self.sp = 40 * c.s
        self.speed = 1.4  # свечей в секунду
        self.pre = int(c.W / self.sp) + 6
        n = self.pre + int(self.dur() * self.speed) + 6
        steps = r.normal(0.34, 1.0, n)
        # редкие «пампы» — длинная бычья свеча
        pump = r.random(n) < 0.06
        steps[pump] += r.uniform(2.0, 3.5, pump.sum())
        close = np.cumsum(steps)
        opn = np.concatenate([[0.0], close[:-1]])
        self.o, self.c = opn, close
        self.hi = np.maximum(opn, close) + np.abs(r.normal(0, 0.55, n))
        self.lo = np.minimum(opn, close) - np.abs(r.normal(0, 0.55, n))
        k = 14
        pad = np.concatenate([np.full(k, close[0]), close])
        self.ref = np.convolve(pad, np.ones(k) / k, mode="valid")[:n]
        self.unit = 26 * c.s
        self.xh = c.W * 0.86
        self.base = c.cy - 0.02 * c.H
        self.wig = r.uniform(0, 6.28, n)

    def render(self, cv, t, amp):
        c = self.ctx
        h = self.pre + t * self.speed
        hi_i = int(math.floor(h))
        f = h - hi_i
        yref = float(np.interp(h - 4, np.arange(len(self.ref)), self.ref))

        def Y(p):
            return self.base - (np.asarray(p) - yref) * self.unit

        # сетка: горизонтали уезжают вниз — значит, цена растёт
        g0 = math.floor((yref - 30) / 4) * 4
        for g in np.arange(g0, g0 + 64, 4):
            y = float(Y(g))
            if -10 < y < c.H + 10:
                cv.segs([0.0], [y], [c.W], [y], amp * 0.035, ORANGE, step=2.0)
        for k in range(hi_i - 80, hi_i + 2):
            if k % 6 == 0:
                x = self.xh - (h - k) * self.sp
                if 0 < x < c.W:
                    cv.segs([x], [0.0], [x], [c.H], amp * 0.03, ORANGE, step=2.0)
        lo_i = max(0, int(h - c.W / self.sp) - 2)
        idx = np.arange(lo_i, hi_i + 1)
        o = self.o[idx].copy()
        cl = self.c[idx].copy()
        hh = self.hi[idx].copy()
        ll = self.lo[idx].copy()
        # текущая свеча ещё формируется
        live = o[-1] + (cl[-1] - o[-1]) * f + 0.5 * math.sin(9 * t + self.wig[hi_i]) * (1 - f)
        cl[-1] = live
        hh[-1] = max(o[-1], live) + (hh[-1] - max(o[-1], self.c[hi_i])) * f
        ll[-1] = min(o[-1], live) - (min(o[-1], self.c[hi_i]) - ll[-1]) * f
        x = self.xh - (h - idx - 0.5) * self.sp
        x[-1] = self.xh - 0.5 * self.sp * (1 - f) + 0.5 * self.sp * f - 0.5 * self.sp
        fade = smooth(0, c.W * 0.3, x) * amp
        bull = cl >= o
        col = np.where(bull[:, None], GOLD, RED)
        kb = np.where(bull, 1.0, 0.55)
        yo, yc, yh, yl = Y(o), Y(cl), Y(hh), Y(ll)
        cv.segs(x, yh, x, yl, fade * kb * 0.45, col, step=0.8)
        bw = 0.3 * self.sp
        top, bot = np.minimum(yo, yc), np.maximum(yo, yc) + 1.0
        for dx in np.linspace(-bw, bw, 7):
            cv.segs(x + dx, top, x + dx, bot, fade * kb * 0.22, col, step=0.8)
        for x0, y0, x1, y1 in ((x - bw, top, x + bw, top), (x + bw, top, x + bw, bot),
                               (x + bw, bot, x - bw, bot), (x - bw, bot, x - bw, top)):
            cv.segs(x0, y0, x1, y1, fade * kb * 0.8, np.where(bull[:, None], HOT, RED), step=0.7)
        # линия цены и раскалённая «голова»
        cv.poly(np.stack([x, yc], 1), fade * 0.5, HOT, step=0.8)
        hx, hy = float(x[-1]), float(yc[-1])
        cv.glow(hx, hy, amp * 26, GOLD)
        cv.pts(hx, hy, amp * 8, WHITE)
        xs = np.arange(0, c.W, 14 * c.s)
        dash = (np.floor((xs + t * 60 * c.s) / (14 * c.s)) % 2) == 0
        cv.segs(xs[dash], np.full(dash.sum(), hy), xs[dash] + 7 * c.s, np.full(dash.sum(), hy), amp * 0.18, GOLD, step=1.0)
        # искры над «пампами»
        big = np.nonzero((cl - o) > 2.0)[0]
        for j in big:
            cv.glow(x[j], top[j], fade[j] * 10, HOT)

    def halo(self, t):
        return 1.05


class CoinRain(Scene):
    """Монетный дождь: золотые монетки кувыркаются и падают, между ними искры."""

    gain = 2.4
    name = "coinrain"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        n = int(70 * c.W * c.H / (1920 * 1080))
        self.n = n
        self.z = r.uniform(0.35, 1.0, n)
        self.rad = (7 + 17 * self.z ** 1.5) * c.s
        self.x0 = r.uniform(-0.05, 1.05, n) * c.W
        self.y0 = r.uniform(0, 1, n)
        self.vy = (110 + 260 * self.z) * c.s
        self.spin = r.uniform(2.0, 6.0, n) * r.choice([-1, 1], n)
        self.sph = r.uniform(0, 6.28, n)
        self.tilt = r.uniform(-0.5, 0.5, n)
        self.sw = r.uniform(0.4, 1.2, n)
        self.swp = r.uniform(0, 6.28, n)
        m = int(700 * c.W * c.H / (1920 * 1080))
        self.sx = r.uniform(0, 1, m) * c.W
        self.sy = r.uniform(0, 1, m)
        self.svy = r.uniform(380, 760, m) * c.s
        self.sbr = r.uniform(0.2, 1.0, m)
        self.stw = r.uniform(0, 1000, m)

    def render(self, cv, t, amp):
        c = self.ctx
        span = c.H + 80 * c.s
        y = (self.y0 * span + self.vy * t) % span - 40 * c.s
        x = self.x0 + 26 * c.s * np.sin(self.sw * t + self.swp) + 18 * c.s * t
        x = (x + 40) % (c.W + 80) - 40
        th = np.linspace(0, 2 * np.pi, 30)
        sp = self.spin * t + self.sph
        ex = self.rad * (0.12 + 0.88 * np.abs(np.cos(sp)))
        ca, sa = np.cos(self.tilt), np.sin(self.tilt)
        ux = ex[:, None] * np.cos(th)[None, :]
        uy = self.rad[:, None] * np.sin(th)[None, :]
        X = x[:, None] + ux * ca[:, None] - uy * sa[:, None]
        Yy = y[:, None] + ux * sa[:, None] + uy * ca[:, None]
        w = amp * (0.3 + 0.5 * self.z)
        ww = np.repeat(w, th.size - 1)
        cv.segs(X[:, :-1], Yy[:, :-1], X[:, 1:], Yy[:, 1:], ww * 0.7, HOT, step=0.7)
        # заливка поперечными хордами — монета читается сплошной, а не кольцом
        face = 0.4 + 0.6 * np.abs(np.cos(sp))
        for j in np.linspace(-0.9, 0.9, 15):
            hw = ex * 0.86 * math.sqrt(1 - j * j)
            cy_ = self.rad * 0.86 * j
            xa, ya = x - hw * ca - cy_ * sa, y - hw * sa + cy_ * ca
            xb, yb = x + hw * ca - cy_ * sa, y + hw * sa + cy_ * ca
            shade = 0.55 + 0.45 * (-j)  # сверху светлее
            cv.segs(xa, ya, xb, yb, w * 0.42 * face * shade, ORANGE * 0.5 + GOLD * 0.5, step=0.8)
        # ребро монеты, когда она встаёт боком, — яркий штрих
        edge = (1 - np.abs(np.cos(sp))) ** 3
        cv.segs(x + sa * self.rad, y - ca * self.rad, x - sa * self.rad, y + ca * self.rad,
                amp * edge * 0.9 * self.z, HOT, step=0.7)
        # блик, когда монета повернулась лицом
        glint = np.abs(np.cos(sp)) ** 24
        cv.glow(x, y, amp * glint * 14 * self.z, HOT)
        cv.pts(x, y, amp * (0.6 + 2.5 * glint) * self.z, GOLD)
        # искры дождя
        span2 = c.H + 60
        sy = (self.sy * span2 + self.svy * t) % span2 - 30
        sx = self.sx + 18 * c.s * t
        sx = sx % c.W
        tw = 0.4 + 0.6 * (hash01(self.stw + np.floor(t * 12)) > 0.3)
        cv.segs(sx, sy - self.svy * 0.035, sx, sy, amp * 0.18 * self.sbr * tw, ORANGE, step=1.0)
        cv.pts(sx, sy, amp * 0.5 * self.sbr * tw, GOLD)

    def halo(self, t):
        return 1.08


class HashRain(Scene):
    """Хэш-дождь: столбцы шестнадцатеричных символов блоков стекают вниз,
    голова столбца раскалена добела, хвост остывает в уголь."""

    gain = 2.0
    name = "hashrain"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        cell = max(12, int(round(22 * c.s)))
        self.cell = cell
        self.cols = c.W // cell
        self.rows = c.H // cell + 1
        self.x0 = (c.W - self.cols * cell) // 2
        chars = "0123456789abcdef"
        font = ImageFont.truetype(FONT, int(cell * 0.82))
        try:
            font.set_variation_by_name(b"Medium")
        except Exception:
            pass
        atlas = []
        for ch in chars:
            img = Image.new("L", (cell, cell), 0)
            box = font.getbbox(ch)
            ImageDraw.Draw(img).text(((cell - (box[2] - box[0])) / 2 - box[0], (cell - (box[3] - box[1])) / 2 - box[1]), ch, font=font, fill=255)
            atlas.append(np.asarray(img, np.float32) / 255.0)
        self.atlas = np.stack(atlas)
        n = self.cols
        self.on = r.random(n) < 0.55
        self.speed = r.uniform(5, 14, n)
        self.trail = r.integers(8, 26, n)
        self.off = r.uniform(0, 60, n)
        self.seed = r.integers(0, 1 << 30, n)
        yy, xx = np.mgrid[0:c.H, 0:c.W].astype(np.float32)
        rr = np.hypot(xx - c.cx, yy - c.cy)
        # у самого знака дождь тише — центр остаётся за ₿
        self.calm = (0.35 + 0.65 * smooth(c.R * 0.9, c.R * 2.4, rr)).astype(np.float32)

    def render(self, cv, t, amp):
        c = self.ctx
        cell = self.cell
        Fh = np.zeros((self.rows * cell, self.cols * cell), np.float32)
        Ft = np.zeros_like(Fh)
        for j in np.nonzero(self.on)[0]:
            span = self.rows + self.trail[j] + 4
            head = (self.off[j] + self.speed[j] * t) % span
            hi = int(head)
            for k in range(int(self.trail[j])):
                row = hi - k
                if row < 0 or row >= self.rows:
                    continue
                # символ в клетке иногда перещёлкивается
                g = int(hash01(self.seed[j] * 0.001 + row * 7.31 + math.floor(t * 3 + row * 0.37)) * 16) % 16
                m = self.atlas[g]
                ys, xs = row * cell, j * cell
                if k == 0:
                    Fh[ys:ys + cell, xs:xs + cell] += m * 2.2
                else:
                    Ft[ys:ys + cell, xs:xs + cell] += m * (1 - k / self.trail[j]) ** 1.4
        E = np.zeros((c.H, c.W, 3), np.float32)
        h = min(c.H, Fh.shape[0])
        sl = (slice(0, h), slice(self.x0, self.x0 + Fh.shape[1]))
        k = amp / self.gain
        calm = self.calm[sl]
        E[sl] += (Fh[:h] * calm * k)[..., None] * WHITE + (Ft[:h] * calm * k * 1.1)[..., None] * ORANGE
        cv.field(E)

    def halo(self, t):
        return 1.05


SCENES = [Vortex, Fireworks, Lightning, Candles, Heartbeat, Plasma, CoinRain, Network, HashRain, Flame]
TOTAL = SLOT * len(SCENES)


# ---------------------------------------------------------------- монета и фон

def coin_layers(ctx):
    """Знак ₿ без круга: литой металл с фаской, свет сверху-слева, раскалённая
    кромка и мягкое свечение. Возвращает слои, неизменные во всех кадрах."""
    W, H, s, R = ctx.W, ctx.H, ctx.s, ctx.R
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.hypot(xx + 0.5 - ctx.cx, yy + 0.5 - ctx.cy)

    mask = glyph_mask(ctx)
    m8 = (mask > 0.5).astype(np.uint8)
    inside = cv2.distanceTransform(m8, cv2.DIST_L2, 5)
    bw = 13 * s  # ширина фаски
    hgt = np.clip(inside / bw, 0, 1)
    hgt = hgt * hgt * (3 - 2 * hgt)
    hgt = cv2.GaussianBlur(hgt.astype(np.float32), (0, 0), 1.8 * s)
    gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3) / 8.0 * bw * 1.1
    gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3) / 8.0 * bw * 1.1
    nrm = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    L = np.array([-0.45, -0.62, 0.64], np.float32)
    L /= np.linalg.norm(L)
    Hv = L + np.array([0, 0, 1], np.float32)
    Hv /= np.linalg.norm(Hv)
    diff = np.clip(nrm @ L, 0, 1)
    spec = np.clip(nrm @ Hv, 0, 1) ** 36
    # металл: сверху светлое золото, снизу густой оранжевый
    gy01 = np.clip((yy - (ctx.cy - 0.95 * R)) / (1.9 * R), 0, 1)[..., None]
    top = np.array([1.75, 0.98, 0.30], np.float32)
    bot = np.array([1.55, 0.52, 0.10], np.float32)
    metal = top * (1 - gy01) + bot * gy01
    # лёгкий «полированный» отлив по диагонали — неподвижный
    sheen = 1.0 + 0.18 * np.sin((xx - yy) / (0.55 * R) + 0.8)[..., None]
    core = mask[..., None] * metal * sheen * (0.22 + 1.55 * diff[..., None])
    core += (mask * spec * 7.0)[..., None] * WHITE
    # кромка: тонкая раскалённая обводка снаружи знака
    out1 = np.clip(cv2.GaussianBlur(mask, (0, 0), 1.6 * s) - mask, 0, 1)
    core += (out1 * 6.0)[..., None] * GOLD
    out2 = np.clip(cv2.GaussianBlur(mask, (0, 0), 5 * s) - mask, 0, 1)
    core += (out2 * 2.2)[..., None] * ORANGE

    halo = np.zeros((H, W, 3), np.float32)
    halo += (cv2.GaussianBlur(mask, (0, 0), 14 * s) * 1.1)[..., None] * ORANGE
    halo += (cv2.GaussianBlur(mask, (0, 0), 40 * s) * 1.3)[..., None] * ORANGE
    halo += (np.exp(-(rr / (2.0 * R)) ** 2) * 0.22)[..., None] * ORANGE
    halo *= (1.0 - 0.85 * mask)[..., None]  # свечение вокруг знака, а не поверх металла

    # эффекты проходят ЗА знаком: под ним их гасим
    occ = cv2.GaussianBlur(cv2.dilate(m8, np.ones((3, 3), np.uint8), iterations=max(1, round(2 * s))).astype(np.float32), (0, 0), 1.5 * s)
    # туманность вокруг: статичная низкочастотная дымка
    rng = np.random.default_rng(77)
    gy_, gx_ = max(4, round(7 * H / min(W, H))), max(4, round(7 * W / min(W, H)))
    neb = cv2.resize(rng.random((gy_, gx_)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    neb2 = cv2.resize(rng.random((gy_ * 2, gx_ * 2)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    nebula = np.clip(neb * 0.7 + neb2 * 0.3, 0, 1) ** 2 * np.exp(-(rr / (0.9 * ctx.Rmax)) ** 2) * 0.16
    ambient = nebula[..., None] * EMBER
    vign = np.clip(1 - 0.45 * (rr / ctx.Rmax) ** 2.2, 0, 1).astype(np.float32)
    return core.astype(np.float32), halo, occ[..., None], ambient, vign[..., None]


class Dust:
    """Пылинки, плывущие вверх. Все движения периодичны с периодом TOTAL — шва нет."""

    def __init__(self, ctx):
        r = np.random.default_rng(5)
        n = 420
        self.ctx = ctx
        self.x0 = r.uniform(0, ctx.W, n)
        self.y0 = r.uniform(0, ctx.H, n)
        self.k = r.integers(2, 5, n)
        self.kx = r.integers(1, 4, n)
        self.kt = r.integers(20, 60, n)
        self.p1 = r.uniform(0, 6.28, n)
        self.p2 = r.uniform(0, 6.28, n)
        self.br = r.uniform(0.15, 0.6, n)

    def render(self, cv, t):
        c = self.ctx
        ph = t / TOTAL
        y = (self.y0 - self.k * c.H * ph) % c.H
        x = self.x0 + 22 * c.s * np.sin(2 * np.pi * self.kx * ph + self.p1)
        w = self.br * (0.55 + 0.45 * np.sin(2 * np.pi * self.kt * ph + self.p2))
        cv.pts(x, y, w, ORANGE)


# ---------------------------------------------------------------- кадр

_G = {}


def _init(W, H):
    ctx = Ctx(W, H)
    _G["ctx"] = ctx
    _G["scenes"] = [cls(ctx, 1000 + i * 17) for i, cls in enumerate(SCENES)]
    _G["coin"] = coin_layers(ctx)
    _G["dust"] = Dust(ctx)


def active(t):
    out = []
    for i in range(len(SCENES)):
        tl = (t - i * SLOT + XF) % TOTAL
        if tl < SLOT + XF:
            amp = float(smooth(0, XF, tl) * smooth(SLOT + XF, SLOT, tl))
            if amp > 1e-3:
                out.append((i, tl, amp))
    return out


def frame(t):
    ctx = _G["ctx"]
    core, halo, disk, ambient, vign = _G["coin"]
    cv = Canvas(ctx)
    front = Canvas(ctx)
    h = 1.0
    for i, tl, amp in active(t):
        sc = _G["scenes"][i]
        sc.render(cv, tl, amp * sc.gain)
        if hasattr(sc, "render_front"):
            sc.render_front(front, tl, amp * sc.gain)
        h += amp * (sc.halo(tl) - 1.0)
    _G["dust"].render(cv, t)
    E = cv.render()
    E *= 1.0 - 0.95 * disk
    E += ambient + core + halo * h
    if front.px or front.gx or front.fields:
        E += front.render()
    out = (1.0 - np.exp(-E * 1.05)) * vign
    return np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)


def _frame_idx(n):
    return frame(n / FPS).tobytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sheet", help="секунды через запятую: сохранить контрольные кадры одной картинкой")
    ap.add_argument("--seconds", type=float, help="рендерить только первые N секунд")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) - 1))
    ap.add_argument("--crf", type=int, default=24)
    a = ap.parse_args()
    W, H = map(int, a.size.lower().split("x"))

    if a.sheet:
        _init(W, H)
        times = [float(v) for v in a.sheet.split(",")]
        tiles = []
        for t in times:
            img = frame(t)
            tw = 640 if W >= H else 360
            th = int(H * tw / W)
            tiles.append(cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA))
        cols = 3 if W >= H else 5
        while len(tiles) % cols:
            tiles.append(np.zeros_like(tiles[0]))
        rows = [np.concatenate(tiles[i:i + cols], 1) for i in range(0, len(tiles), cols)]
        cv2.imwrite(a.out, cv2.cvtColor(np.concatenate(rows, 0), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
        print(a.out)
        return

    n0 = int(round(a.start * FPS))
    total = int(round((a.seconds if a.seconds else TOTAL) * FPS))
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart",
           "-an", a.out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with Pool(a.jobs, initializer=_init, initargs=(W, H)) as pool:
        for k, buf in enumerate(pool.imap(_frame_idx, range(n0, n0 + total), chunksize=2)):
            ff.stdin.write(buf)
            if k % (FPS * 10) == 0:
                print(f"{k / FPS:6.1f}s / {total / FPS:.1f}s", file=sys.stderr, flush=True)
    ff.stdin.close()
    sys.exit(ff.wait())


if __name__ == "__main__":
    main()
