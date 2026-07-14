// Diacritics-insensitive matching shared by club search and player filter:
// "besiktas" must find "Beşiktaş", "silooy" must find "Sonny Silooy".
const EXTRA: Record<string, string> = {
  ø: 'o',
  đ: 'd',
  ł: 'l',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ı: 'i',
  þ: 'th',
  ð: 'd',
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks (ş, ç, é, İ→i̇, …)
    .toLowerCase()
    .replace(/[øđłßæœıþð]/g, (c) => EXTRA[c])
}
