"""Synthesise the Selagi promo soundtrack (music bed + SFX) with numpy only.
Deterministic: fixed RNG seed. Output: 48 kHz stereo 16-bit WAV."""
import numpy as np, wave, sys

SR = 48000
DUR = 35.5
N = int(SR * DUR)
rng = np.random.default_rng(20261115)
L = np.zeros(N); R = np.zeros(N)

def t_arr(d): return np.arange(int(SR * d)) / SR
def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.ones(n) * s
    if a: e[:a] = np.linspace(0, 1, a)
    if d: e[a:a + d] = np.linspace(1, s, min(d, max(0, n - a)))[:max(0, min(d, n - a))]
    if r and n > r: e[-r:] *= np.linspace(1, 0, r)
    return e
def place(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[:N - i]
    lg = gain * np.cos((pan + 1) * np.pi / 4); rg = gain * np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * lg; R[i:i + len(sig)] += sig * rg
def lowpass(x, cutoff):
    # one-pole low-pass, cutoff may be array
    a = np.exp(-2 * np.pi * np.asarray(cutoff) / SR) * np.ones(len(x))
    y = np.zeros_like(x); prev = 0.0
    for i in range(len(x)):
        prev = (1 - a[i]) * x[i] + a[i] * prev; y[i] = prev
    return y
def lowpass_fast(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    from itertools import accumulate
    # vectorised via scipy-less IIR: use cumulative trick in blocks
    y = np.empty_like(x); prev = 0.0
    for i in range(0, len(x), 4096):
        blk = x[i:i + 4096]; out = np.empty_like(blk)
        for j, v in enumerate(blk):
            prev = (1 - a) * v + a * prev; out[j] = prev
        y[i:i + 4096] = out
    return y
def note(freq, d, wave_="tri", a=0.02, rel=0.3, vib=0.0):
    t = t_arr(d)
    ph = 2 * np.pi * freq * t + (vib * np.sin(2 * np.pi * 5 * t) if vib else 0)
    if wave_ == "sine": s = np.sin(ph)
    elif wave_ == "tri": s = 2 / np.pi * np.arcsin(np.sin(ph))
    else: s = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    return s * env_adsr(len(t), a, 0.1, 0.85, rel)
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)

# ---------- drums ----------
def kick(gain=1.0):
    t = t_arr(0.45); f = 48 + 110 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = rng.standard_normal(len(t)) * np.exp(-t * 300) * 0.25
    return (s + click) * gain
def snare(gain=1.0):
    t = t_arr(0.3); n = rng.standard_normal(len(t))
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.6
    noise = (n - np.concatenate([[0], n[:-1]])) * np.exp(-t * 18) * 0.5
    return (body + noise) * gain
def hat(gain=1.0, d=0.06):
    t = t_arr(d); n = rng.standard_normal(len(t))
    hp = n - np.concatenate([[0], n[:-1]])
    return hp * np.exp(-t * 70) * 0.25 * gain

# ---------- SFX ----------
def whoosh(d=0.8, up=True, gain=1.0):
    t = t_arr(d); n = rng.standard_normal(len(t))
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    cut = (300 + 5000 * (t / d)) if up else (5300 - 5000 * (t / d))
    y = np.zeros_like(n); prev = 0.0
    a = np.exp(-2 * np.pi * cut / SR)
    for i in range(len(n)):
        prev = (1 - a[i]) * n[i] + a[i] * prev; y[i] = prev
    return y * e * 1.6 * gain
def thud(gain=1.0):
    t = t_arr(0.5); f = 70 + 60 * np.exp(-t * 20)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    return (s + rng.standard_normal(len(t)) * np.exp(-t * 60) * 0.3) * gain
def scratch(gain=1.0):
    t = t_arr(0.22); n = rng.standard_normal(len(t))
    hp = n - np.concatenate([[0], n[:-1]])
    return hp * np.sin(np.pi * t / 0.22) * 0.35 * gain
def pop(freq, gain=1.0):
    t = t_arr(0.18)
    s = np.sin(2 * np.pi * freq * t * (1 + 0.4 * np.exp(-t * 40))) * np.exp(-t * 26)
    return s * gain
def chime(root=72, gain=1.0):
    out = np.zeros(int(SR * 2.4))
    for k, m in enumerate([root, root + 4, root + 7, root + 12]):
        t = t_arr(2.4 - k * 0.06)
        s = (np.sin(2 * np.pi * mtof(m) * t) + 0.3 * np.sin(2 * np.pi * mtof(m) * 2.01 * t)) * np.exp(-t * 2.2)
        i = int(k * 0.06 * SR); out[i:i + len(s)] += s * 0.35
    return out * gain

# ---------- music: intro (0-4s) ----------
drone = note(mtof(45), 4.2, "sine", a=1.2, rel=0.8) * 0.18 + note(mtof(52), 4.2, "sine", a=1.6, rel=0.8) * 0.1
place(drone, 0.0, 1.0)
for i in range(16):                      # clock ticks
    place(hat(0.9 if i % 2 == 0 else 0.55, 0.04), 0.25 * i, 0.7, pan=-0.3 if i % 2 else 0.3)

# ---------- music: groove (4.0s - end) ----------
BPM = 100; beat = 60 / BPM; start = 4.0
chords = [  # Am7, Fmaj7, Cmaj7, G6  (MIDI)
    [57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 59, 64], [55, 59, 62, 64]]
bass = [45, 41, 48, 43]
bar = beat * 4
nbars = int((DUR - start) / bar) + 1
pad_bus_L = np.zeros(N); pad_bus_R = np.zeros(N)
for b in range(nbars):
    t0 = start + b * bar
    ch = chords[(b // 2) % 4]; bs = bass[(b // 2) % 4]
    if b % 2 == 0:
        for k, m in enumerate(ch):
            sig = note(mtof(m), bar * 2, "tri", a=0.35, rel=0.9, vib=0.003) * 0.075
            i = int(t0 * SR); sig = sig[:max(0, N - i)]
            pan = [-0.5, -0.15, 0.15, 0.5][k]
            pad_bus_L[i:i + len(sig)] += sig * np.cos((pan + 1) * np.pi / 4)
            pad_bus_R[i:i + len(sig)] += sig * np.sin((pan + 1) * np.pi / 4)
    for q in range(4):
        tb = t0 + q * beat
        if tb >= DUR - 1.6: continue
        if q in (0, 2): place(kick(1.0), tb, 0.55)
        if q in (1, 3): place(snare(1.0), tb, 0.22)
        place(hat(1.0), tb + beat / 2, 0.35, pan=0.25)
        place(hat(0.6), tb, 0.25, pan=-0.25)
        place(note(mtof(bs), beat * 0.9, "warm", a=0.01, rel=0.15) * 0.16, tb if q != 3 else tb + beat / 2, 1.0)
# sidechain-ish pump on the pad
pump = np.ones(N)
for b in range(nbars * 4):
    tb = start + b * beat
    if b % 2 == 0:
        i = int(tb * SR); n_ = int(0.32 * SR)
        if i < N: pump[i:i + n_] = np.minimum(pump[i:i + n_], np.linspace(0.45, 1, min(n_, N - i)))
L += pad_bus_L * pump; R += pad_bus_R * pump
# final chord ring-out
fin = sum(note(mtof(m), 3.2, "tri", a=0.05, rel=2.5) for m in [57, 60, 64, 69, 72]) * 0.06
place(fin, DUR - 3.3, 1.0)

# ---------- SFX timeline (seconds match index.html) ----------
for k, t in enumerate([1.45, 2.0, 2.55]):
    place(thud(1.0), t, 0.75); place(scratch(1.0), t + 0.28, 0.45, pan=0.2)
place(whoosh(0.9, up=False), 3.3, 0.35)
place(whoosh(0.95, up=True), 3.95, 0.5)
place(thud(1.0), 4.85, 0.55)
place(chime(76), 5.2, 0.35)
place(whoosh(0.5, up=True), 5.7, 0.18, pan=0.4)
place(whoosh(0.75, up=True), 7.95, 0.4)
for k in range(10):
    place(pop(mtof(72 + [0, 2, 4, 5, 7, 9, 11, 12, 14, 16][k]), 1.0), 9.35 + k * 0.17, 0.32, pan=-0.6 + k * 0.13)
place(chime(79), 11.25, 0.4)
place(whoosh(1.0, up=True), 12.2, 0.4)
place(whoosh(0.6, up=True), 14.35, 0.35)
for k in range(4):
    place(pop(mtof(84), 1.0), 14.85 + k * 3.0, 0.22); place(whoosh(0.45, up=True), 14.85 + k * 3.0 + 0.1, 0.12)
place(whoosh(0.6, up=True), 26.65, 0.35)
place(thud(1.0), 27.8, 0.45); place(chime(72), 27.8, 0.25)
place(whoosh(0.95, up=True), 30.25, 0.45)
place(chime(76), 32.3, 0.4)
place(pop(mtof(79), 1.0), 32.4, 0.3)

# ---------- master: light reverb, fade, normalise ----------
ir_len = int(SR * 1.1); tir = np.arange(ir_len) / SR
ir = rng.standard_normal(ir_len) * np.exp(-tir * 4.5); ir[0] = 0; ir /= np.sqrt(np.sum(ir ** 2))
def fftconv(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[:len(x)]
L = L + 0.12 * fftconv(L, ir); R = R + 0.12 * fftconv(R, ir[::-1].copy())
fade = np.ones(N); fl = int(SR * 1.6); fade[-fl:] = np.linspace(1, 0, fl) ** 1.5
fi = int(SR * 0.08); fade[:fi] = np.linspace(0, 1, fi)
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L = np.tanh(L / peak * 1.15) * 0.89; R = np.tanh(R / peak * 1.15) * 0.89
st = np.empty(N * 2); st[0::2] = L; st[1::2] = R
pcm = (st * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", sys.argv[1], f"{DUR}s")
