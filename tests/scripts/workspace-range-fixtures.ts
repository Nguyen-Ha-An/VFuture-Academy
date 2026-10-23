export const wrapperRangeSource = `{
  "manifest": {
    "schemaVersion": 1,
    "kind": "course",
    "id": "wrapper-course",
    "title": "Wrapper course",
    "summary": "Range fixture",
    "languages": ["en"],
    "defaultLanguage": "en",
    "level": "foundation",
    "difficulty": "beginner",
    "pathway": "core-future-skills",
    "learningOutcomes": ["Locate errors"],
    "access": { "scope": "global" },
    "modules": [
      {
        "id": "module-one",
        "title": "Module one",
        "items": [{ "type": "lesson", "id": "wrapper-item" }]
      }
    ]
  },
  "items": {
    "wrapper-item": {
      "schemaVersion": 1,
      "kind": "lesson",
      "id": "wrapper-item",
      "title": "Broken lesson",
      "blocks": []
    }
  }
}`;

export const inlineRangeSource = `{
  "schemaVersion": 1,
  "kind": "course",
  "id": "inline-course",
  "title": "Inline course",
  "summary": "Range fixture",
  "languages": ["en"],
  "defaultLanguage": "en",
  "level": "foundation",
  "difficulty": "beginner",
  "pathway": "core-future-skills",
  "learningOutcomes": ["Locate errors"],
  "access": { "scope": "global" },
  "skills": [{ "id": "range-checking", "name": "Range checking" }],
  "relatedOpportunities": ["next-step"],
  "modules": [
    {
      "id": "module-one",
      "title": "Module one",
      "items": [
        {
          "type": "lesson",
          "id": "inline-lesson",
          "title": "Inline lesson",
          "blocks": [
            { "id": "duplicate", "type": "paragraph", "content": [{ "text": "First" }] },
            {
              "id": "duplicate",
              "type": "paragraph",
              "content": [{ "text": "Second" }]
            }
          ]
        },
        {
          "type": "exam",
          "id": "inline-exam",
          "title": "Inline exam",
          "sections": [
            {
              "id": "duplicate-section",
              "title": "First section",
              "questions": [{ "id": "q-one", "type": "true_false", "content": { "blocks": [{ "type": "paragraph", "content": [{ "text": "True?" }] }] }, "correctAnswer": true }]
            },
            {
              "id": "duplicate-section",
              "title": "Second section",
              "questions": [{ "id": "q-two", "type": "true_false", "content": { "blocks": [{ "type": "paragraph", "content": [{ "text": "False?" }] }] }, "correctAnswer": false }]
            }
          ]
        },
        {
          "type": "assignment",
          "id": "inline-assignment",
          "title": "Inline assignment",
          "instructions": { "blocks": [{ "type": "paragraph", "content": [{ "text": "Submit work" }] }] },
          "submission": { "accepts": ["text"] },
          "rubric": {
            "criteria": [
              { "id": "duplicate-criterion", "name": "First", "maxPoints": 1 },
              {
                "id": "duplicate-criterion",
                "name": "Second",
                "maxPoints": 1
              }
            ]
          }
        }
      ]
    }
  ]
}`;

export const expectedWrapperRange = { start: { line: 29, col: 17 }, end: { line: 29, col: 19 } };

export const expectedInlineRanges = {
  'inline-lesson': { start: { line: 28, col: 21 }, end: { line: 28, col: 32 } },
  'inline-exam': { start: { line: 45, col: 21 }, end: { line: 45, col: 40 } },
  'inline-assignment': { start: { line: 61, col: 23 }, end: { line: 61, col: 44 } },
} as const;
