# Strict Image Mismatch Report

Source scanned: `/Users/rytis/Desktop/Dzukai/src/lib/data.ts`

Scope:
- Strict visual mismatch audit only
- No product data changed
- No image URLs changed
- No images generated

Audit labels:
- `MISMATCH`: the current image is very likely showing the wrong dish, wrong dish type, or a cross-category photo reuse that will mislead customers
- `UNCERTAIN`: the image may be broadly related, but the same asset is reused too widely to trust it as an exact match

Recommended fix types:
- `REAL_URL`: replace with a verified real photo URL
- `GENERATED_LOCAL`: generate a dish-specific local image if a reliable real photo is hard to source
- `MANUAL_REVIEW`: inspect visually before replacing

## MISMATCH

### `gr4`
- product id: `gr4`
- product name: `Grilinių patiekalų ir bulvinių patiekalų padėklas (4 asmenims)`
- description: `Grilinių mėsos ir bulvinių patiekalų rinkinys 4 asmenims.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `MISMATCH` - the same image is reused for grill platters, pork shashlik, and beer-snack platters; this item explicitly includes potato dishes, but the shared hero image does not reliably communicate that mixed grill-plus-potato composition
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki3`
- product id: `ki3`
- product name: `Aštrus kiaulienos šašlykas`
- description: `Aitraus marinato kiaulienos šašlykas ant grotelių.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `MISMATCH` - an individual pork shashlik uses the same image as large mixed platters and beer-snack boards; that is too generic for a skewer-style grilled pork dish
- confidence: `high`
- recommended fix type: `REAL_URL`

### `ki4`
- product id: `ki4`
- product name: `Kaukazietiškas kiaulienos šašlykas`
- description: `Tradicinių Kaukazo prieskonių marinato kiaulienos šašlykas.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `MISMATCH` - same issue as `ki3`: the image reads as a generic mixed grill/platter rather than a distinct Caucasian-style pork shashlik
- confidence: `high`
- recommended fix type: `REAL_URL`

### `pa7`
- product id: `pa7`
- product name: `Šiltų užkandžių padėklas`
- description: `Asortimentas šiltų užkandžių puikiai tinkantis prie alaus.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `MISMATCH` - the same image is also used for pork shashlik and grill mains; a warm beer-snack assortment should not be visually identical to full grilled meat dishes
- confidence: `high`
- recommended fix type: `REAL_URL`

### `pa8`
- product id: `pa8`
- product name: `Užkanda prie alaus (2 asmenims)`
- description: `Rinktinių užkandžių rinkinys 2 asmenims prie alaus.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `MISMATCH` - currently indistinguishable from grill platters and pork shashlik because all reuse the same image
- confidence: `high`
- recommended fix type: `REAL_URL`

