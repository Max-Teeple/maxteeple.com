/** Display names only. These do not rename anything in Tuya and never send a plug command. */
const PLUG_ALIASES = [
  { from: 'Smart Plug 3', name: 'Patio Lights' },
  { from: 'Smart Plug 2', name: 'Living Room Rear' },
  { from: 'Smart Plug', name: 'Living Room Left' }
] as const;

export function plugAlias(name: string): { name: string; order: number } | null {
  const index = PLUG_ALIASES.findIndex((row) => row.from === name.trim());
  if (index < 0) return null;
  return { name: PLUG_ALIASES[index].name, order: index };
}

export function plugSortKey(name: string, fallback: number): number {
  const alias = plugAlias(name);
  return alias ? alias.order : fallback + PLUG_ALIASES.length;
}
