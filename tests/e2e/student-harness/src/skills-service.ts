export const SKILL_LEVELS = ['exposed', 'applied', 'demonstrated'] as const;
/** Skills passport fixture for the bench readout. */
export async function passport(_userId: string) {
  return [
    { id: 'embedded-c', category: 'technology', name: { en: 'Embedded C', vi: 'C nhúng' }, level: 'demonstrated', evidence: [] },
    { id: 'signal-analysis', category: 'technology', name: { en: 'Signal analysis', vi: 'Phân tích tín hiệu' }, level: 'applied', evidence: [] },
    { id: 'python', category: 'technology', name: { en: 'Python', vi: 'Python' }, level: 'exposed', evidence: [] },
  ];
}