### `pa9`
- product id: `pa9`
- product name: `Užkanda prie alaus (4 asmenims)`
- description: `Rinktinių užkandžių rinkinys 4 asmenims prie alaus.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `MISMATCH` - currently indistinguishable from grill platters and pork shashlik because all reuse the same image
- confidence: `high`
- recommended fix type: `REAL_URL`

### `p19`
- product id: `p19`
- product name: `Su tuno filė`
- description: `Pica su tuno filė, raudonaisiais svogūnais ir kaparėliais.`
- current image path/url: `https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80`
- problem: `MISMATCH` - this tuna pizza shares the same image as salami and pepperoni pizzas; tuna, red onion, and capers should not read like a cured-meat pizza
- confidence: `high`
- recommended fix type: `REAL_URL`

### `pa6`
- product id: `pa6`
- product name: `Užkandėlė prie vyno`
- description: `Įvairių sūrių, kumpio ir šviežių vaisių lėkštė.`
- current image path/url: `https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=800&q=80`
- problem: `MISMATCH` - this wine snack plate shares an image with baked Camembert; a mixed cheese-charcuterie-fruit board should not look like a single melted cheese dish
- confidence: `high`
- recommended fix type: `REAL_URL`

### `vm1`
- product id: `vm1`
- product name: `Gruzdintos bulvytės su pomidorų padažu`
- description: `Auksinės traškios bulvytės su kečupu.`
- current image path/url: `https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80`
- problem: `MISMATCH` - the same image is reused for mozzarella sticks and onion rings; fries should not be visually interchangeable with breaded cheese sticks and ring-shaped onion snacks
- confidence: `high`
- recommended fix type: `REAL_URL`

### `pa10`
- product id: `pa10`
- product name: `Skrudintos mocarelos lazdelės (100g)`
- description: `Traškios mocarelos lazdelės su marinara padažu.`
- current image path/url: `https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80`
- problem: `MISMATCH` - shares one image with fries and onion rings; mozzarella sticks need a clearly cheese-stick-specific photo
- confidence: `high`
- recommended fix type: `REAL_URL`

### `pa13`
- product id: `pa13`
- product name: `Traškūs svogūnų žiedai (100g)`
- description: `Auksiniai svogūnų žiedai su rančo padažu.`
- current image path/url: `https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80`
- problem: `MISMATCH` - shares one image with fries and mozzarella sticks; onion rings should be visually obvious and not depend on a generic fried-snack image
- confidence: `high`
- recommended fix type: `REAL_URL`

## UNCERTAIN

### `gr1`
- product id: `gr1`
- product name: `Grilinių patiekalų padėklas Nr. 1 (6 asmenims)`
- description: `Išsamus grilinių patiekalų rinkinys 6 asmenims su mišria mėsa ir garnyru.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `UNCERTAIN` - the image may fit a mixed grill platter, but it is reused across eight different products, including pork shashlik and beer-snack platters
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `gr2`
- product id: `gr2`
- product name: `Grilinių patiekalų padėklas Nr. 2 (6 asmenims)`
- description: `Alternatyvus grilinių patiekalų rinkinys 6 asmenims.`
- current image path/url: `https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80`
- problem: `UNCERTAIN` - likely in the right family, but the same image is reused too broadly to trust it as an exact platter match
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p1`
- product id: `p1`
- product name: `Margarita`
- description: `Klasikinė pica su pomidorų padažu, mocarela ir šviežiu baziliku. Tešla rauginama 24 val.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - the same pizza photo is reused across seven pizzas with different toppings and formats, so this entry is not visually exact
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p2`
- product id: `p2`
- product name: `Vaikiška pica`
- description: `Lengva pica vaikams su pomidorų padažu ir mocarela.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across multiple adult pizzas; not a trustworthy exact match for a child-focused pizza
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p4`
- product id: `p4`
- product name: `Perlenkta`
- description: `Sulankstytos tešlos pica su klasikiniu įdaru.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - folded pizza format shares the same image as standard round pizzas
- confidence: `high`
- recommended fix type: `REAL_URL`

