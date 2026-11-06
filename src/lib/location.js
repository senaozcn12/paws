import { allCountries } from 'country-region-data';

export function regionsFor(selected) {
  if (!selected) return [];
  const names = selected[2].map(item => item[0]);
  // Dataset represents some territories without subdivisions by repeating the country.
  return names.length === 1 && names[0] === selected[0] ? [] : names;
}
export function validLocation(country, region) {
  const selected = allCountries.find(item => item[0] === country);
  return Boolean(selected && (!regionsFor(selected).length || regionsFor(selected).includes(region)));
}
