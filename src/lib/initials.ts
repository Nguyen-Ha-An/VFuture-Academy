const HAS_LETTER = /[\p{L}\p{N}]/u;

function firstLetter(word: string): string {
  return Array.from(word).find((char) => HAS_LETTER.test(char)) ?? '';
}

export function initialsOf(parts: string[]): string {
  const words = parts.filter((word) => HAS_LETTER.test(word));
  const picked = words.length > 1 ? words.slice(-2) : words;
  return picked.map(firstLetter).join('').toLocaleUpperCase('vi');
}

export function emailLocalPart(email: string | null | undefined): string {
  return email?.split('@')[0]?.trim() ?? '';
}

/**
 * Up to two letters. Vietnamese names put the given name last ("Nguyễn Minh Anh" → "MA"), so a
 * multi-word name uses the first letter of its last two words; diacritics are kept. Without a
 * name, the email's local part is split on . _ + - instead.
 */
export function initials(name: string | null | undefined, email?: string | null): string {
  const displayName = name?.normalize('NFC').trim();
  if (displayName) return initialsOf(displayName.split(/\s+/u));
  return initialsOf(emailLocalPart(email).normalize('NFC').split(/[._+\-\s]+/u));
}