### `p12`
- product id: `p12`
- product name: `Su vištiena ir pievagrybiais`
- description: `Lengva pica su vištiena ir pievagrybiais.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across multiple pizzas with visibly different topping profiles
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p13`
- product id: `p13`
- product name: `Su saulėje džiovintais pomidorais`
- description: `Pica su saulėje džiovintais pomidorais ir parmezanu.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across pizzas with different topping sets
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p18`
- product id: `p18`
- product name: `Su vytintu kumpiu`
- description: `Pica su aromatingais vytinto kumpio riekelėmis ir rūkola.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several pizzas; cured ham and rucola are not guaranteed to be visible
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p21`
- product id: `p21`
- product name: `Su kumpiu ir pievagrybiais`
- description: `Klasikinė pica su kumpiu ir šviežiais pievagrybiais.`
- current image path/url: `https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several different pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p3`
- product id: `p3`
- product name: `Keturių sūrių`
- description: `Pica su keturių rūšių sūriais ir medumi.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - this image is reused across seven white/vegetable/meat pizzas; it may not read as a four-cheese pizza specifically
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p5`
- product id: `p5`
- product name: `Vegetariška`
- description: `Pica su sezoninėmis daržovėmis, pesto ir mocarela.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across pizzas with different toppings and sauce styles
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `pb1`
- product id: `pb1`
- product name: `Pica Panouzzo`
- description: `Balta pica su itališko stiliaus įvairiais priedais.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across multiple other pizzas; not a precise identity image
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `pb2`
- product id: `pb2`
- product name: `Su vištiena ir kariu`
- description: `Balta pica su vištiena ir prieskoninio kariu padažu.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across unrelated white and red pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `pb3`
- product id: `pb3`
- product name: `Vegetariška Bianca pica`
- description: `Balta pica su sezoninėmis daržovėmis ir ricotta sūriu.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several different pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `pb4`
- product id: `pb4`
- product name: `Su vytintu kumpiu ir karamelizuotais svogūnais`
- description: `Balta pica su vytintu kumpiu ir saldžiais karamelizuotais svogūnais.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several pizzas with different ingredients
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `pb5`
- product id: `pb5`
- product name: `Su kumpeliu ir triufelių padažu`
- description: `Balta pica su kumpeliu ir aromatingų triufelių padažu.`
- current image path/url: `https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several pizzas with different topping profiles
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p10`
- product id: `p10`
- product name: `Su šonine ir svogūnais`
- description: `Pica su traškia šonine ir karamelizuotais svogūnais.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same meat-heavy pizza image is reused across seven pizzas with different meats and toppings
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p11`
- product id: `p11`
- product name: `Su faršu`
- description: `Sotus pica su mėsos faršu ir daržovėmis.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across many different meat pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p14`
- product id: `p14`
- product name: `Su kumpiu ir šonine`
- description: `Klasikinė mėsos pica su kumpiu ir šonine.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across many different meat pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p17`
- product id: `p17`
- product name: `Su plėšyta jautiena`
- description: `Pica su lėtai troškinta plėšyta jautiena ir BBQ padažu.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across many meat pizzas; pulled beef is not guaranteed to be visible
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p20`
- product id: `p20`
- product name: `Su traškia šonine`
- description: `Pica su ypač traškia šonine ir cukriniais svogūnais.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across many different meat pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p22`
- product id: `p22`
- product name: `Pica mėsos mėgėjams`
- description: `Gausi mėsos pica su kumpiu, šonine, saliamiu ir faršu.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across many meat pizzas; plausible family match, not exact product match
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p23`
- product id: `p23`
- product name: `Su faršu ir kaparėliais`
- description: `Pica su mėsos faršu ir sūriais kaparėliais.`
- current image path/url: `https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across many different meat pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p8`
- product id: `p8`
- product name: `Su saliamiu ir Chalapos pipirais`
- description: `Aštri pica su saliamiu ir žaliais Chalapos pipirais.`
- current image path/url: `https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80`
- problem: `UNCERTAIN` - the shared image may suit spicy salami pizza, but this whole group is reused too broadly
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p9`
- product id: `p9`
- product name: `Su saliamiu ir pievagrybiais`
- description: `Klasikinė pica su saliamiu ir šviežiais pievagrybiais.`
- current image path/url: `https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several distinct pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p15`
- product id: `p15`
- product name: `Su Pepperoni`
- description: `Klasikinė Pepperoni pica su gausiai užklotos dešros riekelėmis.`
- current image path/url: `https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several distinct pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `p16`
- product id: `p16`
- product name: `Su Pepperoni aštri`
- description: `Aštri Pepperoni pica su čili pipirais.`
- current image path/url: `https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several distinct pizzas
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki1`
- product id: `ki1`
- product name: `BBQ glazūruotos kiaulienos šoninės juostelės`
- description: `Lėtai troškinti kiaulienos šonkauliukų juostelės su BBQ glazūra.`
- current image path/url: `https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800&q=80`
- problem: `UNCERTAIN` - one pork photo is reused for belly strips, pork belly, tenderloin, pork neck steak, and porchetta; too broad to trust as exact
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki5`
- product id: `ki5`
- product name: `Kiaulienos šoninė`
- description: `Kepta kiaulienos šoninė su karamelizuotais obuoliais ir bulvių püre.`
- current image path/url: `https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several distinct pork cuts and preparations
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki6`
- product id: `ki6`
- product name: `Kiaulienos išpjova`
- description: `Sultinga kiaulienos išpjova su žolelių padažu ir garnyru.`
- current image path/url: `https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800&q=80`
- problem: `UNCERTAIN` - tenderloin should not rely on the same image as pork belly and porchetta without visual confirmation
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki7`
- product id: `ki7`
- product name: `Kiaulienos sprandinės kepsnys`
- description: `Storas kiaulienos sprandinės kepsnys ant grotelių.`
- current image path/url: `https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across several distinct pork cuts and formats
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki10`
- product id: `ki10`
- product name: `Lėtai kepta traški kiauliena Porchetta`
- description: `Itališko stiliaus riesta kiaulienos šoninė su pankoliu, česnakais ir šviežiomis žolelėmis.`
- current image path/url: `https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800&q=80`
- problem: `UNCERTAIN` - porchetta has a distinctive rolled presentation, but it shares a generic pork image with four other products
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `w1`
- product id: `w1`
- product name: `Wok makaronai su vištiena`
- description: `Wok kepti makaronai su vištiena ir daržovėmis.`
- current image path/url: `https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across chicken, beef, duck, and seafood noodle wok dishes
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `w2`
- product id: `w2`
- product name: `Wok makaronai su jautiena`
- description: `Wok kepti makaronai su jautiena ir daržovėmis.`
- current image path/url: `https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across four different wok proteins
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `w3`
- product id: `w3`
- product name: `Wok makaronai su antiena`
- description: `Wok kepti makaronai su antiena ir daržovėmis.`
- current image path/url: `https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across four different wok proteins
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `w4`
- product id: `w4`
- product name: `Wok makaronai su jūros gėrybėmis`
- description: `Wok kepti makaronai su jūros gėrybių mišiniu.`
- current image path/url: `https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&q=80`
- problem: `UNCERTAIN` - seafood wok should not rely on the same image as chicken, beef, and duck without visible seafood cues
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `u1`
- product id: `u1`
- product name: `Silkė su marinuotais svogūnais ir karštomis bulvėmis`
- description: `Tradicinė marinavimo silkė su marinuotais svogūnais ir karštomis bulvėmis.`
- current image path/url: `https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&q=80`
- problem: `UNCERTAIN` - one image is reused across all herring variants; that may be acceptable, but the variants include onion, vegetables, mushrooms, and potatoes, which are not necessarily represented exactly
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `u2`
- product id: `u2`
- product name: `Silkė su keptomis daržovėmis`
- description: `Silkė su sezoniniu keptų daržovių garnyru.`
- current image path/url: `https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across all herring variants; exact vegetable garnish support is not guaranteed
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `u3`
- product id: `u3`
- product name: `Silkė su miško grybais ir bulvėmis`
- description: `Silkė su miško grybais ir virtomis bulvėmis.`
- current image path/url: `https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&q=80`
- problem: `UNCERTAIN` - same image reused across all herring variants; mushrooms and potatoes are not guaranteed to be visible
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `k1`
- product id: `k1`
- product name: `Koldūnai su varške ir špinatais`
- description: `Rankų darbo koldūnai įdaryti varške ir špinatais, patiekiami su grietine.`
- current image path/url: `https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&q=80`
- problem: `UNCERTAIN` - one dumpling photo is reused across three different fillings, so the image does not verify the specific filling
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `k2`
- product id: `k2`
- product name: `Koldūnai su vištiena ir pievagrybiais`
- description: `Sultingi koldūnai su vištienos ir pievagrybių įdaru.`
- current image path/url: `https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&q=80`
- problem: `UNCERTAIN` - one dumpling photo is reused across three different fillings
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `k3`
- product id: `k3`
- product name: `Koldūnai su aviena`
- description: `Rankų darbo koldūnai su avienos įdaru ir jogurto padažu.`
- current image path/url: `https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&q=80`
- problem: `UNCERTAIN` - one dumpling photo is reused across three different fillings
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ki8`
- product id: `ki8`
- product name: `Kiaulienos Tomahawk`
- description: `Impozantiškas Tomahawk stiliaus kiaulienos kepsnys su garnyru.`
- current image path/url: `https://images.unsplash.com/photo-1558030006-450675393462?w=800&q=80`
- problem: `UNCERTAIN` - same steak image is reused for pork tomahawk and two Argentine beef entrecotes; species and cut identity are unclear
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ja1`
- product id: `ja1`
- product name: `Jautienos antrekotas (Argentina)`
- description: `300g Argentinos aukščiausios kokybės jautienos antrekotas, keptas pagal norimą kepimo laipsnį, su žolelių sviestu ir garnyru.`
- current image path/url: `https://images.unsplash.com/photo-1558030006-450675393462?w=800&q=80`
- problem: `UNCERTAIN` - same steak image is reused for pork tomahawk and surf-and-turf beef
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `ja2`
- product id: `ja2`
- product name: `Jautienos antrekotas Surf and Turf`
- description: `Argentinos jautienos antrekotas su grilyje keptomis krevetėmis.`
- current image path/url: `https://images.unsplash.com/photo-1558030006-450675393462?w=800&q=80`
- problem: `UNCERTAIN` - surf-and-turf should visibly support shrimp as well, but it shares the same generic steak image as two other products
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `s2`
- product id: `s2`
- product name: `Cezario salotos su grilyje kepta vištiena`
- description: `Romėniški lapai, grilyje kepta vištienos krūtinėlė, parmezanas, krutonai ir Cezario padažas.`
- current image path/url: `https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=800&q=80`
- problem: `UNCERTAIN` - this image is reused for both chicken and shrimp Caesar salads, so the protein identity is not reliable
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

### `s3`
- product id: `s3`
- product name: `Cezario salotos su krevetėmis`
- description: `Cezario salotos su grilyje keptomis krevetėmis.`
- current image path/url: `https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=800&q=80`
- problem: `UNCERTAIN` - same Caesar image is reused for both chicken and shrimp variants; shrimp should be visible if the image is meant to be exact
- confidence: `medium`
- recommended fix type: `MANUAL_REVIEW`

## Summary

- `MISMATCH` entries: `11`
- `UNCERTAIN` entries: `39`
- Most serious current issues:
  - grill/platter image reused across mains and beer snacks
  - tuna pizza sharing a cured-meat pizza image
  - wine snack plate sharing a baked Camembert image
  - fries / mozzarella sticks / onion rings sharing one snack photo
  - large pizza groups using the same image for materially different toppings

Products not listed above were not flagged in this strict pass.
