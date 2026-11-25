#!/usr/bin/env python3
"""Живые обои «Биткоин-шоу» для темы «Оранжевая».

Монета ₿ в центре — один неподвижный слой, одинаковый во всех кадрах. Вокруг неё
по очереди сменяются эффекты (вихрь, салют, молнии, пульс, протуберанцы,
гиперпрыжок, орбиты, блокчейн-сеть, пламя), соседние сцены плавно перетекают.

Кадр — чистая функция времени: рендер идёт параллельно, а длина ролика кратна
периоду фона, поэтому последний кадр стыкуется с первым без шва.

  python3 btc_show.py --size 1920x1080 --out ember-show.mp4
  python3 btc_show.py --size 1080x1920 --out ember-show-tall.mp4
  python3 btc_show.py --size 1920x1080 --sheet 3,16,29 --out sheet.jpg   # контрольные кадры
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
FONT = "/System/Library/Fonts/SFNS.ttf"

ORANGE = np.array([1.0, 0.42, 0.08], np.float32)
GOLD = np.array([1.0, 0.62, 0.20], np.float32)
HOT = np.array([1.0, 0.80, 0.52], np.float32)
RED = np.array([1.0, 0.24, 0.04], np.float32)
EMBER = np.array([0.85, 0.16, 0.02], np.float32)


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
    gain = 2.0
    name = "lightning"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        self.bolts = []
        t = 0.2
        while t < self.dur() - 0.6:
            group = 3 if r.random() < 0.12 else 1
            for _ in range(group):
                a = r.uniform(0, 2 * np.pi)
                p0 = (c.cx + np.cos(a) * c.R * 1.02, c.cy + np.sin(a) * c.R * 1.02)
                a2 = a + r.normal(0, 0.35)
                dist = r.uniform(0.75, 1.15) * c.Rmax
                p1 = (c.cx + np.cos(a2) * dist, c.cy + np.sin(a2) * dist)
                main = bolt_path(r, p0, p1, 8, 0.16)
                segs = [(main, 1.0)]
                for _ in range(int(r.integers(2, 6))):
                    i0 = int(r.integers(len(main) // 6, len(main) * 3 // 4))
                    q0 = main[i0]
                    d = main[min(i0 + 8, len(main) - 1)] - q0
                    ang = math.atan2(d[1], d[0]) + r.choice([-1, 1]) * r.uniform(0.35, 0.9)
                    ln = r.uniform(0.15, 0.4) * dist
                    br = bolt_path(r, q0, (q0[0] + math.cos(ang) * ln, q0[1] + math.sin(ang) * ln), 6, 0.18)
                    segs.append((br, 0.45))
                    if r.random() < 0.5:
                        j0 = int(r.integers(len(br) // 4, len(br) * 3 // 4))
                        ang2 = ang + r.choice([-1, 1]) * r.uniform(0.3, 0.8)
                        ln2 = ln * r.uniform(0.3, 0.55)
                        q1 = br[j0]
                        segs.append((bolt_path(r, q1, (q1[0] + math.cos(ang2) * ln2, q1[1] + math.sin(ang2) * ln2), 5, 0.2), 0.25))
                restr = [(0.0, 1.0)] + [(r.uniform(0.07, 0.3), r.uniform(0.5, 0.9)) for _ in range(int(r.integers(1, 3)))]
                self.bolts.append((t + r.uniform(0, 0.05), segs, restr, p0))
            t += r.uniform(0.1, 0.28) * (2.0 if group > 1 else 1.0)

    @staticmethod
    def _intensity(tau, restr):
        if tau < 0 or tau > 0.6:
            return 0.0
        return sum(k * math.exp(-(tau - t0) / 0.07) for t0, k in restr if tau >= t0)

    def render(self, cv, t, amp):
        c = self.ctx
        for t0, segs, restr, p0 in self.bolts:
            I = self._intensity(t - t0, restr)
            if I < 0.02:
                continue
            for P, k in segs:
                cv.poly(P, amp * I * k * 3.0, HOT, step=0.6)
                cv.glow(P[::3, 0], P[::3, 1], amp * I * k * 6.0, ORANGE)
                if k == 1.0:
                    cv.poly(P + 1.2, amp * I * 1.4, GOLD, step=0.8)
                    cv.poly(P - 1.2, amp * I * 1.4, GOLD, step=0.8)
            cv.glow(p0[0], p0[1], amp * I * 30, GOLD)
            cv.glow(c.cx, c.cy, amp * I * 25, ORANGE)
        # потрескивание по кромке монеты
        win = math.floor(t / 0.07)
        rr = np.random.default_rng(10_000 + win)
        for _ in range(6):
            a = rr.uniform(0, 2 * np.pi)
            da = rr.uniform(0.25, 0.6)
            angs = np.linspace(a, a + da, 9)
            rad = c.R * (1.03 + 0.08 * np.sin(np.linspace(0, np.pi, 9)) * rr.uniform(0.5, 1.5))
            pts = np.stack([c.cx + rad * np.cos(angs), c.cy + rad * np.sin(angs)], 1)
            P = bolt_path(rr, pts[0], pts[-1], 4, 0.12)
            bend = np.interp(np.linspace(0, 1, len(P)), np.linspace(0, 1, 9), rad / c.R - 1.0)
            dirs = P - [c.cx, c.cy]
            dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
            P = P + dirs * bend[:, None] * c.R
            cv.poly(P, amp * 0.9, GOLD, step=0.7)

    def halo(self, t):
        I = sum(self._intensity(t - t0, restr) for t0, _, restr, _ in self.bolts)
        return 1.0 + 0.35 * min(I, 2.0)


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


class Warp(Scene):
    gain = 1.5
    name = "warp"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        self.N = 1900
        self.phi = r.uniform(0, 2 * np.pi, self.N)
        self.z0 = r.random(self.N)
        self.br = r.uniform(0.4, 1.0, self.N)
        self.hot = r.random(self.N) < 0.25
        dt = 1 / 480
        self.grid = np.arange(0, self.dur() + 1, dt)
        v = 0.10 + 0.55 * np.sin(np.pi * np.clip(self.grid / self.dur(), 0, 1)) ** 2
        self.P = np.cumsum(v) * dt
        self.v = v

    def _r(self, p):
        c = self.ctx
        zmin = 0.035
        z = 1 - (p % 1.0) * (1 - zmin)
        F = (c.Rmax * 1.25 - c.R) / (1 / zmin - 1)
        return c.R * 1.05 + F * (1 / z - 1)

    def render(self, cv, t, amp):
        c = self.ctx
        P = np.interp(t, self.grid, self.P)
        v = np.interp(t, self.grid, self.v)
        pb = self.z0 + P
        pa = pb - v * 0.045
        ok = np.floor(pa) == np.floor(pb)
        ra, rb = self._r(pa), self._r(pb)
        cos, sin = np.cos(self.phi), np.sin(self.phi)
        prog = pb % 1.0
        w = amp * self.br * (0.15 + 1.1 * prog ** 2) * ok
        col = np.where(self.hot[:, None], HOT, ORANGE)
        cv.segs(c.cx + ra * cos, c.cy + ra * sin, c.cx + rb * cos, c.cy + rb * sin, w * 0.8, col, step=1.0)
        cv.pts(c.cx + rb * cos, c.cy + rb * sin, w * 0.8, HOT)
        # тоннель: кольца уходят от монеты наружу
        for k in range(6):
            p = (k / 6 + P * 0.7) % 1.0
            rr = self._r(p * 0.93)
            n = int(2 * np.pi * rr / 2.0)
            th = np.linspace(0, 2 * np.pi, n, endpoint=False)
            cv.pts(c.cx + rr * np.cos(th), c.cy + rr * np.sin(th), amp * 0.5 * p * (1 - p) * v, ORANGE)

    def halo(self, t):
        return 1.0 + 0.4 * float(np.interp(t, self.grid, self.v))


class Orbits(Scene):
    gain = 2.8
    name = "orbits"

    def __init__(self, ctx, seed):
        super().__init__(ctx, seed)
        r = self.rng
        c = ctx
        self.orbits = []
        for i, k in enumerate((1.55, 2.05, 2.65, 3.3)):
            a = c.R * k * c.ex
            self.orbits.append(dict(a=a, b=a * r.uniform(0.26, 0.42), psi=r.uniform(0, np.pi), w=1.5 * (1.55 / k) ** 1.5 * r.choice([-1, 1]),
                                    th0=r.uniform(0, 2 * np.pi), col=HOT if i % 2 else GOLD))
        self.dust = r.normal(0, 1, (2, 400))

    def _pos(self, O, th):
        c = self.ctx
        x, y = O["a"] * np.cos(th), O["b"] * np.sin(th)
        cp, sp = math.cos(O["psi"]), math.sin(O["psi"])
        return c.cx + x * cp - y * sp, c.cy + x * sp + y * cp, np.sin(th)

    def render(self, cv, t, amp):
        th_all = np.linspace(0, 2 * np.pi, 900)
        for O in self.orbits:
            x, y, z = self._pos(O, th_all)
            shimmer = 0.5 + 0.5 * np.cos(th_all * 3 - t * 1.3)
            cv.poly(np.stack([x, y], 1), amp * 0.06 * (0.6 + 0.4 * z) * shimmer, ORANGE)
            for k in (0, 2 * np.pi / 3, 4 * np.pi / 3):
                lags = np.linspace(0, 1.5, 110)
                th = O["th0"] + k + O["w"] * (t - lags)
                x, y, z = self._pos(O, th)
                depth = 0.6 + 0.4 * (z[0] > 0)
                wt = amp * depth * (1 - lags / 1.5) ** 1.6 * 1.4
                cv.poly(np.stack([x, y], 1), wt, O["col"])
                cv.glow(x[0], y[0], amp * depth * 12, O["col"])
                cv.pts(x[0], y[0], amp * depth * 6, HOT)
                # пыль, которую комета роняет за собой
                ages = np.arange(0, 1.2, 0.006)
                te = np.floor((t - ages) / 0.006) * 0.006
                age = t - te
                idx = (np.floor(te / 0.006).astype(np.int64) * 7 + int(k * 3)) % 400
                xe, ye, _ = self._pos(O, O["th0"] + k + O["w"] * te)
                xe = xe + self.dust[0, idx] * 30 * age * self.ctx.s
                ye = ye + self.dust[1, idx] * 30 * age * self.ctx.s + 12 * age ** 2 * self.ctx.s
                cv.pts(xe, ye, amp * 0.45 * (1 - age / 1.2) ** 2, GOLD)


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


SCENES = [Vortex, Fireworks, Lightning, Heartbeat, Plasma, Warp, Orbits, Network, Flame]
TOTAL = SLOT * len(SCENES)


# ---------------------------------------------------------------- монета и фон

def coin_layers(ctx):
    W, H, s, R = ctx.W, ctx.H, ctx.s, ctx.R
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.hypot(xx + 0.5 - ctx.cx, yy + 0.5 - ctx.cy)

    ss = 4
    size = int(R * 1.55 * ss)
    font = ImageFont.truetype(FONT, size)
    font.set_variation_by_name(b"Bold")
    box = font.getbbox("₿")
    gw, gh = box[2] - box[0], box[3] - box[1]
    img = Image.new("L", (W * ss, H * ss), 0)
    ImageDraw.Draw(img).text((ctx.cx * ss - gw / 2 - box[0], ctx.cy * ss - gh / 2 - box[1]), "₿", font=font, fill=255)
    img = img.rotate(-12, resample=Image.BICUBIC, center=(ctx.cx * ss, ctx.cy * ss))
    mask = np.asarray(img.resize((W, H), Image.LANCZOS), np.float32) / 255.0
    inside = cv2.distanceTransform((mask > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    bevel = np.clip(inside / (7 * s), 0, 1)

    core = np.zeros((H, W, 3), np.float32)
    core += (mask * (2.6 + 9.0 * bevel))[..., None] * np.array([1.0, 0.55, 0.2], np.float32)
    g1 = cv2.GaussianBlur(mask, (0, 0), 5 * s)
    core += (g1 * 2.2)[..., None] * ORANGE
    # кольцо монеты: тонкая раскалённая кромка + мягкая полоса
    ring = np.exp(-((rr - R) / (2.6 * s)) ** 2) * 4.2 + np.exp(-((rr - R) / (11 * s)) ** 2) * 0.9
    ang = np.arctan2(yy - ctx.cy, xx - ctx.cx)
    tex = 0.8 + 0.12 * np.sin(5 * ang + 1.3) + 0.08 * np.sin(13 * ang + 0.4) + 0.05 * np.sin(29 * ang + 2.0)
    core += (ring * tex)[..., None] * GOLD
    inner = np.exp(-((rr - R * 0.86) / (2.0 * s)) ** 2) * 0.9
    core += inner[..., None] * ORANGE
    body = smooth(R * 0.99, R * 0.9, rr) * (0.18 + 0.35 * (rr / R) ** 3)
    core += body[..., None] * ORANGE

    halo = np.zeros((H, W, 3), np.float32)
    halo += (np.exp(-np.maximum(rr - R, 0) / (0.28 * R)) * smooth(R * 0.9, R * 1.02, rr) * 1.1)[..., None] * ORANGE
    halo += (np.exp(-(rr / (2.2 * R)) ** 2) * 0.2)[..., None] * ORANGE
    halo += (cv2.GaussianBlur(mask, (0, 0), 22 * s) * 1.4)[..., None] * ORANGE

    disk = smooth(R * 1.0, R * 0.9, rr).astype(np.float32)
    # туманность вокруг: статичная низкочастотная дымка
    rng = np.random.default_rng(77)
    gy, gx = max(4, round(7 * H / min(W, H))), max(4, round(7 * W / min(W, H)))
    neb = cv2.resize(rng.random((gy, gx)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    neb2 = cv2.resize(rng.random((gy * 2, gx * 2)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    nebula = np.clip(neb * 0.7 + neb2 * 0.3, 0, 1) ** 2 * np.exp(-(rr / (0.9 * ctx.Rmax)) ** 2) * 0.16
    ambient = nebula[..., None] * EMBER
    vign = np.clip(1 - 0.45 * (rr / ctx.Rmax) ** 2.2, 0, 1).astype(np.float32)
    return core, halo, disk[..., None], ambient, vign[..., None]


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
    h = 1.0
    for i, tl, amp in active(t):
        sc = _G["scenes"][i]
        sc.render(cv, tl, amp * sc.gain)
        h += amp * (sc.halo(tl) - 1.0)
    _G["dust"].render(cv, t)
    E = cv.render()
    E *= 1.0 - 0.9 * disk
    E += ambient + core + halo * h
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
