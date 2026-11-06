import { useEffect, useRef, useState } from 'react';
import { allCountries } from 'country-region-data';
import { regionsFor } from '../lib/location';

function Suggestions({ id, label, value, options, onChange, disabled = false, required = false }) {
  const list = useRef(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = options.filter(option => option.toLowerCase().startsWith(value.toLowerCase()));
  function choose(option) { onChange(option); setOpen(false); setActive(-1); }
  return <div className="form-group location-field" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-${active}` : undefined} autoComplete="off" value={value} disabled={disabled} required={required}
      onFocus={() => setOpen(true)} onChange={e => { onChange(e.target.value); setActive(-1); setOpen(true); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { setOpen(false); setActive(-1); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(previous => matches.length ? (previous + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : -1); }
        if (e.key === 'Enter' && open && active >= 0 && matches[active]) { e.preventDefault(); choose(matches[active]); }
      }}/>
    {open && <ul ref={list} className="location-options" id={`${id}-list`} role="listbox" aria-label={label}>{matches.map((option, index) => <li key={option} id={`${id}-${index}`} role="option" aria-selected={active === index} onMouseDown={e => e.preventDefault()} onClick={() => choose(option)}>{option}</li>)}{!matches.length && <li role="presentation">No suggestions</li>}</ul>}
  </div>;
}
export default function LocationFields({ country, region, onChange }) {
  const selected = allCountries.find(item => item[0] === country);
  const regions = regionsFor(selected);
  return <>
    <Suggestions id="country" label="Country" value={country} options={allCountries.map(item => item[0])} required onChange={value => onChange(value, value === country ? region : '')}/>
    {regions.length ? <Suggestions key={country} id="region" label="State / province / region" value={region} options={regions} required onChange={value => onChange(country, value)}/> : <div className="form-group"><label htmlFor="region">State / province / region (optional)</label><input id="region" value={region} disabled={!selected} onChange={e => onChange(country, e.target.value)}/><p className="muted">{selected ? 'No subdivision suggestions available. Enter a region if applicable, or leave blank.' : 'Select a country first.'}</p></div>}
  </>;
}