# Menu Image Fix Report

Scope:
- Reviewed all products in `src/lib/data.ts`
- Replaced the clearly wrong food images first, prioritizing cases where the image depicted the wrong dish family
- Saved generated replacements to `public/images/menu/`
- Wired local replacements through `src/lib/image-manifest.ts`

## Corrected

- `b1` Didžkukuliai su mėsa
- `b2` Apkepinti didžkukuliai
- `b3` Žemaičių blynai
- `b4` Bulviniai blynai
- `b5` Bulviniai blynai su varške ir šonine
- `b6` Bulviniai blynai su varške ir lašiša
- `b7` Bulvinės bandos su spirgučiais ir grietine
- `b8` Bulvinės bandos su baravykų padažu
- `b9` Bulvinės bandos su varške ir šonine
- `b10` Bulvinės bandos su varške ir lašiša
- `sr2` Kopūstienė su baravykais
- `k4` Gyoza koldūnai su aviena
- `w5` Wok ryžiai su vištiena
- `w6` Wok ryžiai su jautiena
- `w7` Wok ryžiai su antiena
- `w8` Wok ryžiai su jūros gėrybėmis
- `v6` Glazūruota vištienos filė
- `ki9` BBQ glazūruoti kiaulienos šonkauliai
- `ja4` Ėrienos karka su traiškyta bulve ir raugintais kopūstais
- `z1` Skumbrė
- `z5` Lašišos kepsnys
- `z6` Tuno kepsnys
- `pa14` Traškios sūrio spurgytės (200g)
- `d4` Morengų pyragas Pavlova
- `d8` Citrininis šerbetas
- `d9` Kokosiniai ledai

## Generated

All corrected items above were regenerated locally and saved as project assets:

- `public/images/menu/b1.png`
- `public/images/menu/b2.png`
- `public/images/menu/b3.png`
- `public/images/menu/b4.png`
- `public/images/menu/b5.png`
- `public/images/menu/b6.png`
- `public/images/menu/b7.png`
- `public/images/menu/b8.png`
- `public/images/menu/b9.png`
- `public/images/menu/b10.png`
- `public/images/menu/sr2.png`
- `public/images/menu/k4.png`
- `public/images/menu/w5.png`
- `public/images/menu/w6.png`
- `public/images/menu/w7.png`
- `public/images/menu/w8.png`
- `public/images/menu/v6.png`
- `public/images/menu/ki9.png`
- `public/images/menu/ja4.png`
- `public/images/menu/z1.png`
- `public/images/menu/z5.png`
- `public/images/menu/z6.png`
- `public/images/menu/pa14.png`
- `public/images/menu/d4.png`
- `public/images/menu/d8.png`
- `public/images/menu/d9.png`

## Already Correct

All remaining products not listed under `Corrected` were kept on their existing image paths after the stricter pass.

## Remaining

- Remaining products needing image changes after this pass: `0`
