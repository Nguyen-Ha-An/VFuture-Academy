export const levelKeys = {
  foundation: "enums.level.foundation",
  specialization: "enums.level.specialization",
} as const;

export const difficultyKeys = {
  beginner: "enums.difficulty.beginner",
  intermediate: "enums.difficulty.intermediate",
  advanced: "enums.difficulty.advanced",
} as const;

export const pathwayKeys = {
  "ai-emerging-technology": "enums.pathway.aiEmergingTechnology",
  "research-innovation": "enums.pathway.researchInnovation",
  "entrepreneurship-product": "enums.pathway.entrepreneurshipProduct",
  "fintech-economics": "enums.pathway.fintechEconomics",
  "core-future-skills": "enums.pathway.coreFutureSkills",
} as const;

export function pathwayMessageKey(pathway: string) {
  return pathwayKeys[pathway as keyof typeof pathwayKeys] ?? pathwayKeys["core-future-skills"];
}

export function levelMessageKey(level: string) {
  return levelKeys[level as keyof typeof levelKeys] ?? levelKeys.foundation;
}

export function difficultyMessageKey(difficulty: string) {
  return difficultyKeys[difficulty as keyof typeof difficultyKeys] ?? difficultyKeys.beginner;
}
