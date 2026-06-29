# Image Audit Report

Source scanned: `/Users/rytis/Desktop/Dzukai/src/lib/data.ts`

Audit scope:
- All `264` products
- All `66` unique image targets
- URL/path inspection only
- No image downloads, replacements, or UI changes

High-level findings:
- Missing image fields: none found
- Broken local paths: none found
- External URLs checked: `66`
- Broken external URLs: `2`
- Pollinations/AI image URLs: none found
- Duplicate images reused for clearly unrelated dishes: multiple cases found

Validation notes:
- Every product currently points to an external Unsplash URL.
- No product currently uses a local filesystem path.
- No product currently uses a Pollinations URL or other obvious AI image host.

## Suspicious Products

### Broken external URLs

#### Product: `v5`
- product id: `v5`
- product name: `Vištienos filė`
- category: `vistiena`
- current image: `https://images.unsplash.com/photo-1598103442097-8b74394b95c1?w=800&q=80`
- reason why suspicious: external URL currently returns HTTP `404`, so the image is broken
- suggested fix strategy: replace with a working chicken-fillet photo or move this product to a verified local asset

#### Product: `ja3`
- product id: `ja3`
- product name: `Avienos kebabas`
- category: `jautiena`
- current image: `https://images.unsplash.com/photo-1602524205858-0fce8d027b3e?w=800&q=80`
- reason why suspicious: external URL currently returns HTTP `404`, so the image is broken
- suggested fix strategy: replace with a working lamb/kebab image or move this product to a verified local asset

### Duplicate image reused for unrelated dishes

#### Product: `u4`
- product id: `u4`
- product name: `Jautienos karpačio`
- category: `uzkandziai`
- current image: `https://images.unsplash.com/photo-1544025162-d76694265947?w=800&q=80`
- reason why suspicious: this same photo is also used for `ki5` (`Kiaulienos šoninė`), which is a different dish type and category
- suggested fix strategy: split carpaccio and pork-belly imagery so each dish gets a category-appropriate photo

#### Product: `ki5`
- product id: `ki5`
- product name: `Kiaulienos šoninė`
- category: `kiauliena`
- current image: `https://images.unsplash.com/photo-1544025162-d76694265947?w=800&q=80`
- reason why suspicious: shares the exact same image with `u4` (`Jautienos karpačio`), which is unrelated to pork belly
- suggested fix strategy: assign a pork-specific image distinct from beef carpaccio

#### Product: `s4`
- product id: `s4`
- product name: `Salotos su Burrata sūriu ir Serano kumpiu`
- category: `salotos`
- current image: `https://images.unsplash.com/photo-1529059997568-3d847b1154f0?w=800&q=80`
- reason why suspicious: this photo is also used by `v2` (`Vištienos šašlykas`) and `pa5` (`Užkandis su Burrata sūriu`); the chicken skewer reuse is especially mismatched
- suggested fix strategy: keep the image only for burrata-centered dishes and give the chicken шашlyk its own grill/chicken photo

#### Product: `v2`
- product id: `v2`
- product name: `Vištienos šašlykas`
- category: `vistiena`
- current image: `https://images.unsplash.com/photo-1529059997568-3d847b1154f0?w=800&q=80`
- reason why suspicious: same image as burrata salad and burrata snack, which does not match a chicken shashlik dish
- suggested fix strategy: replace with a chicken skewer/grill image

#### Product: `pa5`
- product id: `pa5`
- product name: `Užkandis su Burrata sūriu`
- category: `prie-alaus`
- current image: `https://images.unsplash.com/photo-1529059997568-3d847b1154f0?w=800&q=80`
- reason why suspicious: shares an image with burrata salad and chicken shashlik; the burrata pair is defensible, but the three-way reuse weakens clarity
- suggested fix strategy: keep if burrata-focused, but separate it from the chicken-shashlik image set

#### Product: `pa12`
- product id: `pa12`
- product name: `Traškus jalapeno užkandis (100g)`
- category: `prie-alaus`
- current image: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- reason why suspicious: exact same image is reused across several pizzas (`p3`, `p5`, `pb1`, `pb2`, `pb3`, `pb4`, `pb5`), so the snack currently looks like a pizza
- suggested fix strategy: give jalapeno bites their own snack photo and reserve this asset for pizza-only entries

#### Product: `pa1`
- product id: `pa1`
- product name: `Kepta duona su česnaku`
- category: `prie-alaus`
- current image: `https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80`
- reason why suspicious: same image is also used for `b7`, `b8`, `b9`, `b10` (bulvinės bandos) and `pa2`, `pa15`; garlic bread and potato dishes should not share one generic photo
- suggested fix strategy: separate beer-snack bread imagery from potato-dish imagery

#### Product: `pa15`
- product id: `pa15`
- product name: `Padažas pasirinkti`
- category: `prie-alaus`
- current image: `https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80`
- reason why suspicious: a sauce add-on currently uses the same hero image as garlic bread and potato dishes, which is misleading
- suggested fix strategy: use a neutral sauce/add-on placeholder or remove dedicated imagery for condiment-only items

