export function toParLabel(n: number): string {
  if (Math.abs(n) < 0.05) return "E";
  const rounded = Math.round(n * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return rounded > 0 ? `+${text}` : text;
}

export function formatDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatWeekday(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "5.4 yd R" / "3.1 yd L" / "on aim". */
export function biasLabel(yards: number, digits = 1): string {
  const value = Math.round(yards * 10) / 10;
  if (Math.abs(value) < 0.05) return "on aim";
  const side = value > 0 ? "R" : "L";
  return `${Math.abs(value).toFixed(digits)} yd ${side}`;
}

export function signedYards(yards: number): string {
  const value = Math.round(yards);
  if (value > 0) return `+${value}`;
  return String(value);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sum = values.reduce((total, value) => total + (value - avg) ** 2, 0);
  return Math.sqrt(sum / (values.length - 1));
}

/** Mean after dropping the outer 10% on each side. */
export function trimmedMean(values: number[]): number {
  if (values.length < 8) return mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length * 0.1);
  return mean(sorted.slice(drop, sorted.length - drop));
}
