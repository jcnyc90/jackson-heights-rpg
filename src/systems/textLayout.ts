/**
 * Word-wraps text for a fixed-width font. Wrapping happens before the typewriter runs,
 * so a word never jumps to the next line halfway through being typed. Explicit "\n"
 * line breaks are kept; a word longer than a whole line is hard-split.
 */
export function wrapText(text: string, charsPerLine: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (let word of paragraph.split(' ').filter((w) => w !== '')) {
      while (word.length > charsPerLine) {
        if (line) lines.push(line);
        lines.push(word.slice(0, charsPerLine));
        word = word.slice(charsPerLine);
        line = '';
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= charsPerLine) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Splits dialogue into pages that fit the window. Each entry starts a new page, and
 * an entry too long for one page continues on the next, so localized text that runs
 * longer than English still fits.
 */
export function paginate(entries: string[], charsPerLine: number, linesPerPage: number): string[] {
  const pages: string[] = [];
  for (const entry of entries) {
    const lines = wrapText(entry, charsPerLine);
    for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage).join('\n'));
  }
  return pages;
}
