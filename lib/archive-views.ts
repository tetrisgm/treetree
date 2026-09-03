import type { FamilyTree, Person } from "./types";

export type TimelineEvent = {
  id: string;
  year: number;
  date: string;
  kind: "birth" | "death" | "story";
  title: string;
  detail: string;
  personIds: string[];
};

export type MappedPlace = {
  key: string;
  label: string;
  x: number;
  y: number;
  people: Person[];
};

// Real latitude/longitude, projected with the same equirectangular mapping the
// generated country outlines use - so markers land where the coastlines say.
// Alias spellings (Ghazvin, Teheran) map without editing anyone's record.
//
// EXTENSION POINT: this dictionary is deliberately finite and weighted toward
// the reference family's geography. A deployment whose places go unmapped
// extends it here (lowercase city name -> [lat, lon]); unmapped places appear
// in the Map view's own unmapped list rather than failing. A geocoding
// service is the eventual replacement (docs/PLATFORM.md phase 8).
const toPercent = ([lat, lon]: [number, number]): [number, number] => [((lon + 180) / 360) * 100, ((90 - lat) / 180) * 100];
const cityLatLon: Record<string, [number, number]> = {
  paris: [48.86, 2.35], tehran: [35.69, 51.39], teheran: [35.69, 51.39],
  qazvin: [36.27, 50.0], ghazvin: [36.27, 50.0], qom: [34.64, 50.88],
  shiraz: [29.59, 52.58], tabriz: [38.08, 46.29], darab: [28.75, 54.54],
  saveh: [35.02, 50.36], karbala: [32.62, 44.03],
  london: [51.51, -0.13], geneva: [46.2, 6.14], montreal: [45.5, -73.57], toronto: [43.65, -79.38],
  "new york": [40.71, -74.01], "san francisco": [37.77, -122.42], "los angeles": [34.05, -118.24],
  washington: [38.91, -77.04], miami: [25.76, -80.19], vancouver: [49.28, -123.12], dubai: [25.2, 55.27],
  istanbul: [41.01, 28.98], beirut: [33.89, 35.5], rome: [41.9, 12.5], berlin: [52.52, 13.4],
};
const countryLatLon: Record<string, [number, number]> = {
  iran: [32.4, 53.7], france: [46.6, 2.5], "united states": [39.8, -98.6], usa: [39.8, -98.6],
  canada: [56.1, -106.3], "united kingdom": [54.0, -2.0], uk: [54.0, -2.0], germany: [51.2, 10.4],
  italy: [42.8, 12.8], switzerland: [46.8, 8.2], turkey: [39.0, 35.2], lebanon: [33.9, 35.9],
  australia: [-25.3, 133.8], india: [22.6, 79.0], japan: [36.2, 138.3], china: [35.0, 103.0],
};

const normalized = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim();
const yearOf = (date: string | null) => date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
const place = (city: string | null, country: string | null, fallback: string | null) => [city, country].filter(Boolean).join(", ") || fallback || "";

export function buildTimeline(tree: FamilyTree): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const person of tree.people) {
    const birthYear = yearOf(person.birthDate);
    const deathYear = yearOf(person.deathDate);
    if (birthYear && person.birthDate) events.push({ id: `birth-${person.id}`, year: birthYear, date: person.birthDate, kind: "birth", title: `${person.displayName} was born`, detail: place(person.birthCity, person.birthCountry, person.birthPlace), personIds: [person.id] });
    if (deathYear && person.deathDate) events.push({ id: `death-${person.id}`, year: deathYear, date: person.deathDate, kind: "death", title: `${person.displayName} died`, detail: place(person.deathCity, person.deathCountry, person.deathPlace), personIds: [person.id] });
  }
  for (const story of tree.stories) {
    const year = yearOf(story.date);
    if (year && story.date) events.push({ id: `story-${story.id}`, year, date: story.date, kind: "story", title: story.title, detail: story.place || story.body, personIds: story.personIds });
  }
  return events.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

export function mapFamilyPlaces(tree: FamilyTree): { mapped: MappedPlace[]; unmapped: string[] } {
  const groups = new Map<string, MappedPlace>();
  const unmapped = new Set<string>();
  for (const person of tree.people) {
    const locations = [
      { city: person.birthCity, country: person.birthCountry, fallback: person.birthPlace },
      { city: person.deathCity, country: person.deathCountry, fallback: person.deathPlace },
    ];
    for (const location of locations) {
      const label = place(location.city, location.country, location.fallback);
      if (!label) continue;
      const coordinates = location.city ? cityLatLon[normalized(location.city)] : undefined;
      const fallbackCoordinates = location.country ? countryLatLon[normalized(location.country)] : undefined;
      const latLon = coordinates || fallbackCoordinates;
      const point = latLon ? toPercent(latLon) : undefined;
      if (!point) { unmapped.add(label); continue; }
      // One city, one marker: places are grouped by where they ARE, not by how
      // they were spelled, so "Ghazvin" and "Qazvin, Iran" - or "Tehran" with
      // and without its country - land on a single pin. The fullest label wins,
      // which is the one that names the country.
      const key = `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
      const group = groups.get(key) || { key, label, x: point[0], y: point[1], people: [] };
      if (label.length > group.label.length) group.label = label;
      if (!group.people.some((candidate) => candidate.id === person.id)) group.people.push(person);
      groups.set(key, group);
    }
  }
  return { mapped: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)), unmapped: [...unmapped].sort() };
}