#### Product: `b7`
- product id: `b7`
- product name: `Bulvinės bandos su spirgučiais ir grietine`
- category: `bulviniai`
- current image: `https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80`
- reason why suspicious: shares an image with garlic bread, cheese bread, and a sauce add-on; this is too broad for a potato dish
- suggested fix strategy: move bulvinės bandos items to a potato-dish-specific image set

#### Product: `b8`
- product id: `b8`
- product name: `Bulvinės bandos su baravykų padažu`
- category: `bulviniai`
- current image: `https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80`
- reason why suspicious: same photo is also used for unrelated beer snacks and a sauce-only product
- suggested fix strategy: replace with an image that clearly reads as a plated potato dish

#### Product: `vm2`
- product id: `vm2`
- product name: `Lietiniai blyneliai su vyšnių padažu`
- category: `vaikiskas`
- current image: `https://images.unsplash.com/photo-1562802378-063ec186a863?w=800&q=80`
- reason why suspicious: exact same image is used for `vm3` (`Traškios vištienos juostelės...`), which is a completely different kids dish
- suggested fix strategy: separate sweet pancake imagery from kids chicken-strip imagery

#### Product: `vm3`
- product id: `vm3`
- product name: `Traškios vištienos juostelės su gruzdintomis bulvytėmis ir šviežiomis daržovėmis`
- category: `vaikiskas`
- current image: `https://images.unsplash.com/photo-1562802378-063ec186a863?w=800&q=80`
- reason why suspicious: shares a photo with kids pancakes, so the current image likely does not represent the dish accurately
- suggested fix strategy: replace with a kids chicken/fry plate image

#### Product: `gg6`
- product id: `gg6`
- product name: `Pilstoma Gira`
- category: `gerimai`
- current image: `https://images.unsplash.com/photo-1608270586620-248524c67de9?w=800&q=80`
- reason why suspicious: this same image is also reused for multiple beers (`al1`, `al3`, `al5`, `al7`) and beer cocktails (`ak1`, `ak2`, `ak4`, `ak5`); gira becomes visually indistinguishable from beer
- suggested fix strategy: give gira its own beverage image distinct from beer taps/glasses

#### Product: `ak3`
- product id: `ak3`
- product name: `Gyvatės kirtis`
- category: `alus-kokteiliai`
- current image: `https://images.unsplash.com/photo-1558642891-54be180ea339?w=800&q=80`
- reason why suspicious: same image is reused for straight cider entries (`sid1`, `sid2`), so a mixed beer-cider cocktail looks identical to a plain cider
- suggested fix strategy: assign a dedicated cocktail image or reserve the current asset for cider-only products

#### Product: `z3`
- product id: `z3`
- product name: `Grilyje keptos krevetės`
- category: `zuvis`
- current image: `https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=800&q=80`
- reason why suspicious: the same photo is also used for `pa11` (`Traškūs kalmarų žiedai`), which is a different seafood snack format
- suggested fix strategy: separate grilled shrimp and fried calamari imagery

#### Product: `pa11`
- product id: `pa11`
- product name: `Traškūs kalmarų žiedai (100g)`
- category: `prie-alaus`
- current image: `https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=800&q=80`
- reason why suspicious: shares a photo with grilled shrimp, so the fried calamari item is not visually specific
- suggested fix strategy: use a fried calamari/snack image instead of a shrimp dish photo

#### Product: `sr1`
- product id: `sr1`
- product name: `Šaltibarščiai`
- category: `sriubos`
- current image: `https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80`
- reason why suspicious: this same soup image is reused for `sr2` and `sr3`; especially for cold pink šaltibarščiai, a generic soup photo is likely misleading
- suggested fix strategy: give signature soups, especially visually distinctive ones, dedicated photos

#### Product: `sr3`
- product id: `sr3`
- product name: `Aštri "Čili" sriuba`
- category: `sriubos`
- current image: `https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80`
- reason why suspicious: shares the same image with `Šaltibarščiai` and `Kopūstienė su baravykais`, despite being a very different chili-style soup
- suggested fix strategy: replace with a spicy chili/soup image or split the soup set by dish type

## Summary by Issue Type

- Broken external URLs:
  - `v5`
  - `ja3`

- No local-path issues found:
  - all product images are external URLs

- No Pollinations/AI URLs found:
  - current dataset uses Unsplash only

- Strongest duplicate-image mismatches:
  - beef carpaccio vs pork belly
  - burrata salad/snack vs chicken shashlik
  - pizza image reused for jalapeno snack
  - potato dishes/garlic bread/sauce add-on sharing one image
  - kids pancakes vs kids chicken strips
  - gira sharing a beer image
  - grilled shrimp vs fried calamari
  - distinct soups sharing one generic soup image
