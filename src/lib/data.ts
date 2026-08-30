import { imageManifest } from "./image-manifest.ts";

export type Category =
  | "visi"
  | "uzkandziai"
  | "salotos"
  | "sriubos"
  | "lietiniai"
  | "koldumai"
  | "wok"
  | "bulviniai"
  | "picos"
  | "grilinis"
  | "vistiena"
  | "kiauliena"
  | "jautiena"
  | "zuvis"
  | "vaikiskas"
  | "prie-alaus"
  | "desertai"
  | "limonadai"
  | "nealko-alus"
  | "kava"
  | "gerimai"
  | "alus"
  | "sidras"
  | "alus-kokteiliai"
  | "kokteiliai"
  | "stiprieji"
  | "sampanas"
  | "vynas";

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  priceNote?: string;
  image: string;
  category: Category;
  ingredients: string[];
  allergens: string[];
  featured?: boolean;
  badge?: string;
  /** Live 86 — set via menu overrides, never in the static catalog. */
  soldOut?: boolean;
}

export const categories: { id: Category; label: string; emoji: string }[] = [
  { id: "visi", label: "Visi patiekalai", emoji: "🍽️" },
  { id: "uzkandziai", label: "Užkandžiai", emoji: "🥗" },
  { id: "salotos", label: "Salotos", emoji: "🥙" },
  { id: "sriubos", label: "Sriubos", emoji: "🍲" },
  { id: "lietiniai", label: "Lietiniai blynai", emoji: "🥞" },
  { id: "koldumai", label: "Koldūnai", emoji: "🥟" },
  { id: "wok", label: "Wok", emoji: "🍜" },
  { id: "bulviniai", label: "Bulviniai patiekalai", emoji: "🥔" },
  { id: "picos", label: "Picos", emoji: "🍕" },
  { id: "grilinis", label: "Griliniai rinkiniai", emoji: "🍱" },
  { id: "vistiena", label: "Vištiena", emoji: "🍗" },
  { id: "kiauliena", label: "Kiauliena", emoji: "🥩" },
  { id: "jautiena", label: "Jautiena ir aviena", emoji: "🥩" },
  { id: "zuvis", label: "Žuvies patiekalai", emoji: "🐟" },
  { id: "vaikiskas", label: "Vaikiškas meniu", emoji: "🧒" },
  { id: "prie-alaus", label: "Užkandžiai prie alaus", emoji: "🍺" },
  { id: "desertai", label: "Desertai", emoji: "🍰" },
  { id: "limonadai", label: "Limonadai ir kokteiliai", emoji: "🍹" },
  { id: "nealko-alus", label: "Nealkoholinis alus", emoji: "🍺" },
  { id: "kava", label: "Kava ir arbata", emoji: "☕" },
  { id: "gerimai", label: "Gaivieji gėrimai", emoji: "🥤" },
  { id: "alus", label: "Dzūkų alaus darykla", emoji: "🍺" },
  { id: "sidras", label: "Sidras", emoji: "🍎" },
  { id: "alus-kokteiliai", label: "Alaus kokteiliai", emoji: "🍻" },
  { id: "kokteiliai", label: "Kokteiliai", emoji: "🍸" },
  { id: "stiprieji", label: "Stiprieji gėrimai", emoji: "🥃" },
  { id: "sampanas", label: "Šampanas ir putojantis vynas", emoji: "🥂" },
  { id: "vynas", label: "Vynas", emoji: "🍷" },
];

const u = (id: string) => `https://images.unsplash.com/${id}?w=800&q=80`;

const IMG = {
  // Starters
  herring:        u("photo-1519708227418-c8fd9a32b7a2"),
  carpaccio:      u("photo-1544025162-d76694265947"),
  tunaCarpaccio:  u("photo-1467003909585-2f8a72700288"),
  // Salads
  beet:           u("photo-1615996001375-c7ef13294436"),
  caesarChicken:  u("photo-1550304943-4f24f54ddde9"),
  caesarShrimp:   u("photo-1550304943-4f24f54ddde9"),
  burrata:        u("photo-1529059997568-3d847b1154f0"),
  salad:          u("photo-1512621776951-a57141f2eefd"),
  duck:           u("photo-1543362906-acfc16c67564"),
  tunaSalad:      u("photo-1546069901-ba9599a7e63c"),
  // Soups
  soup:           u("photo-1547592180-85f173990554"),
  sriuba:         u("photo-1547592180-85f173990554"),
  chiliSoup:      u("photo-1547592180-85f173990554"),
  tomyum:         u("photo-1548943487-a2e4e43b4853"),
  // Pancakes
  pancakes:       u("photo-1528207776546-365bb710ee93"),
  pancakesBanana: u("photo-1562376552-0d160a2f238d"),
  pancakesHam:    u("photo-1567620905732-2d1ec7ab7445"),
  // Dumplings
  dumplings:      u("photo-1563245372-f21724e3856d"),
  gyoza:          u("photo-1563245372-f21724e3856d"),
  // Wok
  wok:            u("photo-1569050467447-ce54b3bbc37d"),
  wokBeef:        u("photo-1569050467447-ce54b3bbc37d"),
  wokDuck:        u("photo-1569050467447-ce54b3bbc37d"),
  wokSeafood:     u("photo-1569050467447-ce54b3bbc37d"),
  wokRice:        u("photo-1546069901-ba9599a7e63c"),
  wokRiceBeef:    u("photo-1546069901-ba9599a7e63c"),
  wokRiceSeafood: u("photo-1546069901-ba9599a7e63c"),
  // Potato dishes
  potato:         u("photo-1619096252214-ef06c45683e3"),
  potatoPancake:  u("photo-1528207776546-365bb710ee93"),
  potatoBun:      u("photo-1509440159596-0249088772ff"),
  // Pizzas
  pizza:          u("photo-1574071318508-1cdbab80d002"),
  pizzaVeg:       u("photo-1565299624946-b28f40a0ae38"),
  pizza4cheese:   u("photo-1565299624946-b28f40a0ae38"),
  pizzaKhachapuri:u("photo-1528137871618-79d2761e3fd5"),
  pizzaSalami:    u("photo-1628840042765-356cda07504e"),
  pizzaMeat:      u("photo-1513104890138-7c749659a591"),
  pizzaTuna:      u("photo-1628840042765-356cda07504e"),
  pizzaPulledBeef:u("photo-1513104890138-7c749659a591"),
  // Grill
  grill:          u("photo-1555939594-58d7cb561ad1"),
  grillFish:      u("photo-1559847844-5315695dadae"),
  // Chicken
  wings:          u("photo-1527477396000-e27163b481c2"),
  chickenShashlik:u("photo-1529059997568-3d847b1154f0"),
  schnitzel:      u("photo-1606755962773-d324e0a13086"),
  chickenKebab:   u("photo-1599974579688-8dbdd335c77f"),
  chicken:        u("photo-1598103442097-8b74394b95c1"),
  chickenFilletFixed: u("photo-1762631934518-f75e233413ca"),
  chickenGlazed:  u("photo-1527477396000-e27163b481c2"),
  duckBreast:     u("photo-1534422298391-e4f8c172dddb"),
  halfChicken:    u("photo-1604908176997-125f25cc6f3d"),
  // Pork
  porkBelly:      u("photo-1529042410759-befb1204b468"),
  schnitzelPork:  u("photo-1606755962773-d324e0a13086"),
  porkShashlik:   u("photo-1555939594-58d7cb561ad1"),
  porkTenderloin: u("photo-1529042410759-befb1204b468"),
  porkNeck:       u("photo-1529042410759-befb1204b468"),
  porkTomahawk:   u("photo-1558030006-450675393462"),
  porkRibs:       u("photo-1529042410759-befb1204b468"),
  porchetta:      u("photo-1529042410759-befb1204b468"),
  pork:           u("photo-1544025162-d76694265947"),
  // Beef & lamb
  steak:          u("photo-1558030006-450675393462"),
  steakSurf:      u("photo-1558030006-450675393462"),
  lamb:           u("photo-1602524205858-0fce8d027b3e"),
  lambKebabFixed: u("photo-1771285119408-04cca3b35036"),
  lambRack:       u("photo-1558030006-450675393462"),
  // Fish
  mackerel:       u("photo-1519708227418-c8fd9a32b7a2"),
  cod:            u("photo-1604909052743-94e838986d24"),
  shrimp:         u("photo-1565680018434-b513d5e5fd47"),
  seabass:        u("photo-1534766555764-ce878a5e3a2b"),
  salmon:         u("photo-1467003909585-2f8a72700288"),
  tuna:           u("photo-1467003909585-2f8a72700288"),
  octopus:        u("photo-1559410545-0bdcd187e0a6"),
  // Kids
  kids:           u("photo-1562802378-063ec186a863"),
  fries:          u("photo-1573080496219-bb080dd4f877"),
  kidsBlynai:     u("photo-1562802378-063ec186a863"),
  kidsChickenTenders: u("photo-1758578484486-74373f45b0b7"),
  // Beer snacks
  bread:          u("photo-1509440159596-0249088772ff"),
  cheeseToast:    u("photo-1509440159596-0249088772ff"),
  olives:         u("photo-1576402187878-974f70c890a5"),
  camembert:      u("photo-1486297678162-eb2a19b0a32d"),
  snackPlatter:   u("photo-1555939594-58d7cb561ad1"),
  mozzarellaSticks: u("photo-1573080496219-bb080dd4f877"),
  calamari:       u("photo-1565680018434-b513d5e5fd47"),
  calamariFixed:  u("photo-1675377668870-baf9b35763f9"),
  jalapeno:       u("photo-1565299624946-b28f40a0ae38"),
  jalapenoFixed:  u("photo-1561438883-3b98f4f6393d"),
  onionRings:     u("photo-1573080496219-bb080dd4f877"),
  sauceBowl:      u("photo-1572233052800-1394192b5404"),
  cheese:         u("photo-1486297678162-eb2a19b0a32d"),
  // Desserts
  napoleon:       u("photo-1578985545062-69928b1d9587"),
  cheesecake:     u("photo-1533134242443-d4fd215305ad"),
  applePie:       u("photo-1464305795204-6f5bbfc7fb81"),
  pavlova:        u("photo-1464305795204-6f5bbfc7fb81"),
  brownie:        u("photo-1564355808539-22fda35bed7e"),
  icecream:       u("photo-1488900128323-21503983a07e"),
  beerIcecream:   u("photo-1488900128323-21503983a07e"),
  sorbet:         u("photo-1488900128323-21503983a07e"),
  coconutIce:     u("photo-1488900128323-21503983a07e"),
  // Drinks
  lemonade:       u("photo-1621263764928-df1444c5e859"),
  lemonade2:      u("photo-1513558161293-cdaf765ed2fd"),
  milkshake:      u("photo-1541614101331-1a5a3a194e92"),
  smoothie:       u("photo-1490474418585-ba9bad8fd0ea"),
  coffee:         u("photo-1461023058943-07fcbe16d735"),
  tea:            u("photo-1556679343-c7306c1976bc"),
  water:          u("photo-1548839140-29a749e1cf4d"),
  kvass:          u("photo-1582762843356-c58f2a78dc7c"),
  juice:          u("photo-1621506289937-a8e4df240d0b"),
  softdrink:      u("photo-1622483767028-3f66f32aef97"),
  beer:           u("photo-1608270586620-248524c67de9"),
  beer2:          u("photo-1518176258769-f227c798150e"),
  beerTasting:    u("photo-1558618666-fcd25c85cd64"),
  cocktail:       u("photo-1551538827-9c037cb4f32a"),
  cocktail2:      u("photo-1470338745628-171cf53de3a8"),
  mojito:         u("photo-1544145945-f90425340c7e"),
  aperol:         u("photo-1551538827-9c037cb4f32a"),
  espressoMartini:u("photo-1541167760496-1628856ab772"),
  wine:           u("photo-1510812431401-41d2bd2722f3"),
  champagne:      u("photo-1535958636474-b021ee887b13"),
  spirits:        u("photo-1569529465841-dfecdab7503b"),
  cider:          u("photo-1558642891-54be180ea339"),
  nonAlcBeer:     u("photo-1608270586620-248524c67de9"),
  coldBorscht:    u("photo-1648726445011-9fbf3a5ddb90"),
  chiliSoupFixed: u("photo-1666819632298-fe15dc7d4c34"),
};

