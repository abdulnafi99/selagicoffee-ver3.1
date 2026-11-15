# Video Promosi — Loyalty Digital (HyperFrames)

Video motion typography 35.5 saat (1080×1920, 9:16) untuk mempromosikan kad kesetiaan digital kepada kedai lain.

## Babak
| Masa | Babak | Isi |
|---|---|---|
| 0 – 4.4s | Hook | "Kad cap kertas?" → Hilang. Lupa bawa. Koyak. (dipangkah) |
| 4 – 8.2s | Reveal | "Masa untuk **LOYALTY DIGITAL**" |
| 8 – 14.6s | Demo kad | 10 cap terisi → "10 cap = kopi percuma" → kad berpusing → QR |
| 14.4 – 26.9s | Ciri | 01 Cap & point automatik · 02 Tuntut dengan PIN · 03 Notifikasi · 04 Pasang tanpa App Store |
| 26.7 – 30.5s | Manfaat | "Pelanggan datang balik." |
| 30.3 – 35.5s | CTA | Logo + "Jom digitalkan kad kesetiaan kedai anda." + butang |

Muzik dan kesan bunyi disintesis sendiri (`assets/audio/soundtrack.mp3`), bebas hak cipta.

## Tukar teks CTA / nama kedai tanpa edit kod
```bash
npx hyperframes render -o promo.mp4 --variables '{"cta":"WhatsApp 012-345 6789","shopName":"Selagi Coffee"}'
```

## Pratonton & render
Jalankan dari folder `promo-video/`:
```bash
npx hyperframes preview --background   # buka studio pratonton
npm run check                          # semakan layout, kontras, masa bacaan
npm run render                         # render MP4
```
Perlukan Node.js 22+, FFmpeg dan Chrome.

## Fail
- `selagi-loyalty-promo.mp4` — video siap (35.5s, 1080×1920, H.264 + AAC)
- `index.html` — komposisi (semua babak + timeline GSAP)
- `assets/` — logo, fon (Cormorant Garamond, Manrope), GSAP, soundtrack
- `tools/synth_soundtrack.py` — jana semula muzik & kesan bunyi (Python + numpy):
  `python3 tools/synth_soundtrack.py soundtrack.wav && ffmpeg -i soundtrack.wav -b:a 192k assets/audio/soundtrack.mp3`
