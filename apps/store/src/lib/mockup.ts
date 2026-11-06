import { colourStyle } from './styles';

// Product mockups are generated, never copied: a plain tee outline in the chosen colour
// with the design's name set as text. `small-logo` is for the Basics range.

export interface MockupOptions {
  text: string;
  colour: string;
  style: 'statement' | 'small-logo';
}

const TEE_PATH =
  'M140 40 C160 62 240 62 260 40 L340 72 L388 156 L330 186 L310 150 L310 410 ' +
  'L90 410 L90 150 L70 186 L12 156 L60 72 Z';

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Greedy word wrap to at most `maxLines` lines of about `width` characters. */
export function wrapText(text: string, width = 14, maxLines = 4): string[] {
  const lines: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= width) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')];
}

export function teeSvg({ text, colour, style }: MockupOptions): string {
  const { hex, ink } = colourStyle(colour);
  const outline = colour === 'white' ? '#d6d3d1' : 'none';
  let print: string;

  if (style === 'small-logo') {
    print =
      `<text x="250" y="140" text-anchor="middle" font-size="14" font-weight="700" ` +
      `letter-spacing="2" fill="${ink}">SWITCH GEAR</text>`;
  } else {
    const lines = wrapText(text.toUpperCase());
    const longest = Math.max(...lines.map((l) => l.length));
    const fontSize = Math.max(16, Math.min(34, Math.floor(300 / Math.max(longest, 1))));
    const lineHeight = Math.round(fontSize * 1.2);
    const top = 230 - ((lines.length - 1) * lineHeight) / 2;
    print = lines
      .map(
        (line, i) =>
          `<text x="200" y="${Math.round(top + i * lineHeight)}" text-anchor="middle" ` +
          `font-size="${fontSize}" font-weight="800" fill="${ink}">${escapeXml(line)}</text>`,
      )
      .join('');
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 440" role="img" ` +
    `aria-label="${escapeXml(`${text} tee in ${colourStyle(colour).label}`)}">` +
    `<rect width="400" height="440" fill="#f4f4f5"/>` +
    `<path d="${TEE_PATH}" fill="${hex}" stroke="${outline}" stroke-width="2"/>` +
    `<path d="M160 52 C175 74 225 74 240 52" fill="none" stroke="${ink}" stroke-opacity="0.25" stroke-width="3"/>` +
    `<g font-family="ui-sans-serif, system-ui, sans-serif">${print}</g>` +
    `</svg>`
  );
}