const _rawProducts: Product[] = [
  // UŽKANDŽIAI
  { id: "u1", name: "Silkė su marinuotais svogūnais ir karštomis bulvėmis", description: "Tradicinė marinavimo silkė su marinuotais svogūnais ir karštomis bulvėmis.", price: 6.20, image: IMG.herring, category: "uzkandziai", ingredients: ["Silkė", "Marinuoti svogūnai", "Karštos bulvės"], allergens: ["Žuvis"] },
  { id: "u2", name: "Silkė su keptomis daržovėmis", description: "Silkė su sezoniniu keptų daržovių garnyru.", price: 6.20, image: IMG.herring, category: "uzkandziai", ingredients: ["Silkė", "Keptos daržovės"], allergens: ["Žuvis"] },
  { id: "u3", name: "Silkė su miško grybais ir bulvėmis", description: "Silkė su miško grybais ir virtomis bulvėmis.", price: 7.20, image: IMG.herring, category: "uzkandziai", ingredients: ["Silkė", "Miško grybai", "Bulvės"], allergens: ["Žuvis"] },
  { id: "u4", name: "Jautienos karpačio", description: "Plonai pjaustytas žalias jautienos karpačio su kaparėliais ir parmezanu.", price: 14.90, image: IMG.carpaccio, category: "uzkandziai", ingredients: ["Jautiena", "Kaparėliai", "Parmezanas", "Rūkola"], allergens: ["Pienas"], badge: "Šefo pasirinkimas", featured: true },
  { id: "u5", name: "Tuno karpačio", description: "Plonai pjaustytas tuno karpačio su sezamo ir imbiero padažu.", price: 14.50, image: IMG.tunaCarpaccio, category: "uzkandziai", ingredients: ["Tunas", "Sezamas", "Imbieras", "Sojos padažas"], allergens: ["Žuvis", "Soja"] },

  // SALOTOS
  { id: "s1", name: "Keptų burokėlių salotos su sūriu fetos", description: "Orkaitėje kepti burokėliai su fetos sūriu ir riešutų padažu.", price: 8.80, image: IMG.beet, category: "salotos", ingredients: ["Burokėliai", "Fetos sūris", "Rūkola", "Graikiniai riešutai"], allergens: ["Pienas", "Riešutai"] },
  { id: "s2", name: "Cezario salotos su grilyje kepta vištiena", description: "Romėniški lapai, grilyje kepta vištienos krūtinėlė, parmezanas, krutonai ir Cezario padažas.", price: 10.50, image: IMG.caesarChicken, category: "salotos", ingredients: ["Romėniški lapai", "Vištiena", "Parmezanas", "Krutonai", "Cezario padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"], featured: true },
  { id: "s3", name: "Cezario salotos su krevetėmis", description: "Cezario salotos su grilyje keptomis krevetėmis.", price: 11.50, image: IMG.caesarShrimp, category: "salotos", ingredients: ["Romėniški lapai", "Krevetės", "Parmezanas", "Krutonai", "Cezario padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai", "Vėžiagyviai"] },
  { id: "s4", name: "Salotos su Burrata sūriu ir Serano kumpiu", description: "Kreminis Burrata sūris su plonai pjaustytu Serano kumpiu ir vyšniniais pomidorais.", price: 14.50, image: IMG.burrata, category: "salotos", ingredients: ["Burrata", "Serano kumpio", "Vyšniniai pomidorai", "Bazilikas"], allergens: ["Pienas"] },
  { id: "s5", name: "Graikiškos salotos", description: "Tradicinės graikiškos salotos su feta, alyvuogėmis ir šviežiomis daržovėmis.", price: 10.90, image: IMG.salad, category: "salotos", ingredients: ["Pomidorai", "Agurkai", "Feta", "Alyvuogės", "Raudonieji svogūnai"], allergens: ["Pienas"] },
  { id: "s6", name: "Salotos su antiena", description: "Pjaustytos antienos krūtinėlės salotos su apelsinų segmentais ir medaus garstyčių padažu.", price: 14.90, image: IMG.duck, category: "salotos", ingredients: ["Antiena", "Mišrūs lapai", "Apelsinas", "Medus", "Garstyčios"], allergens: ["Garstyčios"] },
  { id: "s7", name: "Salotos su tuno filė ir šilauogėmis", description: "Šviežio tuno filė salotos su šilauogėmis ir lengvu citriniu padažu.", price: 14.50, image: IMG.tunaSalad, category: "salotos", ingredients: ["Tuno filė", "Šilauogės", "Mišrūs lapai", "Citrina"], allergens: ["Žuvis"] },

  // SRIUBOS
  { id: "sr1", name: "Šaltibarščiai", description: "Tradicinė lietuviška šalta burokėlių sriuba su agurkais, kiaušiniais ir grietine.", price: 4.90, image: IMG.coldBorscht, category: "sriubos", ingredients: ["Burokėliai", "Agurkai", "Kiaušiniai", "Grietinė", "Krapai"], allergens: ["Pienas", "Kiaušiniai"], badge: "Tradicinis", featured: true },
  { id: "sr2", name: "Kopūstienė su baravykais", description: "Šilta kopūstų sriuba su miško baravykais ir šaknelėmis.", price: 5.90, image: IMG.sriuba, category: "sriubos", ingredients: ["Kopūstai", "Baravykai", "Morkos", "Svogūnai"], allergens: [] },
  { id: "sr3", name: "Aštri \"Čili\" sriuba", description: "Jautienos ir pupelių čili sriuba su rūkytais pipirais ir grietine.", price: 6.90, image: IMG.chiliSoupFixed, category: "sriubos", ingredients: ["Jautiena", "Pupelės", "Čili", "Pomidorai"], allergens: ["Pienas"] },
  { id: "sr4", name: "Tom Yum sriuba", description: "Tailandietiška aštri ir rūgšti krevetių sriuba su pievagrybiais, citrinžole ir kokosų pienu.", price: 14.90, image: IMG.tomyum, category: "sriubos", ingredients: ["Krevetės", "Pievagrybiai", "Citrinžolė", "Čili", "Kokosų pienas"], allergens: ["Vėžiagyviai"] },

  // LIETINIAI BLYNAI
  { id: "lb1", name: "Lietiniai su varške (2 vnt.)", description: "Ploni lietiniai blynai su saldžia varške.", price: 5.80, image: IMG.pancakes, category: "lietiniai", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Varškė"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "lb1-3", name: "Lietiniai su varške (3 vnt.)", description: "Ploni lietiniai blynai su saldžia varške.", price: 7.90, image: IMG.pancakes, category: "lietiniai", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Varškė"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "lb2", name: "Lietiniai su bananais (2 vnt.)", description: "Ploni lietiniai blynai su šviežiais bananais ir šokoladiniu padažu.", price: 5.80, image: IMG.pancakesBanana, category: "lietiniai", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Bananai", "Šokoladinis padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "lb2-3", name: "Lietiniai su bananais (3 vnt.)", description: "Ploni lietiniai blynai su šviežiais bananais ir šokoladiniu padažu.", price: 7.90, image: IMG.pancakesBanana, category: "lietiniai", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Bananai", "Šokoladinis padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "lb3", name: "Lietiniai su kumpiu ir sūriu (2 vnt.)", description: "Sotūs lietiniai blynai su kumpiu ir ištirpusiu sūriu.", price: 6.80, image: IMG.pancakesHam, category: "lietiniai", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Kumpio", "Sūris"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "lb3-3", name: "Lietiniai su kumpiu ir sūriu (3 vnt.)", description: "Sotūs lietiniai blynai su kumpiu ir ištirpusiu sūriu.", price: 9.00, image: IMG.pancakesHam, category: "lietiniai", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Kumpio", "Sūris"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },

  // KOLDŪNAI
  { id: "k1", name: "Koldūnai su varške ir špinatais", description: "Rankų darbo koldūnai įdaryti varške ir špinatais, patiekiami su grietine.", price: 9.90, image: IMG.dumplings, category: "koldumai", ingredients: ["Miltai", "Varškė", "Špinatai", "Grietinė"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "k2", name: "Koldūnai su vištiena ir pievagrybiais", description: "Sultingi koldūnai su vištienos ir pievagrybių įdaru.", price: 10.90, image: IMG.dumplings, category: "koldumai", ingredients: ["Miltai", "Vištiena", "Pievagrybiai", "Svogūnai"], allergens: ["Glitimas", "Kiaušiniai"] },
  { id: "k3", name: "Koldūnai su aviena", description: "Rankų darbo koldūnai su avienos įdaru ir jogurto padažu.", price: 14.50, image: IMG.dumplings, category: "koldumai", ingredients: ["Miltai", "Aviena", "Česnakai", "Jogurtas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "k4", name: "Gyoza koldūnai su aviena", description: "Japoniško stiliaus gyoza koldūnai su avienos įdaru ir sojos padažu.", price: 14.90, image: IMG.gyoza, category: "koldumai", ingredients: ["Miltai", "Aviena", "Imbieras", "Sojos padažas"], allergens: ["Glitimas", "Soja", "Kiaušiniai"], badge: "Naujiena" },

  // WOK
  { id: "w1", name: "Wok makaronai su vištiena", description: "Wok kepti makaronai su vištiena ir daržovėmis.", price: 11.50, image: IMG.wok, category: "wok", ingredients: ["Makaronai", "Vištiena", "Daržovės", "Sojos padažas"], allergens: ["Glitimas", "Soja"] },
  { id: "w2", name: "Wok makaronai su jautiena", description: "Wok kepti makaronai su jautiena ir daržovėmis.", price: 12.90, image: IMG.wokBeef, category: "wok", ingredients: ["Makaronai", "Jautiena", "Daržovės", "Sojos padažas"], allergens: ["Glitimas", "Soja"] },
  { id: "w3", name: "Wok makaronai su antiena", description: "Wok kepti makaronai su antiena ir daržovėmis.", price: 13.50, image: IMG.wokDuck, category: "wok", ingredients: ["Makaronai", "Antiena", "Daržovės", "Sojos padažas"], allergens: ["Glitimas", "Soja"] },
  { id: "w4", name: "Wok makaronai su jūros gėrybėmis", description: "Wok kepti makaronai su jūros gėrybių mišiniu.", price: 13.50, image: IMG.wokSeafood, category: "wok", ingredients: ["Makaronai", "Jūros gėrybės", "Daržovės", "Sojos padažas"], allergens: ["Glitimas", "Soja", "Vėžiagyviai", "Moliuskai"] },
  { id: "w5", name: "Wok ryžiai su vištiena", description: "Wok kepti ryžiai su vištiena ir daržovėmis.", price: 11.50, image: IMG.wokRice, category: "wok", ingredients: ["Ryžiai", "Vištiena", "Daržovės", "Sojos padažas"], allergens: ["Soja"] },
  { id: "w6", name: "Wok ryžiai su jautiena", description: "Wok kepti ryžiai su jautiena ir daržovėmis.", price: 12.90, image: IMG.wokRiceBeef, category: "wok", ingredients: ["Ryžiai", "Jautiena", "Daržovės", "Sojos padažas"], allergens: ["Soja"] },
  { id: "w7", name: "Wok ryžiai su antiena", description: "Wok kepti ryžiai su antiena ir daržovėmis.", price: 13.50, image: IMG.wokRice, category: "wok", ingredients: ["Ryžiai", "Antiena", "Daržovės", "Sojos padažas"], allergens: ["Soja"] },
  { id: "w8", name: "Wok ryžiai su jūros gėrybėmis", description: "Wok kepti ryžiai su jūros gėrybių mišiniu.", price: 13.30, image: IMG.wokRiceSeafood, category: "wok", ingredients: ["Ryžiai", "Jūros gėrybės", "Daržovės", "Sojos padažas"], allergens: ["Soja", "Vėžiagyviai", "Moliuskai"] },

  // BULVINIAI PATIEKALAI
  { id: "b1", name: "Didžkukuliai su mėsa (mažas)", description: "Tradiciniai lietuviški didžkukuliai su mėsos įdaru.", price: 7.50, image: IMG.potato, category: "bulviniai", ingredients: ["Bulvės", "Mėsa", "Svogūnai", "Grietinė"], allergens: ["Pienas"], featured: true, badge: "Tradicinis" },
  { id: "b1-d", name: "Didžkukuliai su mėsa (didelis)", description: "Tradiciniai lietuviški didžkukuliai su mėsos įdaru.", price: 9.90, image: IMG.potato, category: "bulviniai", ingredients: ["Bulvės", "Mėsa", "Svogūnai", "Grietinė"], allergens: ["Pienas"], badge: "Tradicinis" },
  { id: "b2", name: "Apkepinti didžkukuliai (mažas)", description: "Apkepinti didžkukuliai su grietine ir spirgučiais.", price: 7.50, image: IMG.potato, category: "bulviniai", ingredients: ["Bulvės", "Mėsa", "Spirgučiai", "Grietinė"], allergens: ["Pienas"] },
  { id: "b2-d", name: "Apkepinti didžkukuliai (didelis)", description: "Apkepinti didžkukuliai su grietine ir spirgučiais.", price: 9.90, image: IMG.potato, category: "bulviniai", ingredients: ["Bulvės", "Mėsa", "Spirgučiai", "Grietinė"], allergens: ["Pienas"] },
  { id: "b3", name: "Žemaičių blynai (mažas)", description: "Tradiciniai Žemaitijos bulviniai blynai su mėsa.", price: 7.50, image: IMG.potatoPancake, category: "bulviniai", ingredients: ["Bulvės", "Mėsa", "Svogūnai", "Grietinė"], allergens: ["Pienas"] },
  { id: "b3-d", name: "Žemaičių blynai (didelis)", description: "Tradiciniai Žemaitijos bulviniai blynai su mėsa.", price: 9.90, image: IMG.potatoPancake, category: "bulviniai", ingredients: ["Bulvės", "Mėsa", "Svogūnai", "Grietinė"], allergens: ["Pienas"] },
  { id: "b4", name: "Bulviniai blynai", description: "Traškūs bulviniai blynai su grietine.", price: 9.90, image: IMG.potatoPancake, category: "bulviniai", ingredients: ["Bulvės", "Kiaušiniai", "Svogūnai", "Grietinė"], allergens: ["Pienas", "Kiaušiniai"] },
  { id: "b5", name: "Bulviniai blynai su varške ir šonine", description: "Bulviniai blynai su varškės ir šoninės įdaru.", price: 13.50, image: IMG.potatoPancake, category: "bulviniai", ingredients: ["Bulvės", "Varškė", "Šoninė", "Grietinė"], allergens: ["Pienas", "Kiaušiniai"] },
  { id: "b6", name: "Bulviniai blynai su varške ir lašiša", description: "Bulviniai blynai su varškės ir rūkytos lašišos įdaru.", price: 13.50, image: IMG.potatoPancake, category: "bulviniai", ingredients: ["Bulvės", "Varškė", "Rūkyta lašiša", "Krapai"], allergens: ["Pienas", "Kiaušiniai", "Žuvis"] },
  { id: "b7", name: "Bulvinės bandos su spirgučiais ir grietine", description: "Minkštos bulvinės bandos su spirgučiais ir grietine.", price: 10.50, image: IMG.potatoBun, category: "bulviniai", ingredients: ["Bulvės", "Spirgučiai", "Grietinė"], allergens: ["Pienas"] },
  { id: "b8", name: "Bulvinės bandos su baravykų padažu", description: "Bulvinės bandos su aromatingų baravykų padažu.", price: 11.50, image: IMG.potatoBun, category: "bulviniai", ingredients: ["Bulvės", "Baravykai", "Grietinėlė"], allergens: ["Pienas"] },
  { id: "b9", name: "Bulvinės bandos su varške ir šonine", description: "Sotios bulvinės bandos su varška ir šonine.", price: 11.90, image: IMG.potatoBun, category: "bulviniai", ingredients: ["Bulvės", "Varškė", "Šoninė"], allergens: ["Pienas"] },
  { id: "b10", name: "Bulvinės bandos su varške ir lašiša", description: "Bulvinės bandos su varška ir rūkyta lašiša.", price: 14.00, image: IMG.potatoBun, category: "bulviniai", ingredients: ["Bulvės", "Varškė", "Rūkyta lašiša"], allergens: ["Pienas", "Žuvis"] },

  // PICOS – KLASIKINĖS
  { id: "p1", name: "Margarita", description: "Klasikinė pica su pomidorų padažu, mocarela ir šviežiu baziliku. Tešla rauginama 24 val.", price: 9.00, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Bazilikas", "Alyvuogių aliejus"], allergens: ["Glitimas", "Pienas"] },
  { id: "p2", name: "Vaikiška pica", description: "Lengva pica vaikams su pomidorų padažu ir mocarela.", price: 11.50, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela"], allergens: ["Glitimas", "Pienas"] },
  { id: "p3", name: "Keturių sūrių", description: "Pica su keturių rūšių sūriais ir medumi.", price: 9.90, image: IMG.pizza4cheese, category: "picos", ingredients: ["Mocarela", "Gorgonzola", "Parmezanas", "Gouda", "Medus"], allergens: ["Glitimas", "Pienas"] },
  { id: "p4", name: "Perlenkta", description: "Sulankstytos tešlos pica su klasikiniu įdaru.", price: 10.50, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Kumpis"], allergens: ["Glitimas", "Pienas"] },
  { id: "p5", name: "Vegetariška", description: "Pica su sezoninėmis daržovėmis, pesto ir mocarela.", price: 10.90, image: IMG.pizzaVeg, category: "picos", ingredients: ["Daržovės", "Pesto", "Mocarela", "Pomidorų padažas"], allergens: ["Glitimas", "Pienas"] },
  { id: "p6", name: "Chačapuri", description: "Gruziniškas chačapuri su sultiniu sūrio įdaru.", price: 14.90, image: IMG.pizzaKhachapuri, category: "picos", ingredients: ["Tešla", "Sūris", "Kiaušinis", "Sviestas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "p7", name: "Chačapuri su faršu", description: "Gruziniškas chačapuri su sūriu ir mėsos faršo įdaru.", price: 16.90, image: IMG.pizzaKhachapuri, category: "picos", ingredients: ["Tešla", "Sūris", "Mėsos faršas", "Kiaušinis"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "p8", name: "Su saliamiu ir Chalapos pipirais", description: "Aštri pica su saliamiu ir žaliais Chalapos pipirais.", price: 10.90, image: IMG.pizzaSalami, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Saliamis", "Chalapos pipirai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p9", name: "Su saliamiu ir pievagrybiais", description: "Klasikinė pica su saliamiu ir šviežiais pievagrybiais.", price: 11.50, image: IMG.pizzaSalami, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Saliamis", "Pievagrybiai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p10", name: "Su šonine ir svogūnais", description: "Pica su traškia šonine ir karamelizuotais svogūnais.", price: 11.00, image: IMG.pizzaMeat, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Šoninė", "Karamelizuoti svogūnai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p11", name: "Su faršu", description: "Sotus pica su mėsos faršu ir daržovėmis.", price: 11.00, image: IMG.pizzaMeat, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Mėsos faršas", "Svogūnai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p12", name: "Su vištiena ir pievagrybiais", description: "Lengva pica su vištiena ir pievagrybiais.", price: 11.00, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Vištiena", "Pievagrybiai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p13", name: "Su saulėje džiovintais pomidorais", description: "Pica su saulėje džiovintais pomidorais ir parmezanu.", price: 11.00, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Džiovinti pomidorai", "Parmezanas"], allergens: ["Glitimas", "Pienas"] },
  { id: "p14", name: "Su kumpiu ir šonine", description: "Klasikinė mėsos pica su kumpiu ir šonine.", price: 12.00, image: IMG.pizzaMeat, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Kumpis", "Šoninė"], allergens: ["Glitimas", "Pienas"] },
  { id: "p15", name: "Su Pepperoni", description: "Klasikinė Pepperoni pica su gausiai užklotos dešros riekelėmis.", price: 12.00, image: IMG.pizzaSalami, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Pepperoni"], allergens: ["Glitimas", "Pienas"], badge: "Populiari" },
  { id: "p16", name: "Su Pepperoni aštri", description: "Aštri Pepperoni pica su čili pipirais.", price: 12.50, image: IMG.pizzaSalami, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Pepperoni", "Čili pipirai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p17", name: "Su plėšyta jautiena", description: "Pica su lėtai troškinta plėšyta jautiena ir BBQ padažu.", price: 13.00, image: IMG.pizzaPulledBeef, category: "picos", ingredients: ["BBQ padažas", "Mocarela", "Plėšyta jautiena", "Raudonieji svogūnai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p18", name: "Su vytintu kumpiu", description: "Pica su aromatingais vytinto kumpio riekelėmis ir rūkola.", price: 14.00, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Vytintas kumpis", "Rūkola"], allergens: ["Glitimas", "Pienas"] },
  { id: "p19", name: "Su tuno filė", description: "Pica su tuno filė, raudonaisiais svogūnais ir kaparėliais.", price: 13.50, image: IMG.pizzaTuna, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Tuno filė", "Raudonieji svogūnai", "Kaparėliai"], allergens: ["Glitimas", "Pienas", "Žuvis"] },
  { id: "p20", name: "Su traškia šonine", description: "Pica su ypač traškia šonine ir cukriniais svogūnais.", price: 14.00, image: IMG.pizzaMeat, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Traški šoninė", "Cukiniai svogūnai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p21", name: "Su kumpiu ir pievagrybiais", description: "Klasikinė pica su kumpiu ir šviežiais pievagrybiais.", price: 12.50, image: IMG.pizza, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Kumpis", "Pievagrybiai"], allergens: ["Glitimas", "Pienas"] },
  { id: "p22", name: "Pica mėsos mėgėjams", description: "Gausi mėsos pica su kumpiu, šonine, saliamiu ir faršu.", price: 13.00, image: IMG.pizzaMeat, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Kumpis", "Šoninė", "Saliamis", "Faršas"], allergens: ["Glitimas", "Pienas"] },
  { id: "p23", name: "Su faršu ir kaparėliais", description: "Pica su mėsos faršu ir sūriais kaparėliais.", price: 14.90, image: IMG.pizzaMeat, category: "picos", ingredients: ["Pomidorų padažas", "Mocarela", "Faršas", "Kaparėliai"], allergens: ["Glitimas", "Pienas"] },
  // PICOS BIANCA
  { id: "pb1", name: "Pica Panouzzo", description: "Balta pica su itališko stiliaus įvairiais priedais.", price: 13.00, image: IMG.pizzaVeg, category: "picos", ingredients: ["Mocarela", "Alyvuogių aliejus", "Česnakai"], allergens: ["Glitimas", "Pienas"] },
  { id: "pb2", name: "Su vištiena ir kariu", description: "Balta pica su vištiena ir prieskoninio kariu padažu.", price: 11.00, image: IMG.pizzaVeg, category: "picos", ingredients: ["Mocarela", "Vištiena", "Karis", "Svogūnai"], allergens: ["Glitimas", "Pienas"] },
  { id: "pb3", name: "Vegetariška Bianca pica", description: "Balta pica su sezoninėmis daržovėmis ir ricotta sūriu.", price: 10.90, image: IMG.pizzaVeg, category: "picos", ingredients: ["Ricotta", "Mocarela", "Sezoninės daržovės"], allergens: ["Glitimas", "Pienas"] },
  { id: "pb4", name: "Su vytintu kumpiu ir karamelizuotais svogūnais", description: "Balta pica su vytintu kumpiu ir saldžiais karamelizuotais svogūnais.", price: 14.00, image: IMG.pizzaVeg, category: "picos", ingredients: ["Mocarela", "Vytintas kumpis", "Karamelizuoti svogūnai"], allergens: ["Glitimas", "Pienas"] },
  { id: "pb5", name: "Su kumpeliu ir triufelių padažu", description: "Balta pica su kumpeliu ir aromatingų triufelių padažu.", price: 13.00, image: IMG.pizzaVeg, category: "picos", ingredients: ["Mocarela", "Kumpis", "Triufelių padažas"], allergens: ["Glitimas", "Pienas"], badge: "Šefo pasirinkimas" },

  // GRILINIAI RINKINIAI
  { id: "gr1", name: "Grilinių patiekalų padėklas Nr. 1 (6 asmenims)", description: "Išsamus grilinių patiekalų rinkinys 6 asmenims su mišria mėsa ir garnyru.", price: 85.00, image: IMG.grill, category: "grilinis", ingredients: ["Mišri mėsa", "Garnyras", "Padažai"], allergens: [] },
  { id: "gr2", name: "Grilinių patiekalų padėklas Nr. 2 (6 asmenims)", description: "Alternatyvus grilinių patiekalų rinkinys 6 asmenims.", price: 80.00, image: IMG.grill, category: "grilinis", ingredients: ["Mišri mėsa", "Garnyras", "Padažai"], allergens: [] },
  { id: "gr3", name: "Grilinių žuvų padėklas (5 asmenims)", description: "Grilinių žuvies patiekalų rinkinys 5 asmenims.", price: 75.00, image: IMG.grillFish, category: "grilinis", ingredients: ["Mišri žuvis", "Garnyras", "Citrina"], allergens: ["Žuvis"] },
  { id: "gr4", name: "Grilinių patiekalų ir bulvinių patiekalų padėklas (4 asmenims)", description: "Grilinių mėsos ir bulvinių patiekalų rinkinys 4 asmenims.", price: 55.00, image: IMG.grill, category: "grilinis", ingredients: ["Mėsa", "Bulviniai patiekalai", "Garnyras"], allergens: ["Pienas"] },

  // VIŠTIENA
  { id: "v1", name: "Glazūruoti vištienos sparneliai (BBQ arba aštrūs Buffalo)", description: "Lėtai kepti sparneliai glazūruoti BBQ arba aštriu Buffalo padažu su Blue cheese dip.", price: 14.90, image: IMG.wings, category: "vistiena", ingredients: ["Vištienos sparneliai", "BBQ padažas", "Blue cheese dip"], allergens: ["Pienas", "Soja"], badge: "Populiaru", featured: true },
  { id: "v2", name: "Vištienos šašlykas (mažas)", description: "Marinuotas vištienos šlaunelių šašlykas ant grotelių.", price: 10.90, image: IMG.chickenKebab, category: "vistiena", ingredients: ["Vištienos šlaunelės", "Paprika", "Česnakai", "Citrina"], allergens: [] },
  { id: "v2-d", name: "Vištienos šašlykas (didelis)", description: "Marinuotas vištienos šlaunelių šašlykas ant grotelių.", price: 14.90, image: IMG.chickenKebab, category: "vistiena", ingredients: ["Vištienos šlaunelės", "Paprika", "Česnakai", "Citrina"], allergens: [] },
  { id: "v3", name: "Vištienos Vienos šnicelis", description: "Tradicinis Vienos stiliaus vištienos šnicelis su bulvių koše.", price: 16.50, image: IMG.schnitzel, category: "vistiena", ingredients: ["Vištiena", "Džiūvėsėliai", "Kiaušiniai", "Bulvių košė", "Citrina"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "v4", name: "Vištienos kebabas", description: "Vištienos maltinuko kebabas su jogurto mėtos padažu.", price: 16.50, image: IMG.chickenKebab, category: "vistiena", ingredients: ["Vištiena", "Svogūnai", "Prieskoniai", "Jogurtas", "Mėta"], allergens: ["Pienas"] },
  { id: "v5", name: "Vištienos filė", description: "Grilyje kepta vištienos filė su sezoninėmis daržovėmis.", price: 15.50, image: IMG.chickenFilletFixed, category: "vistiena", ingredients: ["Vištienos filė", "Sezoninės daržovės", "Žolelės"], allergens: [] },
  { id: "v6", name: "Glazūruota vištienos filė", description: "Glazūruota vištienos filė su medaus ir sojos padažu.", price: 15.90, image: IMG.chickenGlazed, category: "vistiena", ingredients: ["Vištienos filė", "Medus", "Sojos padažas", "Česnakai"], allergens: ["Soja"] },
  { id: "v7", name: "Antienos krūtinėlė su kriauše ir pelėsiniu sūriu", description: "Rožinė antienos krūtinėlė su karamelizuota kriaušė ir pelėsiniu sūriu.", price: 21.00, image: IMG.duckBreast, category: "vistiena", ingredients: ["Antienos krūtinėlė", "Kriaušė", "Pelėsinis sūris", "Portveinas"], allergens: ["Pienas"], badge: "Šefo pasirinkimas" },
  { id: "v8", name: "Grilyje keptas viščiukas (pusė)", description: "Pusė arba visas viščiukas, keptas ant grotelių su žolelėmis.", price: 15.00, image: IMG.halfChicken, category: "vistiena", ingredients: ["Viščiukas", "Rozmarinas", "Čiobrelis", "Česnakai"], allergens: [] },
  { id: "v8-v", name: "Grilyje keptas viščiukas (visas)", description: "Pusė arba visas viščiukas, keptas ant grotelių su žolelėmis.", price: 26.00, image: IMG.halfChicken, category: "vistiena", ingredients: ["Viščiukas", "Rozmarinas", "Čiobrelis", "Česnakai"], allergens: [] },
  { id: "v9", name: "Glazūruotas grilyje keptas viščiukas (pusė)", description: "Glazūruotas viščiukas, keptas ant grotelių su BBQ padažu.", price: 16.00, image: IMG.halfChicken, category: "vistiena", ingredients: ["Viščiukas", "BBQ glazūra", "Česnakai", "Prieskoniai"], allergens: ["Soja"] },
  { id: "v9-v", name: "Glazūruotas grilyje keptas viščiukas (visas)", description: "Glazūruotas viščiukas, keptas ant grotelių su BBQ padažu.", price: 27.00, image: IMG.halfChicken, category: "vistiena", ingredients: ["Viščiukas", "BBQ glazūra", "Česnakai", "Prieskoniai"], allergens: ["Soja"] },

  // KIAULIENA
  { id: "ki1", name: "BBQ glazūruotos kiaulienos šoninės juostelės", description: "Lėtai troškinti kiaulienos šonkauliukų juostelės su BBQ glazūra.", price: 13.90, image: IMG.porkBelly, category: "kiauliena", ingredients: ["Kiaulienos šoninė", "BBQ padažas", "Medus", "Garstyčios"], allergens: ["Garstyčios"] },
  { id: "ki2", name: "Kiaulienos Vienos šnicelis", description: "Tradicinis plaktas kiaulienos šnicelis su džiūvėsėliais, citrina ir bulvių koše.", price: 16.60, image: IMG.schnitzelPork, category: "kiauliena", ingredients: ["Kiaulienos sprandinė", "Džiūvėsėliai", "Kiaušiniai", "Bulvių košė", "Citrina"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "ki3", name: "Aštrus kiaulienos šašlykas (mažas)", description: "Aitraus marinato kiaulienos šašlykas ant grotelių.", price: 11.90, image: IMG.porkShashlik, category: "kiauliena", ingredients: ["Kiauliena", "Čili", "Česnakai", "Paprika"], allergens: [] },
  { id: "ki3-d", name: "Aštrus kiaulienos šašlykas (didelis)", description: "Aitraus marinato kiaulienos šašlykas ant grotelių.", price: 15.90, image: IMG.porkShashlik, category: "kiauliena", ingredients: ["Kiauliena", "Čili", "Česnakai", "Paprika"], allergens: [] },
  { id: "ki4", name: "Kaukazietiškas kiaulienos šašlykas (mažas)", description: "Tradicinių Kaukazo prieskonių marinato kiaulienos šašlykas.", price: 11.90, image: IMG.porkShashlik, category: "kiauliena", ingredients: ["Kiauliena", "Svogūnai", "Kaukazo prieskoniai"], allergens: [] },
  { id: "ki4-d", name: "Kaukazietiškas kiaulienos šašlykas (didelis)", description: "Tradicinių Kaukazo prieskonių marinato kiaulienos šašlykas.", price: 15.90, image: IMG.porkShashlik, category: "kiauliena", ingredients: ["Kiauliena", "Svogūnai", "Kaukazo prieskoniai"], allergens: [] },
  { id: "ki5", name: "Kiaulienos šoninė", description: "Kepta kiaulienos šoninė su karamelizuotais obuoliais ir bulvių püre.", price: 16.90, image: IMG.porkBelly, category: "kiauliena", ingredients: ["Kiaulienos šoninė", "Obuoliai", "Bulvių püre"], allergens: ["Pienas"] },
  { id: "ki6", name: "Kiaulienos išpjova", description: "Sultinga kiaulienos išpjova su žolelių padažu ir garnyru.", price: 16.90, image: IMG.porkTenderloin, category: "kiauliena", ingredients: ["Kiaulienos išpjova", "Žolelės", "Česnakai", "Garnyras"], allergens: [] },
  { id: "ki7", name: "Kiaulienos sprandinės kepsnys", description: "Storas kiaulienos sprandinės kepsnys ant grotelių.", price: 16.90, image: IMG.porkNeck, category: "kiauliena", ingredients: ["Kiaulienos sprandinė", "Rozmarinas", "Česnakai"], allergens: [] },
  { id: "ki8", name: "Kiaulienos Tomahawk", description: "Impozantiškas Tomahawk stiliaus kiaulienos kepsnys su garnyru.", price: 22.00, image: IMG.porkTomahawk, category: "kiauliena", ingredients: ["Kiaulienos Tomahawk", "Žolelės", "Česnakai", "Garnyras"], allergens: [], badge: "Šefo pasirinkimas" },
  { id: "ki9", name: "BBQ glazūruoti kiaulienos šonkauliai", description: "Visas šonkaulių laikiklis lėtai rūkytas ir glazūruotas BBQ padažu.", price: 21.90, image: IMG.porkRibs, category: "kiauliena", ingredients: ["Kiaulienos šonkauliai", "BBQ padažas", "Rudasis cukrus", "Česnakai"], allergens: [], featured: true },
  { id: "ki10", name: "Lėtai kepta traški kiauliena Porchetta", description: "Itališko stiliaus riesta kiaulienos šoninė su pankoliu, česnakais ir šviežiomis žolelėmis.", price: 16.90, image: IMG.porchetta, category: "kiauliena", ingredients: ["Kiaulienos šoninė", "Pankoliai", "Česnakai", "Rozmarinas", "Šalavijas"], allergens: [], badge: "Šefo pasirinkimas" },

  // JAUTIENA IR AVIENA
  { id: "ja1", name: "Jautienos antrekotas (Argentina)", description: "300g Argentinos aukščiausios kokybės jautienos antrekotas, keptas pagal norimą kepimo laipsnį, su žolelių sviestu ir garnyru.", price: 29.90, image: IMG.steak, category: "jautiena", ingredients: ["Argentinos jautienos antrekotas", "Žolelių sviestas", "Garnyras"], allergens: ["Pienas"], badge: "Premium", featured: true },
  { id: "ja2", name: "Jautienos antrekotas Surf and Turf", description: "Argentinos jautienos antrekotas su grilyje keptomis krevetėmis.", price: 31.90, image: IMG.steakSurf, category: "jautiena", ingredients: ["Jautienos antrekotas", "Krevetės", "Žolelių sviestas", "Citrina"], allergens: ["Pienas", "Vėžiagyviai"], badge: "Premium" },
  { id: "ja3", name: "Avienos kebabas", description: "Maltos avienos kebabas su kmynų, kalendrų prieskoniais ir jogurto mėtos padažu.", price: 18.00, image: IMG.lambKebabFixed, category: "jautiena", ingredients: ["Malta aviena", "Kmynai", "Kalendra", "Jogurtas", "Mėta"], allergens: ["Pienas"] },
  { id: "ja4", name: "Ėrienos karka su traiškyta bulve ir raugintais kopūstais", description: "Prancūziškai paruošta ėrienos karka su rozmarino padažu ir tradiciniais lietuviškais garnyrai.", price: 22.00, image: IMG.lambRack, category: "jautiena", ingredients: ["Ėrienos karka", "Rozmarinas", "Česnakai", "Traiškyta bulvė", "Rauginti kopūstai"], allergens: [] },

  // ŽUVIS
  { id: "z1", name: "Skumbrė", description: "Grilyje kepta skumbrė su citrininiu sviestu ir daržovėmis.", price: 17.90, image: IMG.mackerel, category: "zuvis", ingredients: ["Skumbrė", "Citrinis sviestas", "Daržovės", "Krapai"], allergens: ["Žuvis", "Pienas"] },
  { id: "z2", name: "Menkės kepsnys", description: "Keptas menkės filė su aioli padažu ir grilintomis daržovėmis.", price: 17.90, image: IMG.cod, category: "zuvis", ingredients: ["Menkė", "Aioli padažas", "Daržovės"], allergens: ["Žuvis", "Pienas", "Kiaušiniai"] },
  { id: "z3", name: "Grilyje keptos krevetės", description: "Karališkos krevetės, keptos su česnaku, čili dribsniais ir petražolėmis.", price: 18.50, image: IMG.shrimp, category: "zuvis", ingredients: ["Karališkos krevetės", "Česnakai", "Čili", "Petražolės", "Citrina"], allergens: ["Vėžiagyviai", "Pienas"] },
  { id: "z4", name: "Jūros ešerys", description: "Visas jūros ešerys, keptas druskos plutoje su Viduržemio jūros žolelėmis.", price: 19.90, image: IMG.seabass, category: "zuvis", ingredients: ["Jūros ešerys", "Druska", "Čiobrelis", "Citrina", "Alyvuogių aliejus"], allergens: ["Žuvis"] },
  { id: "z5", name: "Lašišos kepsnys", description: "Atlanto lašišos filė su citrininiu sviestu, kaparėliais ir šparagais.", price: 20.90, image: IMG.salmon, category: "zuvis", ingredients: ["Lašišos filė", "Citrinis sviestas", "Kaparėliai", "Šparagai", "Krapai"], allergens: ["Žuvis", "Pienas"], badge: "Šefo pasirinkimas", featured: true },
  { id: "z6", name: "Tuno kepsnys", description: "Skrudinto tuno filė su sezamo pluta ir Azijos stiliaus salotomis.", price: 23.90, image: IMG.tuna, category: "zuvis", ingredients: ["Tuno filė", "Sezamas", "Sojos padažas", "Imbieras", "Salotos"], allergens: ["Žuvis", "Soja"] },
  { id: "z7", name: "Aštuonkojis su ananasu", description: "Švelnus grilintas aštuonkojis su karamelizuotu ananasu, paprika aliejumi ir žolelėmis.", price: 27.90, image: IMG.octopus, category: "zuvis", ingredients: ["Aštuonkojis", "Ananasas", "Paprika", "Alyvuogių aliejus", "Žolelės"], allergens: ["Moliuskai"], badge: "Naujiena" },

  // VAIKIŠKAS MENIU
  { id: "vm1", name: "Gruzdintos bulvytės su pomidorų padažu", description: "Auksinės traškios bulvytės su kečupu.", price: 7.00, image: IMG.fries, category: "vaikiskas", ingredients: ["Bulvės", "Kečupas", "Druska"], allergens: [] },
  { id: "vm2", name: "Lietiniai blyneliai su vyšnių padažu", description: "Ploni minkšti blyneliai su saldžiu vyšnių padažu.", price: 7.00, image: IMG.kids, category: "vaikiskas", ingredients: ["Miltai", "Kiaušiniai", "Pienas", "Vyšnių padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "vm3", name: "Traškios vištienos juostelės su gruzdintomis bulvytėmis ir šviežiomis daržovėmis", description: "Vaikams mėgstamos vištienos juostelės su traškiomis bulvytėmis ir daržovėmis.", price: 11.90, image: IMG.kidsChickenTenders, category: "vaikiskas", ingredients: ["Vištienos krūtinėlė", "Džiūvėsėliai", "Bulvytės", "Daržovės"], allergens: ["Glitimas", "Kiaušiniai"] },

  // UŽKANDŽIAI PRIE ALAUS
  { id: "pa1", name: "Kepta duona su česnaku", description: "Traški kepta juoda duona su česnakų sviestu.", price: 7.00, image: IMG.bread, category: "prie-alaus", ingredients: ["Juoda duona", "Česnakai", "Sviestas"], allergens: ["Glitimas", "Pienas"] },
  { id: "pa2", name: "Kepta duona su karštu sūriu", description: "Kepta duona su ištirpusiu sūriu ir česnakais.", price: 8.50, image: IMG.cheeseToast, category: "prie-alaus", ingredients: ["Duona", "Sūris", "Česnakai", "Sviestas"], allergens: ["Glitimas", "Pienas"] },
  { id: "pa3", name: "Alyvuogės (100g)", description: "Marinuotos Viduržemio jūros alyvuogių mišinys.", price: 3.90, image: IMG.olives, category: "prie-alaus", ingredients: ["Alyvuogės", "Žolelės", "Alyvuogių aliejus"], allergens: [] },
  { id: "pa4", name: "Grilyje keptas Kamambero sūris su braškėmis ir šilauogėmis", description: "Šiltas Kamambero sūris su šviežiomis sezoninėmis uogomis.", price: 9.90, image: IMG.camembert, category: "prie-alaus", ingredients: ["Kamambero sūris", "Braškės", "Šilauogės", "Medus"], allergens: ["Pienas"] },
  { id: "pa5", name: "Užkandis su Burrata sūriu", description: "Kreminis Burrata sūris su vyšniniais pomidorais ir baziliku.", price: 10.90, image: IMG.burrata, category: "prie-alaus", ingredients: ["Burrata", "Vyšniniai pomidorai", "Bazilikas", "Alyvuogių aliejus"], allergens: ["Pienas"] },
  { id: "pa6", name: "Užkandėlė prie vyno", description: "Įvairių sūrių, kumpio ir šviežių vaisių lėkštė.", price: 18.00, image: IMG.cheese, category: "prie-alaus", ingredients: ["Sūriai", "Vytintas kumpis", "Vaisiai", "Riešutai"], allergens: ["Pienas", "Riešutai"] },
  { id: "pa7", name: "Šiltų užkandžių padėklas", description: "Asortimentas šiltų užkandžių puikiai tinkantis prie alaus.", price: 22.00, image: IMG.snackPlatter, category: "prie-alaus", ingredients: ["Kepta duona", "Sūris", "Mėsos užkandžiai"], allergens: ["Glitimas", "Pienas"] },
  { id: "pa8", name: "Užkanda prie alaus (2 asmenims)", description: "Rinktinių užkandžių rinkinys 2 asmenims prie alaus.", price: 16.00, image: IMG.snackPlatter, category: "prie-alaus", ingredients: ["Kepta duona", "Traškūs užkandžiai", "Padažas"], allergens: ["Glitimas"] },
  { id: "pa9", name: "Užkanda prie alaus (4 asmenims)", description: "Rinktinių užkandžių rinkinys 4 asmenims prie alaus.", price: 27.00, image: IMG.snackPlatter, category: "prie-alaus", ingredients: ["Kepta duona", "Traškūs užkandžiai", "Padažas"], allergens: ["Glitimas"] },
  { id: "pa10", name: "Skrudintos mocarelos lazdelės (100g)", description: "Traškios mocarelos lazdelės su marinara padažu.", price: 3.90, image: IMG.mozzarellaSticks, category: "prie-alaus", ingredients: ["Mocarela", "Džiūvėsėliai", "Marinara padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "pa11", name: "Traškūs kalmarų žiedai (100g)", description: "Traškiai apkepti kalmarų žiedai su aioli.", price: 3.90, image: IMG.calamariFixed, category: "prie-alaus", ingredients: ["Kalmarai", "Džiūvėsėliai", "Aioli"], allergens: ["Glitimas", "Moliuskai", "Kiaušiniai"] },
  { id: "pa12", name: "Traškus jalapeno užkandis (100g)", description: "Įdaryti jalapeno pipirai, apkepti džiūvėsėliuose.", price: 3.90, image: IMG.jalapenoFixed, category: "prie-alaus", ingredients: ["Jalapeno pipirai", "Sūris", "Džiūvėsėliai"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "pa13", name: "Traškūs svogūnų žiedai (100g)", description: "Auksiniai svogūnų žiedai su rančo padažu.", price: 3.90, image: IMG.onionRings, category: "prie-alaus", ingredients: ["Svogūnai", "Tešla", "Rančo padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "pa14", name: "Traškios sūrio spurgytės (200g)", description: "Pūkuotos sūrio spurgytės su pomidorų padažu.", price: 7.50, image: IMG.cheese, category: "prie-alaus", ingredients: ["Sūris", "Miltai", "Kiaušiniai"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "pa15", name: "Padažas pasirinkti", description: "Pasirinkite mėgstamą padažą: majonezo, kečupo, BBQ, aioli ar rančo.", price: 2.50, image: IMG.sauceBowl, category: "prie-alaus", ingredients: ["Padažas"], allergens: ["Kiaušiniai"] },

  // DESERTAI
  { id: "d1", name: "Napoleonas", description: "Klasikinis sluoksniuoto tešlos Napoleonas su vaniliniu kremu.", price: 5.90, image: IMG.napoleon, category: "desertai", ingredients: ["Sluoksniuota tešla", "Vanilinis kremas", "Cukraus pudra"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"], featured: true, badge: "Tradicinis" },
  { id: "d2", name: "Rikotos sūrio pyragas", description: "Lengvas ir kreminis rikotos sūrio pyragas su uogų kompostu.", price: 5.90, image: IMG.cheesecake, category: "desertai", ingredients: ["Ricotta", "Grietinėlė", "Uogų kompostas", "Sausainis"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "d3", name: "Austriškas obuolių pyragas su vaniliniu padažu", description: "Šiltas obuolių pyragas austrišku receptu su vaniliniu padažu.", price: 5.90, image: IMG.applePie, category: "desertai", ingredients: ["Obuoliai", "Tešla", "Cinamonas", "Vanilinis padažas"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "d4", name: "Morengų pyragas Pavlova", description: "Traški meringė su plakta grietinėle ir šviežiomis braškėmis bei pasiflorų tyrelė.", price: 8.90, image: IMG.pavlova, category: "desertai", ingredients: ["Meringė", "Plakta grietinėlė", "Braškės", "Pasifloros"], allergens: ["Pienas", "Kiaušiniai"], badge: "Populiaru" },
  { id: "d5", name: "Šokoladinis braunis su mūsų gamybos ledais", description: "Šiltas tamsaus šokolado braunis su namų gamybos vaniliniu ledu ir karamelės padažu.", price: 7.50, image: IMG.brownie, category: "desertai", ingredients: ["Tamsus šokoladas", "Sviestas", "Kiaušiniai", "Miltai", "Vanilinis ledas", "Karamelė"], allergens: ["Glitimas", "Pienas", "Kiaušiniai"] },
  { id: "d6", name: "Vaniliniai ledai su įvairių skonių padažu", description: "Kreminis vanilinis ledas su pasirinktu uogų ar šokolado padažu.", price: 6.00, image: IMG.icecream, category: "desertai", ingredients: ["Vanilinis ledas", "Padažas pagal pasirinkimą"], allergens: ["Pienas"] },
  { id: "d7", name: "Vaniliniai ledai su alaus sirupu ir duonos traškučiais", description: "Unikalus desertas su alaus sirupu ir traškiais ruginės duonos gabaliukais.", price: 6.50, image: IMG.beerIcecream, category: "desertai", ingredients: ["Vanilinis ledas", "Alaus sirupas", "Ruginė duona"], allergens: ["Pienas", "Glitimas"] },
  { id: "d8", name: "Citrininis šerbetas", description: "Gaivus citrinų šerbetas su šviežios citrinos žievele.", price: 6.90, image: IMG.sorbet, category: "desertai", ingredients: ["Citrinų sultys", "Cukrus", "Vanila"], allergens: [] },
  { id: "d9", name: "Kokosiniai ledai", description: "Kreminis kokosų ledas su tostintu kokosų drožlių papuošimu.", price: 6.90, image: IMG.coconutIce, category: "desertai", ingredients: ["Kokosų pienas", "Kokosų drožlės", "Cukrus"], allergens: [] },

  // LIMONADAI IR KOKTEILIAI
  { id: "lim1", name: "Kokosų – žemuogių limonadas (0,3l)", description: "Namų gamybos limonadas su kokosų ir žemuogių skoniais.", price: 4.00, image: IMG.lemonade, category: "limonadai", ingredients: ["Kokosai", "Žemuogės", "Citrina", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim1-1l", name: "Kokosų – žemuogių limonadas (1l)", description: "Namų gamybos limonadas su kokosų ir žemuogių skoniais.", price: 9.90, image: IMG.lemonade, category: "limonadai", ingredients: ["Kokosai", "Žemuogės", "Citrina", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim2", name: "Greipfrutų limonadas (0,3l)", description: "Gaivus namų gamybos greipfrutų limonadas.", price: 4.00, image: IMG.lemonade2, category: "limonadai", ingredients: ["Greipfrutas", "Citrina", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim2-1l", name: "Greipfrutų limonadas (1l)", description: "Gaivus namų gamybos greipfrutų limonadas.", price: 9.90, image: IMG.lemonade2, category: "limonadai", ingredients: ["Greipfrutas", "Citrina", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim3", name: "Pasiflorų limonadas (0,3l)", description: "Egzotiškas pasiflorų limonadas su šviežios citrinos rūgštumu.", price: 4.00, image: IMG.lemonade, category: "limonadai", ingredients: ["Pasiflora", "Citrina", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim3-1l", name: "Pasiflorų limonadas (1l)", description: "Egzotiškas pasiflorų limonadas su šviežios citrinos rūgštumu.", price: 9.90, image: IMG.lemonade, category: "limonadai", ingredients: ["Pasiflora", "Citrina", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim4", name: "Citrusinių vaisių limonadas (0,3l)", description: "Tradicinis namų gamybos citrusinių vaisių limonadas.", price: 4.00, image: IMG.lemonade, category: "limonadai", ingredients: ["Citrina", "Apelsinas", "Greipfrutas", "Cukrus", "Vanduo"], allergens: [], featured: true },
  { id: "lim4-1l", name: "Citrusinių vaisių limonadas (1l)", description: "Tradicinis namų gamybos citrusinių vaisių limonadas.", price: 9.90, image: IMG.lemonade, category: "limonadai", ingredients: ["Citrina", "Apelsinas", "Greipfrutas", "Cukrus", "Vanduo"], allergens: [] },
  { id: "lim5", name: "Kokteilis ŠALTUKAS", description: "Gaivus nealkoholinis namų gamybos kokteilis.", price: 5.50, image: IMG.lemonade, category: "limonadai", ingredients: ["Vaisių sultys", "Ledas", "Gazuotas vanduo"], allergens: [] },
  { id: "lim6", name: "Kokteilis VYNUOGIUKAS", description: "Vynuogių ir citrinos namų gamybos nealkoholinis kokteilis.", price: 5.50, image: IMG.lemonade, category: "limonadai", ingredients: ["Vynuogės", "Citrina", "Cukrus", "Gazuotas vanduo"], allergens: [] },
  { id: "lim7", name: "Pieniški kokteiliai (vanilinis, šokoladinis, braškinis)", description: "Tiršti pieniški kokteiliai su ledais.", price: 5.50, image: IMG.milkshake, category: "limonadai", ingredients: ["Pienas", "Ledai", "Skonis pagal pasirinkimą"], allergens: ["Pienas"] },
  { id: "lim8", name: "Trintų vaisių kokteilis", description: "Šviežių sezoninių vaisių trintas kokteilis.", price: 5.50, image: IMG.smoothie, category: "limonadai", ingredients: ["Sezoniniai vaisiai", "Ledas", "Vanduo"], allergens: [] },
  { id: "lim9", name: "Tirštas ledų kokteilis", description: "Ypač tirštas ir kreminis ledų kokteilis.", price: 7.90, image: IMG.milkshake, category: "limonadai", ingredients: ["Ledai", "Pienas", "Grietinėlė"], allergens: ["Pienas"] },
  { id: "lim10", name: "Žaliasis kokteilis", description: "Sveikas žaliasis kokteilis su špinatais, obuoliu ir imbieru.", price: 5.50, image: IMG.smoothie, category: "limonadai", ingredients: ["Špinatai", "Obuolys", "Imbieras", "Citrina"], allergens: [] },
  { id: "lim11", name: "Gaivusis persikų – mangų gėrimas (1l)", description: "Gaivus persikų ir mangų namų gamybos gėrimas.", price: 9.90, image: IMG.lemonade, category: "limonadai", ingredients: ["Persikai", "Mangai", "Citrina", "Cukrus"], allergens: [] },
  { id: "lim12", name: "Gaivusis mėlynių – gervuogių gėrimas (1l)", description: "Gaivus mėlynių ir gervuogių namų gamybos gėrimas.", price: 9.90, image: IMG.lemonade, category: "limonadai", ingredients: ["Mėlynės", "Gervuogės", "Citrina", "Cukrus"], allergens: [] },
  { id: "lim13", name: "Šviežiai spaustos sultys (0,2l)", description: "Šviežiai spaustos apelsinų arba obuolių sultys.", price: 5.50, image: IMG.juice, category: "limonadai", ingredients: ["Šviežiai spaustos sultys"], allergens: [] },

  // NEALKOHOLINIS ALUS IR SIDRAS
  { id: "na1", name: "Clausthaler Pale Lager (0,33l)", description: "Nealkoholinis šviesioji lageris.", price: 4.20, image: IMG.nonAlcBeer, category: "nealko-alus", ingredients: ["Miežių salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"] },
  { id: "na2", name: "Paulaner Weisbier Alkoholfree (0,5l)", description: "Nealkoholinis kvietinis alus iš Miuncheno.", price: 4.90, image: IMG.nonAlcBeer, category: "nealko-alus", ingredients: ["Kvietiniai miltai", "Miežių salyklas", "Mielės"], allergens: ["Glitimas"] },
  { id: "na3", name: "Tinginio pantis sidras Alkoholfree (0,33l)", description: "Nealkoholinis obuolių sidras.", price: 4.80, image: IMG.nonAlcBeer, category: "nealko-alus", ingredients: ["Obuoliai", "Cukrus"], allergens: [] },

  // KAVA IR ARBATA
  { id: "kav1", name: "Espresso", description: "Klasikinis espresso iš šviežiai maltų kavos pupelių.", price: 2.50, image: IMG.coffee, category: "kava", ingredients: ["Arabika kavos pupelės"], allergens: [] },
  { id: "kav2", name: "Juoda kava", description: "Tradicinė juoda kava.", price: 2.50, image: IMG.coffee, category: "kava", ingredients: ["Kavos pupelės", "Vanduo"], allergens: [] },
  { id: "kav3", name: "Kava su pienu", description: "Švelnios juodos kavos su pienu derinys.", price: 3.00, image: IMG.coffee, category: "kava", ingredients: ["Kavos pupelės", "Pienas"], allergens: ["Pienas"] },
  { id: "kav4", name: "Latte", description: "Espresso su garuojančiu pienu ir plona putos danga.", price: 3.70, image: IMG.coffee, category: "kava", ingredients: ["Espresso", "Garinto pienas", "Puta"], allergens: ["Pienas"] },
  { id: "kav5", name: "Cappuccino", description: "Espresso su lygiais dalimis garuojančio pieno ir pieno putos.", price: 3.50, image: IMG.coffee, category: "kava", ingredients: ["Espresso", "Garinto pienas", "Puta"], allergens: ["Pienas"] },
  { id: "kav6", name: "Matcha", description: "Tradicinis japoniškas matcha žaliosios arbatos latte.", price: 4.90, image: IMG.tea, category: "kava", ingredients: ["Matcha milteliai", "Pienas", "Vanduo"], allergens: ["Pienas"] },
  { id: "kav7", name: "Plikoma arbata", description: "Pasirinkite iš plataus arbatų asortimento.", price: 3.50, image: IMG.tea, category: "kava", ingredients: ["Arbatos lapeliai", "Vanduo"], allergens: [] },
  { id: "kav8", name: "Šaltalankių arbata", description: "Šaltalankių arbata, turtinga vitamino C.", price: 3.50, image: IMG.tea, category: "kava", ingredients: ["Šaltalankiai", "Vanduo"], allergens: [] },
  { id: "kav9", name: "Svarainių arbata", description: "Aromatingų svarainių vaisių arbata.", price: 3.50, image: IMG.tea, category: "kava", ingredients: ["Svarainiai", "Vanduo"], allergens: [] },
  { id: "kav10", name: "Šaltalankių arbata su imbieru", description: "Energinga šaltalankių ir imbiero arbata.", price: 3.50, image: IMG.tea, category: "kava", ingredients: ["Šaltalankiai", "Imbieras", "Vanduo"], allergens: [] },
  { id: "kav11", name: "Aviečių arbata", description: "Saldžių aviečių arbata.", price: 3.50, image: IMG.tea, category: "kava", ingredients: ["Avietės", "Vanduo"], allergens: [] },
  { id: "kav12", name: "Pasiflorų arbata", description: "Egzotiška pasiflorų arbata.", price: 3.50, image: IMG.tea, category: "kava", ingredients: ["Pasifloros", "Vanduo"], allergens: [] },
  { id: "kav13", name: "Augalinis pienas (papildomai)", description: "Augalinis pienas prie kavos ar arbatos.", price: 0.60, image: IMG.coffee, category: "kava", ingredients: ["Augalinis pienas"], allergens: [] },

  // GAIVIEJI GĖRIMAI
  { id: "gg1", name: "Vandens ąsotis", description: "Gaivinantis vanduo su citrinos skiltelėmis.", price: 2.00, image: IMG.water, category: "gerimai", ingredients: ["Vanduo", "Citrina"], allergens: [] },
  { id: "gg2", name: "Gazuotas vanduo (0,5l)", description: "Gazuotas mineralinis vanduo.", price: 2.00, image: IMG.water, category: "gerimai", ingredients: ["Gazuotas vanduo"], allergens: [] },
  { id: "gg3", name: "Mineralinis vanduo (0,33l)", description: "Natūralus mineralinis vanduo.", price: 2.50, image: IMG.water, category: "gerimai", ingredients: ["Mineralinis vanduo"], allergens: [] },
  { id: "gg4", name: "Sultys (0,2l)", description: "Pasirinkite iš obuolių, apelsinų ar pomidorų sulčių.", price: 2.50, image: IMG.juice, category: "gerimai", ingredients: ["Vaisių sultys"], allergens: [] },
  { id: "gg5", name: "Sprite, Coca Cola, Coca Cola Light, Fanta, Schweppes (0,25l)", description: "Populiarūs gaivieji gėrimai.", price: 2.90, image: IMG.softdrink, category: "gerimai", ingredients: ["Gazuotas vanduo", "Cukrus", "Aromatas"], allergens: [] },
  { id: "gg6", name: "Pilstoma Gira (0,3l)", description: "Tradicinė lietuviška gira.", price: 3.50, image: IMG.kvass, category: "gerimai", ingredients: ["Ruginė duona", "Mielės", "Vanduo", "Cukrus"], allergens: ["Glitimas"] },
  { id: "gg6-05", name: "Pilstoma Gira (0,5l)", description: "Tradicinė lietuviška gira.", price: 4.50, image: IMG.kvass, category: "gerimai", ingredients: ["Ruginė duona", "Mielės", "Vanduo", "Cukrus"], allergens: ["Glitimas"] },
  { id: "gg7", name: "Red Bull (0,25l)", description: "Energetinis gėrimas.", price: 3.50, image: IMG.softdrink, category: "gerimai", ingredients: ["Taurinas", "Kofeinas", "B grupės vitaminai"], allergens: [] },
  { id: "gg8", name: "ACALA (0,75l)", description: "Premium aukštos kokybės vanduo.", price: 15.00, image: IMG.water, category: "gerimai", ingredients: ["Grynas natūralus vanduo"], allergens: [] },

  // DZŪKŲ ALAUS DARYKLA
  { id: "al1", name: "Čystas 5% (0,3l)", description: "Šviesusis lageris.", price: 3.90, image: IMG.beer, category: "alus", ingredients: ["Miežių salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"], badge: "Namų darykla", featured: true },
  { id: "al1-05", name: "Čystas 5% (0,5l)", description: "Šviesusis lageris.", price: 5.40, image: IMG.beer, category: "alus", ingredients: ["Miežių salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al1-1l", name: "Čystas 5% (1l)", description: "Šviesusis lageris.", price: 7.90, image: IMG.beer, category: "alus", ingredients: ["Miežių salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al2", name: "Šposas 5,5% (0,3l)", description: "Tamsusis lageris.", price: 4.00, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al2-05", name: "Šposas 5,5% (0,5l)", description: "Tamsusis lageris.", price: 5.50, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al2-1l", name: "Šposas 5,5% (1l)", description: "Tamsusis lageris.", price: 8.10, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Apyniai", "Mielės", "Vanduo"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al3", name: "Kviecinis 4,5% (0,3l)", description: "Kvietinis alus.", price: 4.00, image: IMG.beer, category: "alus", ingredients: ["Kvietiniai miltai", "Miežių salyklas", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al3-05", name: "Kviecinis 4,5% (0,5l)", description: "Kvietinis alus.", price: 5.50, image: IMG.beer, category: "alus", ingredients: ["Kvietiniai miltai", "Miežių salyklas", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al3-1l", name: "Kviecinis 4,5% (1l)", description: "Kvietinis alus.", price: 8.10, image: IMG.beer, category: "alus", ingredients: ["Kvietiniai miltai", "Miežių salyklas", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al4", name: "Razumnas 6,3% (0,3l)", description: "Saldusis stautas su kakava.", price: 4.10, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Kakava", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al4-05", name: "Razumnas 6,3% (0,5l)", description: "Saldusis stautas su kakava.", price: 5.60, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Kakava", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al4-1l", name: "Razumnas 6,3% (1l)", description: "Saldusis stautas su kakava.", price: 8.30, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Kakava", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al5", name: "Spakainas 5,4% (0,3l)", description: "Amerikietiškas Indijos šviesusis elis.", price: 4.10, image: IMG.beer, category: "alus", ingredients: ["Salyklas", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al5-05", name: "Spakainas 5,4% (0,5l)", description: "Amerikietiškas Indijos šviesusis elis.", price: 5.60, image: IMG.beer, category: "alus", ingredients: ["Salyklas", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al5-1l", name: "Spakainas 5,4% (1l)", description: "Amerikietiškas Indijos šviesusis elis.", price: 8.30, image: IMG.beer, category: "alus", ingredients: ["Salyklas", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al6", name: "Slyvinis Porteris 7,2% (0,3l)", description: "Slyvinis porteris.", price: 4.10, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Slyvos", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al6-05", name: "Slyvinis Porteris 7,2% (0,5l)", description: "Slyvinis porteris.", price: 5.60, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Slyvos", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al6-1l", name: "Slyvinis Porteris 7,2% (1l)", description: "Slyvinis porteris.", price: 8.30, image: IMG.beer2, category: "alus", ingredients: ["Tamsus salyklas", "Slyvos", "Apyniai", "Mielės"], allergens: ["Glitimas"], badge: "Namų darykla" },
  { id: "al7", name: "Sezoninis alus", description: "Teiraukitės padavėjo dėl šio mėnesio sezoniško alaus.", price: 0, image: IMG.beer, category: "alus", ingredients: ["Klauskite padavėjo"], allergens: ["Glitimas"], badge: "Sezoniška" },
  { id: "al8", name: "Alaus degustacija", description: "Degustuokite visus mūsų namų gamybos alus — 6 mini taurės.", price: 14.00, image: IMG.beerTasting, category: "alus", ingredients: ["Visi Dzūkų daryklos alūs"], allergens: ["Glitimas"] },

  // SIDRAS
  { id: "sid1", name: "Tinginio pantis sidras 4,5% (0,33l)", description: "Lietuviškas obuolių sidras su švelniu ir gaiviu skoniu.", price: 4.80, image: IMG.cider, category: "sidras", ingredients: ["Obuoliai", "Cukrus", "Mielės"], allergens: [] },
  { id: "sid2", name: "Sidras pilstomas (0,3l)", description: "Pilstomas obuolių sidras.", price: 5.00, image: IMG.cider, category: "sidras", ingredients: ["Obuoliai", "Cukrus", "Mielės"], allergens: [] },
  { id: "sid2-05", name: "Sidras pilstomas (0,5l)", description: "Pilstomas obuolių sidras.", price: 6.50, image: IMG.cider, category: "sidras", ingredients: ["Obuoliai", "Cukrus", "Mielės"], allergens: [] },

  // ALAUS IR SIDRO KOKTEILIAI
  { id: "ak1", name: "Braciukas", description: "Originalus alaus ir vaisių sulčių kokteilis.", price: 9.50, image: IMG.beer, category: "alus-kokteiliai", ingredients: ["Alus", "Vaisių sultys"], allergens: ["Glitimas"] },
  { id: "ak2", name: "Kodėl gi ne?", description: "Gaivus alaus kokteilius su limonado priedu.", price: 9.50, image: IMG.beer, category: "alus-kokteiliai", ingredients: ["Alus", "Limonadas", "Citrina"], allergens: ["Glitimas"] },
  { id: "ak3", name: "Gyvatės kirtis", description: "Pusiau alaus, pusiau sidro klasikinis britiškų paplūdimių kokteilis.", price: 9.50, image: IMG.cider, category: "alus-kokteiliai", ingredients: ["Alus", "Sidras"], allergens: ["Glitimas"] },
  { id: "ak4", name: "Galimai", description: "Lengvas alaus kokteilius su citrusų aromatu.", price: 9.50, image: IMG.beer, category: "alus-kokteiliai", ingredients: ["Alus", "Citrusų sultys", "Gazuotas vanduo"], allergens: ["Glitimas"] },
  { id: "ak5", name: "Balta pieva", description: "Kvietinio alaus kokteilis su citrina ir baziliku.", price: 9.50, image: IMG.beer, category: "alus-kokteiliai", ingredients: ["Kvietinis alus", "Citrina", "Bazilikas"], allergens: ["Glitimas"] },

  // KOKTEILIAI – ALKOHOLINIAI
  { id: "ko1", name: "Gaivusis bravoras", description: "Namų signatūros kokteilius su lengvu ir gaiviu skoniu.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Degtinė", "Limonadas", "Citrina", "Mėta"], allergens: [] },
  { id: "ko2", name: "Gin / Tonic", description: "Premium džinas su Fever-Tree toniku, šviežia citrina ir botaniniais priedais.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Džinas", "Tonik vanduo", "Citrina", "Botaniški priedai"], allergens: [] },
  { id: "ko3", name: "Whiskey Sour", description: "Klasikinis kokteilius su viskiu, šviežia citrinos sultis ir cukraus sirupu.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Viskis", "Citrinų sultys", "Cukraus sirupas", "Kiaušinio baltymas"], allergens: ["Kiaušiniai"] },
  { id: "ko4", name: "Akimirka", description: "Namų signatūros kokteilius — staigmena kiekvienam.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Klauskite padavėjo"], allergens: [] },
  { id: "ko5", name: "Rožinis šūvis", description: "Gaivus rožinis kokteilius su vaisių skoniais.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Džinas", "Avietės", "Rožinis tonik", "Citrina"], allergens: [] },
  { id: "ko6", name: "Aviečių bučinys", description: "Saldus avietių kokteilius su votka ir citrusiniu poskoniu.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Degtinė", "Avietės", "Citrina", "Cukraus sirupas"], allergens: [] },
  { id: "ko7", name: "Mango bučinys", description: "Tropinis mango kokteilius su romų baze.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Romas", "Mango tyrelė", "Citrina", "Gazuotas vanduo"], allergens: [] },
  { id: "ko8", name: "Aperol Spritz", description: "Klasikinis italų aperityvas su Aperoliu, proseku ir gazuotu vandeniu.", price: 10.50, image: IMG.aperol, category: "kokteiliai", ingredients: ["Aperol", "Prosecco", "Gazuotas vanduo", "Apelsinas"], allergens: [] },
  { id: "ko9", name: "Braškinis Mojito", description: "Klasikinis Mojito su šviežiomis braškėmis.", price: 10.50, image: IMG.mojito, category: "kokteiliai", ingredients: ["Baltas romas", "Braškės", "Mėta", "Citrina", "Cukraus sirupas", "Soda"], allergens: [] },
  { id: "ko10", name: "Cuba Libre", description: "Klasikinis kubietiškas romo ir Coca-Cola kokteilius su citrinos skiltele.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Baltas romas", "Coca-Cola", "Citrina", "Ledas"], allergens: [] },
  { id: "ko11", name: "Porn Star Martini", description: "Garsus Londono kokteilius su Pasoa, vanilija, ananasų sultimis ir Prosecco.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Degtinė", "Pasoa", "Vanilija", "Ananasų sultys", "Prosecco"], allergens: [] },
  { id: "ko12", name: "Marabella Tropicano", description: "Tropinis kokteilius su rumu, ananasais ir kokosų kremu.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Romas", "Ananasų sultys", "Kokosų kremas", "Citrina"], allergens: ["Pienas"] },
  { id: "ko13", name: "Mai-Tai", description: "Klasikinis polinezietiškas kokteilius su dviem romų rūšimis ir vaisių sultimis.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Romas", "Tamsus romas", "Ananasų sultys", "Apelsino curaçao"], allergens: [] },
  { id: "ko14", name: "Mango Spritz", description: "Gaivus mango ir Prosecco spritz.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Mango tyrelė", "Prosecco", "Gazuotas vanduo", "Citrina"], allergens: [] },
  { id: "ko15", name: "Svaigulys", description: "Namų stiliaus kokteilius su viskiu ir saldintu citrusų poskoniu.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Viskis", "Medaus sirupas", "Citrina"], allergens: [] },
  { id: "ko16", name: "Espresso Martini", description: "Degtinė, plauktas su šviežiu espresso, kavos likeriu ir vanilija.", price: 10.50, image: IMG.espressoMartini, category: "kokteiliai", ingredients: ["Degtinė", "Espresso", "Kavos likeris", "Vanilijos sirupas"], allergens: [], badge: "Populiaru" },
  { id: "ko17", name: "Kokteilis naujiena", description: "Klauskite padavėjo apie šio sezono naujieną.", price: 10.50, image: IMG.cocktail, category: "kokteiliai", ingredients: ["Klauskite padavėjo"], allergens: [], badge: "Naujiena" },
  // NEALKOHOLINIAI KOKTEILIAI
  { id: "ko18", name: "Mojito (nealkoholinis)", description: "Gaivus nealkoholinis Mojito su mėta, citrina ir soda.", price: 9.50, image: IMG.mojito, category: "kokteiliai", ingredients: ["Mėta", "Citrina", "Cukraus sirupas", "Soda", "Ledas"], allergens: [], badge: "Nealk." },
  { id: "ko19", name: "Mai Tai (nealkoholinis)", description: "Tropinis nealkoholinis kokteilius su ananasų ir kokosų skoniais.", price: 9.50, image: IMG.aperol, category: "kokteiliai", ingredients: ["Ananasų sultys", "Kokosų kremas", "Apelsinas", "Ledas"], allergens: ["Pienas"], badge: "Nealk." },
  { id: "ko20", name: "Aperol Spritz (nealkoholinis)", description: "Gaivus nealkoholinis Aperol Spritz alternatyvus kokteilius.", price: 9.50, image: IMG.aperol, category: "kokteiliai", ingredients: ["Nealkoholinis Aperol alternatyva", "Gazuotas vanduo", "Apelsinas"], allergens: [], badge: "Nealk." },

  // STIPRIEJI GĖRIMAI – DEGTINĖ
  { id: "sp1", name: "Originali lietuviška auksinė degtinė (40ml)", description: "", price: 3.70, image: IMG.spirits, category: "stiprieji", ingredients: ["Degtinė"], allergens: [] },
  { id: "sp2", name: "Finlandia (40ml)", description: "", price: 4.10, image: IMG.spirits, category: "stiprieji", ingredients: ["Degtinė"], allergens: [] },
  { id: "sp3", name: "Stumbras Premium Organic (40ml)", description: "", price: 4.50, image: IMG.spirits, category: "stiprieji", ingredients: ["Organinė degtinė"], allergens: [] },
  { id: "sp4", name: "Apynio krištolinis (40ml)", description: "", price: 5.50, image: IMG.spirits, category: "stiprieji", ingredients: ["Degtinė"], allergens: [] },
  { id: "sp5", name: "Grey Goose (40ml)", description: "", price: 6.50, image: IMG.spirits, category: "stiprieji", ingredients: ["Prancūziška degtinė"], allergens: [] },
  // BRENDIS
  { id: "sp6", name: "J.P. Chanet XO brendis (40ml)", description: "", price: 4.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Brendis"], allergens: [] },
  { id: "sp7", name: "Torres 5 brendis (40ml)", description: "", price: 4.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Brendis"], allergens: [] },
  // KONJAKAS
  { id: "sp8", name: "Martell VSOP konjakas (40ml)", description: "", price: 7.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Konjakas"], allergens: [] },
  // VISKIS
  { id: "sp9", name: "Jameson (40ml)", description: "", price: 5.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Airiškas viskis"], allergens: [] },
  { id: "sp10", name: "Proper No Twelve (40ml)", description: "", price: 5.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Airiškas viskis"], allergens: [] },
  { id: "sp11", name: "Shankey's Whip Irish Whiskey Liquer (40ml)", description: "", price: 5.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Airiškas viskio likeris"], allergens: [] },
  { id: "sp12", name: "Jack Daniel's (40ml)", description: "", price: 5.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Tenesis viskis"], allergens: [] },
  { id: "sp13", name: "Monkey Shoulder (40ml)", description: "", price: 6.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Škotiškas malt viskis"], allergens: [] },
  { id: "sp14", name: "Chivas Regal 12 (40ml)", description: "", price: 6.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Škotiškas blended viskis"], allergens: [] },
  { id: "sp15", name: "Nikka All Malt (40ml)", description: "", price: 6.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Japoniškas viskis"], allergens: [] },
  { id: "sp16", name: "Ledaig 10YO Isle of Mull Single Malt (40ml)", description: "", price: 8.10, image: IMG.spirits, category: "stiprieji", ingredients: ["Škotiškas single malt"], allergens: [] },
  // TEKILA
  { id: "sp17", name: "Jose Cuervo Traditional Silver (40ml)", description: "", price: 5.20, image: IMG.spirits, category: "stiprieji", ingredients: ["Tekila"], allergens: [] },
  { id: "sp18", name: "Jose Cuervo Traditional Reposado (40ml)", description: "", price: 5.20, image: IMG.spirits, category: "stiprieji", ingredients: ["Tekila"], allergens: [] },
  { id: "sp19", name: "Don Julio Reposado (40ml)", description: "", price: 7.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Premium tekila"], allergens: [] },
  { id: "sp20", name: "Don Julio Blanco (40ml)", description: "", price: 7.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Premium tekila"], allergens: [] },
  // TRAUKTINĖS
  { id: "sp21", name: "Raudonos Devynerios (40ml)", description: "", price: 4.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Lietuviška žolelių trauktinė"], allergens: [] },
  { id: "sp22", name: "Žalios Devynerios (40ml)", description: "", price: 4.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Lietuviška žolelių trauktinė"], allergens: [] },
  { id: "sp23", name: "Pelynas (40ml)", description: "", price: 4.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Pelynų trauktinė"], allergens: [] },
  // LIKERIAI
  { id: "sp24", name: "Jagermeister (40ml)", description: "", price: 5.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Žolelių likeris"], allergens: [] },
  { id: "sp25", name: "Baileys Irish Cream (40ml)", description: "", price: 5.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Airiškas grietinėlės likeris"], allergens: ["Pienas"] },
  // ROMAS
  { id: "sp26", name: "Angostura Premium White Reserva (40ml)", description: "", price: 5.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Baltasis romas"], allergens: [] },
  { id: "sp27", name: "Angostura Gold 5 YO (40ml)", description: "", price: 5.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Aukso romas"], allergens: [] },
  { id: "sp28", name: "Kraken Black Spiced (40ml)", description: "", price: 6.00, image: IMG.spirits, category: "stiprieji", ingredients: ["Prieskoninis tamsus romas"], allergens: [] },
  // DŽINAS
  { id: "sp29", name: "Hendrix džinas (40ml)", description: "", price: 6.70, image: IMG.spirits, category: "stiprieji", ingredients: ["Škotiškas džinas"], allergens: [] },
  { id: "sp30", name: "Tanqueray London Dry džinas (40ml)", description: "", price: 5.70, image: IMG.spirits, category: "stiprieji", ingredients: ["Londoniškas džinas"], allergens: [] },
  // MIDUS
  { id: "sp31", name: "Suktinis lietuviškas midus (40ml)", description: "", price: 4.60, image: IMG.spirits, category: "stiprieji", ingredients: ["Lietuviškas midus"], allergens: [] },

  // ŠAMPANAS IR PUTOJANTIS VYNAS
  { id: "sam1", name: "Moutard Grande Cuvée Brut", description: "Prancūziškas šampanas (butelis).", price: 55.00, image: IMG.champagne, category: "sampanas", ingredients: ["Šampanas"], allergens: [] },
  { id: "sam2", name: "Moët-Chandon Brut Imperial", description: "Ikoniškas Moët & Chandon šampanas (butelis).", price: 70.00, image: IMG.champagne, category: "sampanas", ingredients: ["Šampanas"], allergens: [], badge: "Premium" },
  { id: "sam3", name: "Alita putojantis vynas (taurė)", description: "Lietuviškas putojantis vynas.", price: 6.50, image: IMG.champagne, category: "sampanas", ingredients: ["Putojantis vynas"], allergens: [] },
  { id: "sam3-b", name: "Alita putojantis vynas (butelis)", description: "Lietuviškas putojantis vynas.", price: 27.00, image: IMG.champagne, category: "sampanas", ingredients: ["Putojantis vynas"], allergens: [] },
  { id: "sam4", name: "Valdo Etichetta Nera Prosecco D.O.C (taurė)", description: "Itališkos Prosecco D.O.C.", price: 7.00, image: IMG.champagne, category: "sampanas", ingredients: ["Prosecco"], allergens: [] },
  { id: "sam4-b", name: "Valdo Etichetta Nera Prosecco D.O.C (butelis)", description: "Itališkos Prosecco D.O.C.", price: 32.00, image: IMG.champagne, category: "sampanas", ingredients: ["Prosecco"], allergens: [] },
  { id: "sam5", name: "Salasar Cremant de Limoux Brut", description: "Prancūziškas Cremant de Limoux (butelis).", price: 36.00, image: IMG.champagne, category: "sampanas", ingredients: ["Cremant"], allergens: [] },
  { id: "sam6", name: "Anna Codorniu Blanc de Blac Brut Cava D.O.", description: "Ispaniškas Cava D.O. (butelis).", price: 39.00, image: IMG.champagne, category: "sampanas", ingredients: ["Cava"], allergens: [] },
  { id: "sam7", name: "Nealkoholinis vynas (150ml)", description: "Pilstomas nealkoholinis vynas.", price: 6.30, image: IMG.wine, category: "sampanas", ingredients: ["Nealkoholinis vynas"], allergens: [] },
  { id: "sam8", name: "Karštas nealkoholinis vynas", description: "Šiltas nealkoholinis vynas.", price: 6.90, image: IMG.wine, category: "sampanas", ingredients: ["Nealkoholinis vynas", "Prieskoniai"], allergens: [] },

  // VYNAS
  { id: "vy1", name: "Vynas svečias (150ml)", description: "Dienos pilstomas vynas.", price: 6.90, image: IMG.wine, category: "vynas", ingredients: ["Vynas"], allergens: [] },
  { id: "vy2", name: "Gluhwein", description: "Šiltas prieskoninis vynas.", price: 6.90, image: IMG.wine, category: "vynas", ingredients: ["Raudonas vynas", "Prieskoniai", "Apelsinas"], allergens: [] },
  { id: "vy3", name: "St. Urbans Hof Rieslig OBA (150ml)", description: "Vokietiškas Riesling.", price: 6.90, image: IMG.wine, category: "vynas", ingredients: ["Riesling vynuogės"], allergens: [] },
  { id: "vy4", name: "Kindzmarauli (150ml)", description: "Gruziniškas pusiau saldus raudonas vynas.", price: 6.90, image: IMG.wine, category: "vynas", ingredients: ["Saperavi vynuogės"], allergens: [] },
  { id: "vy5", name: "Carmelle Sauvignon Blanc Comte Tolosan I.G.P (150ml)", description: "Prancūziškas Sauvignon Blanc.", price: 6.90, image: IMG.wine, category: "vynas", ingredients: ["Sauvignon Blanc vynuogės"], allergens: [] },
  { id: "vy6", name: "Carmelle Malbec Comte Tolosan I.G.P (150ml)", description: "Prancūziškas Malbec.", price: 6.90, image: IMG.wine, category: "vynas", ingredients: ["Malbec vynuogės"], allergens: [] },
  // Butelinis vynas – Prancūzija
  { id: "vy7", name: "Chateau de Fesles Rosé D'Anjou", description: "Prancūziškas rožinis vynas iš Anjou.", price: 32.00, image: IMG.wine, category: "vynas", ingredients: ["Cabernet Franc"], allergens: [] },
  { id: "vy8", name: "Klipfel, Pinot Gris", description: "Elzaso Pinot Gris.", price: 38.00, image: IMG.wine, category: "vynas", ingredients: ["Pinot Gris vynuogės"], allergens: [] },
  { id: "vy9", name: "E. Guigal Cotes Du Rhone A.C.", description: "Klasikinis Rhône Valley raudonas vynas.", price: 44.00, image: IMG.wine, category: "vynas", ingredients: ["Grenache", "Syrah", "Mourvèdre"], allergens: [] },
  { id: "vy10", name: "Laroche Chablis", description: "Klasikinis Chablis Chardonnay.", price: 55.00, image: IMG.wine, category: "vynas", ingredients: ["Chardonnay"], allergens: [] },
  // Italija
  { id: "vy11", name: "Il Pumo, Primitivo, Puglia I.G.P", description: "Italijos Puglia regiono Primitivo.", price: 27.00, image: IMG.wine, category: "vynas", ingredients: ["Primitivo vynuogės"], allergens: [] },
  { id: "vy12", name: "Remole Rosso Toscana IGT", description: "Toskanos Sangiovese raudonasis vynas.", price: 31.00, image: IMG.wine, category: "vynas", ingredients: ["Sangiovese", "Cabernet Sauvignon"], allergens: [] },
  { id: "vy13", name: "Pomino Bianco DOC", description: "Elegantiškas toskanos baltasis vynas.", price: 40.00, image: IMG.wine, category: "vynas", ingredients: ["Pinot Bianco", "Chardonnay"], allergens: [] },
  { id: "vy14", name: "Pomino Pinot Nero DOC", description: "Subtilus Toskanos Pinot Nero.", price: 52.00, image: IMG.wine, category: "vynas", ingredients: ["Pinot Nero"], allergens: [] },
  { id: "vy15", name: "Attems Pinot Grigio", description: "Friuli Pinot Grigio.", price: 40.00, image: IMG.wine, category: "vynas", ingredients: ["Pinot Grigio"], allergens: [] },
  { id: "vy16", name: "Attems Ribolla Gialla", description: "Itališka Ribolla Gialla.", price: 40.00, image: IMG.wine, category: "vynas", ingredients: ["Ribolla Gialla"], allergens: [] },
  { id: "vy17", name: "Attems Sauvignon Blanc", description: "Italijos Sauvignon Blanc.", price: 40.00, image: IMG.wine, category: "vynas", ingredients: ["Sauvignon Blanc"], allergens: [] },
  { id: "vy18", name: "Nipozzano Chianti Rufina Riserva DOCG", description: "Klasikinis Chianti Riserva.", price: 52.00, image: IMG.wine, category: "vynas", ingredients: ["Sangiovese"], allergens: [] },
  { id: "vy19", name: "Castel Ciocondo Campo Ai Sassi Rosso di Montalcino DOC", description: "Brunello di Montalcino regiono raudonasis vynas.", price: 55.00, image: IMG.wine, category: "vynas", ingredients: ["Sangiovese Grosso"], allergens: [] },
  // Ispanija
  { id: "vy20", name: "El Coto 875, Chardonnay, Fermentado en Barrica Rioja D.O.C.", description: "Rioja Chardonnay fermentuotas ąžuolo statinėje.", price: 43.00, image: IMG.wine, category: "vynas", ingredients: ["Chardonnay"], allergens: [] },
  // Čilė
  { id: "vy21", name: "Ventisquero Reserva Chardonnay", description: "Čilės Chardonnay Reserva.", price: 28.00, image: IMG.wine, category: "vynas", ingredients: ["Chardonnay"], allergens: [] },
  { id: "vy22", name: "Ventisquero Reserva Pinot Noir", description: "Čilės Pinot Noir Reserva.", price: 28.00, image: IMG.wine, category: "vynas", ingredients: ["Pinot Noir"], allergens: [] },
  // Argentina
  { id: "vy23", name: "Bodega Catena Zapata Malbec", description: "Ikoniškas Argentinos Malbec iš Mendozos.", price: 43.00, image: IMG.wine, category: "vynas", ingredients: ["Malbec"], allergens: [], badge: "Premium" },
];

// Overlay locally generated images from the AI pipeline over the fallback URLs.
// Once generate-menu-images.mjs runs, every product uses its own verified local image.
export const products: Product[] = _rawProducts.map((p) =>
  imageManifest[p.id] ? { ...p, image: imageManifest[p.id] } : p
);

export const featuredProducts = products.filter((p) => p.featured);
