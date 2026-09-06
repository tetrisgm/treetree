/** Place names arrive in every spelling a family uses. Persian towns in
 * particular have been transliterated a dozen ways - Qazvin, Ghazvin, Kazvin;
 * Tehran, Teheran, Theran - and each record keeps whatever its author typed.
 * Nothing rewrites a record; instead every view that groups, counts, or
 * displays a city goes through canonicalCity, so the archive reads as one
 * town, not five. The record itself stays the historical source.
 *
 * EXTENSION POINT: aliases are lowercase, diacritic-free spellings mapped to
 * the canonical display form. A deployment whose family spells differently
 * adds rows here. */

const CITY_ALIASES: Record<string, string> = {
  // Iran
  qazvin: "Qazvin", ghazvin: "Qazvin", kazvin: "Qazvin", qazwin: "Qazvin", casbin: "Qazvin", "قزوین": "Qazvin",
  tehran: "Tehran", teheran: "Tehran", theran: "Tehran", tehraan: "Tehran", "تهران": "Tehran",
  esfahan: "Isfahan", isfahan: "Isfahan", ispahan: "Isfahan", "اصفهان": "Isfahan",
  shiraz: "Shiraz", chiraz: "Shiraz", "شیراز": "Shiraz",
  tabriz: "Tabriz", tabris: "Tabriz", "تبریز": "Tabriz",
  mashhad: "Mashhad", mashad: "Mashhad", meshed: "Mashhad", "مشهد": "Mashhad",
  qom: "Qom", ghom: "Qom", kum: "Qom", "قم": "Qom",
  rasht: "Rasht", recht: "Rasht", "رشت": "Rasht",
  darab: "Darab", "داراب": "Darab",
  saveh: "Saveh", save: "Saveh", "ساوه": "Saveh",
  kermanshah: "Kermanshah", kirmanshah: "Kermanshah",
  ahvaz: "Ahvaz", ahwaz: "Ahvaz",
  hamadan: "Hamadan", hamedan: "Hamadan",
  yazd: "Yazd", kashan: "Kashan", kerman: "Kerman", zanjan: "Zanjan", karaj: "Karaj",
  // neighbours and the diaspora
  karbala: "Karbala", kerbala: "Karbala", "كربلاء": "Karbala",
  najaf: "Najaf", nadjaf: "Najaf",
  baghdad: "Baghdad", bagdad: "Baghdad",
  istanbul: "Istanbul", constantinople: "Istanbul", istambul: "Istanbul",
  beirut: "Beirut", beyrouth: "Beirut",
  dubai: "Dubai", dubay: "Dubai",
  paris: "Paris", london: "London", londres: "London", geneva: "Geneva", geneve: "Geneva", genf: "Geneva",
  montreal: "Montreal", toronto: "Toronto", vancouver: "Vancouver",
  "new york": "New York", "new york city": "New York", nyc: "New York",
  "san francisco": "San Francisco", sf: "San Francisco",
  "los angeles": "Los Angeles", la: "Los Angeles",
  washington: "Washington", "washington dc": "Washington", "washington d.c.": "Washington",
  rome: "Rome", roma: "Rome", berlin: "Berlin", vienna: "Vienna", wien: "Vienna", munich: "Munich", munchen: "Munich",
};

const COUNTRY_ALIASES: Record<string, string> = {
  iran: "Iran", persia: "Iran", "islamic republic of iran": "Iran", "ایران": "Iran",
  france: "France", "united states": "United States", usa: "United States", "u.s.a.": "United States", us: "United States", "united states of america": "United States", "etats-unis": "United States",
  "united kingdom": "United Kingdom", uk: "United Kingdom", england: "United Kingdom", "great britain": "United Kingdom",
  canada: "Canada", germany: "Germany", deutschland: "Germany", italy: "Italy", italia: "Italy",
  switzerland: "Switzerland", suisse: "Switzerland", turkey: "Turkey", turkiye: "Turkey", lebanon: "Lebanon", liban: "Lebanon",
  iraq: "Iraq", uae: "United Arab Emirates", "united arab emirates": "United Arab Emirates",
};

/** lowercase, diacritics stripped, punctuation and doubled spaces collapsed */
export const placeKey = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[.‌]/g, "").replace(/\s+/g, " ").trim();

/** The display spelling every view agrees on. Unknown names come back
 * trimmed but otherwise as typed - the table is a courtesy, not a gate. */
export function canonicalCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const trimmed = city.trim();
  if (!trimmed) return null;
  return CITY_ALIASES[placeKey(trimmed)] ?? trimmed;
}

export function canonicalCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const trimmed = country.trim();
  if (!trimmed) return null;
  return COUNTRY_ALIASES[placeKey(trimmed)] ?? trimmed;
}

/** "Qazvin, Iran" - or the free-text fallback when nothing structured is
 * recorded. A fallback like "Ghazvin" or "Qazvin, Iran" is canonicalised
 * piecewise too, since older records kept the whole place in one field. */
export function placeLabel(city: string | null | undefined, country: string | null | undefined, fallback?: string | null): string {
  const structured = [canonicalCity(city), canonicalCountry(country)].filter(Boolean).join(", ");
  if (structured) return structured;
  if (!fallback) return "";
  const parts = fallback.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  return [canonicalCity(parts[0]), ...parts.slice(1, -1), ...(parts.length > 1 ? [canonicalCountry(parts[parts.length - 1])] : [])].filter(Boolean).join(", ");
}

/** Do two spellings name the same city? */
export const sameCity = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && placeKey(canonicalCity(a)!) === placeKey(canonicalCity(b)!);
