/** ~5,000-line old/new markdown pair with a drastic rewrite (every 3rd paragraph replaced, the rest edited). */
export function bigPair(): [string, string] {
  const para = (i: number, w: string) => `Paragraph ${i} ${w} lorem ipsum dolor sit amet ${i * 7}.`;
  const a = Array.from({ length: 2500 }, (_, i) => para(i, 'alpha')).join('\n\n');
  const b = Array.from({ length: 2500 }, (_, i) => (i % 3 ? para(i, 'beta') : `Totally new text ${i} here`)).join('\n\n');
  return [a, b];
}
