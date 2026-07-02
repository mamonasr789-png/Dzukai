# Final Image Fix Report

Scope:
- Implemented only the high-confidence `MISMATCH` items from `scripts/image-strict-mismatch-report.md`
- Left every `UNCERTAIN` item untouched
- Kept product ids, names, descriptions, prices, and categories unchanged
- Updated image references only through `src/lib/image-manifest.ts`

## Fixed Products

All fixed products use `generated` local assets saved under `public/images/menu/` and routed through the existing manifest pipeline.

- `ki3` — `Aštrus kiaulienos šašlykas`
  - image source: `generated`
  - final image: `/images/menu/ki3.png`
  - verification: grilled pork skewers with visible chili heat cues; no longer reads as a generic mixed platter

- `ki4` — `Kaukazietiškas kiaulienos šašlykas`
  - image source: `generated`
  - final image: `/images/menu/ki4.png`
  - verification: grilled pork skewers with onions and herbs; reads as a traditional shashlik rather than a mixed grill board

- `pa6` — `Užkandėlė prie vyno`
  - image source: `generated`
  - final image: `/images/menu/pa6.png`
  - verification: cheese, cured ham, fruit, nuts, and crackers are all visually supported

- `pa7` — `Šiltų užkandžių padėklas`
  - image source: `generated`
  - final image: `/images/menu/pa7.png`
  - verification: warm shareable snack platter with beer-food cues, distinct from grill mains

- `pa8` — `Užkanda prie alaus (2 asmenims)`
  - image source: `generated`
  - final image: `/images/menu/pa8.png`
  - verification: compact two-person beer snack platter with bread, fried snacks, and sauces

- `pa9` — `Užkanda prie alaus (4 asmenims)`
  - image source: `generated`
  - final image: `/images/menu/pa9.png`
  - verification: visibly larger shareable beer snack platter than `pa8`

- `p19` — `Su tuno filė`
  - image source: `generated`
  - final image: `/images/menu/p19.png`
  - verification: tuna, red onion, and capers are clearly visible; no salami or pepperoni cues remain

- `vm1` — `Gruzdintos bulvytės su pomidorų padažu`
  - image source: `generated`
  - final image: `/images/menu/vm1.png`
  - verification: simple fries with ketchup only; no overlap with onion rings or mozzarella sticks

- `pa10` — `Skrudintos mocarelos lazdelės (100g)`
  - image source: `generated`
  - final image: `/images/menu/pa10.png`
  - verification: breaded mozzarella sticks with marinara; cheese-pull cue matches the dish

- `pa13` — `Traškūs svogūnų žiedai (100g)`
  - image source: `generated`
  - final image: `/images/menu/pa13.png`
  - verification: onion rings are visually obvious and no longer confused with fries or cheese sticks

## Remaining Mismatches

These were left unchanged in this pass because the instruction was to implement only the high-confidence mismatches.

- `gr4` — `Grilinių patiekalų ir bulvinių patiekalų padėklas (4 asmenims)`
  - status: unchanged
  - reason: marked `MISMATCH` in the strict audit, but confidence was `medium`, not high

## Remaining Uncertain Items

These were intentionally not changed in this pass:

- `gr1` — `Grilinių patiekalų padėklas Nr. 1 (6 asmenims)`
- `gr2` — `Grilinių patiekalų padėklas Nr. 2 (6 asmenims)`
- `p1` — `Margarita`
- `p2` — `Vaikiška pica`
- `p4` — `Perlenkta`
- `p12` — `Su vištiena ir pievagrybiais`
- `p13` — `Su saulėje džiovintais pomidorais`
- `p18` — `Su vytintu kumpiu`
- `p21` — `Su kumpiu ir pievagrybiais`
- `p3` — `Keturių sūrių`
- `p5` — `Vegetariška`
- `pb1` — `Pica Panouzzo`
- `pb2` — `Su vištiena ir kariu`
- `pb3` — `Vegetariška Bianca pica`
- `pb4` — `Su vytintu kumpiu ir karamelizuotais svogūnais`
- `pb5` — `Su kumpeliu ir triufelių padažu`
- `p10` — `Su šonine ir svogūnais`
- `p11` — `Su faršu`
- `p14` — `Su kumpiu ir šonine`
- `p17` — `Su plėšyta jautiena`
- `p20` — `Su traškia šonine`
- `p22` — `Pica mėsos mėgėjams`
- `p23` — `Su faršu ir kaparėliais`
- `p8` — `Su saliamiu ir Chalapos pipirais`
- `p9` — `Su saliamiu ir pievagrybiais`
- `p15` — `Su Pepperoni`
- `p16` — `Su Pepperoni aštri`
- `ki1` — `BBQ glazūruotos kiaulienos šoninės juostelės`
- `ki5` — `Kiaulienos šoninė`
- `ki6` — `Kiaulienos išpjova`
- `ki7` — `Kiaulienos sprandinės kepsnys`
- `ki10` — `Lėtai kepta traški kiauliena Porchetta`
- `w1` — `Wok makaronai su vištiena`
- `w2` — `Wok makaronai su jautiena`
- `w3` — `Wok makaronai su antiena`
- `w4` — `Wok makaronai su jūros gėrybėmis`
- `u1` — `Silkė su marinuotais svogūnais ir karštomis bulvėmis`
- `u2` — `Silkė su keptomis daržovėmis`
- `u3` — `Silkė su miško grybais ir bulvėmis`
- `k1` — `Koldūnai su varške ir špinatais`
- `k2` — `Koldūnai su vištiena ir pievagrybiais`
- `k3` — `Koldūnai su aviena`
- `ki8` — `Kiaulienos Tomahawk`
- `ja1` — `Jautienos antrekotas (Argentina)`
- `ja2` — `Jautienos antrekotas Surf and Turf`
- `s2` — `Cezario salotos su grilyje kepta vištiena`
- `s3` — `Cezario salotos su krevetėmis`
