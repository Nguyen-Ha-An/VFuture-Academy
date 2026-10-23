"use client";

import { useId, useState } from "react";
import { PublicLink } from "@/features/public-site/PublicNavigation";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PATHWAYS } from "@/content-engine";
import "./academy-explorer.css";

const fieldKeys = {
  "ai-emerging-technology": "aiEmergingTechnology",
  "research-innovation": "researchInnovation",
  "entrepreneurship-product": "entrepreneurshipProduct",
  "fintech-economics": "fintechEconomics",
  "core-future-skills": "coreFutureSkills",
} as const;

type Field = (typeof PATHWAYS)[number];

/** Decorative studies of each field, rather than course or performance data. */
function FieldGraphic({ field }: { field: Field }) {
  return (
    <svg className="academy-explorer__graphic" viewBox="0 0 280 250" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1">
        <path d="M16 36V16H36M244 16H264V36M16 214V234H36M244 234H264V214" opacity=".4" />
        {field === "ai-emerging-technology" && <>
          {[63, 125, 187].map((y) => [50, 100, 150, 200].map((target) => <path key={`${y}-${target}`} d={`M50 ${y}L140 ${target}L230 ${y}`} opacity=".28" />))}
          {[63, 125, 187].map((y) => <g key={y}><circle cx="50" cy={y} r="10" fill="#10282a" /><circle cx="230" cy={y} r="10" fill="#10282a" /></g>)}
          {[50, 100, 150, 200].map((y) => <g key={y}><circle cx="140" cy={y} r="14" fill="#10282a" /><circle cx="140" cy={y} r="4" fill="currentColor" stroke="none" /></g>)}
        </>}
        {field === "research-innovation" && <>
          {[32, 51, 70, 89].map((r) => <circle key={r} cx="140" cy="125" r={r} opacity={r === 70 ? ".9" : ".3"} />)}
          <path d="M30 125H250M140 22V228M67 52L213 198" opacity=".4" strokeDasharray="3 6" />
          <path d="M78 158L115 112L145 128L202 74" strokeWidth="2" />
          {[[78, 158], [115, 112], [145, 128], [202, 74]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="5" fill="#10282a" />)}
        </>}
        {field === "entrepreneurship-product" && <>
          {[0, 1, 2].map((i) => <g key={i} transform={`translate(${35 + i * 58} ${45 + i * 42})`}><rect width="82" height="76" fill="#10282a" /><path d="M0 19H82M13 34H60M13 45H43" opacity=".5" /><path d="M13 61H28" strokeWidth="3" /></g>)}
          <path d="M35 141V206H141M134 199L141 206L134 213" opacity=".6" />
        </>}
        {field === "fintech-economics" && <>
          {[52, 94, 136, 178, 220].map((x, i) => <g key={x}><path d={`M${x} 200V${154 - i * 23}H${x + 17}V200`} fill="#10282a" /><path d={`M${x - 6} ${138 - i * 23}H${x + 23}`} opacity=".4" /></g>)}
          <path d="M29 201H252M29 148H252M29 95H252M29 42H252" opacity=".15" />
          <path d="M41 159C88 154 73 119 119 127S179 74 239 43" strokeWidth="2" />
        </>}
        {field === "core-future-skills" && <>
          {[0, 120, 240].map((rotation) => <g key={rotation} transform={`rotate(${rotation} 140 125)`}><circle cx="140" cy="89" r="57" opacity=".8" /><circle cx="140" cy="33" r="6" fill="#10282a" /></g>)}
          <path d="M140 55V195M70 125H210" opacity=".3" strokeDasharray="3 6" />
          <circle cx="140" cy="125" r="10" fill="currentColor" stroke="none" />
        </>}
      </g>
    </svg>
  );
}

export function AcademyExplorer({ fields }: { fields: typeof PATHWAYS }) {
  const t = useTranslations("labs.academy.explorer");
  const tPathways = useTranslations("marketing.pathways");
  const [selected, setSelected] = useState<Field>(fields[0]);
  const id = useId();
  const detailId = `${id}-preview`;
  const labelId = `${id}-label`;
  const key = fieldKeys[selected];
  const fieldName = tPathways(`items.${key}.name`);

  return (
    <div className="academy-explorer" data-academy-explorer data-selected-field={selected}>
      <div className="academy-explorer__heading">
        <p id={labelId}>{t("label")}</p>
        <span>{t("hint")}</span>
      </div>
      <div className="academy-explorer__selectors" role="group" aria-labelledby={labelId}>
        {fields.map((field, index) => (
          <button type="button" key={field} aria-pressed={selected === field} aria-label={tPathways(`items.${fieldKeys[field]}.name`)} aria-controls={detailId} onClick={() => setSelected(field)}>
            <span className="academy-explorer__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="academy-explorer__field-label">{tPathways(`items.${fieldKeys[field]}.name`)}</span>
            <span className="academy-explorer__field-short" aria-hidden="true">{t(`short.${fieldKeys[field]}`)}</span>
          </button>
        ))}
      </div>
      <div className="academy-explorer__preview" id={detailId} aria-live="polite" aria-atomic="true">
        <div className="academy-explorer__content" key={selected}>
          <div className="academy-explorer__copy">
            <span className="academy-explorer__eyebrow">{t("preview")}</span>
            <h3>{fieldName}</h3>
            <p>{tPathways(`items.${key}.promise`)}</p>
          </div>
          <FieldGraphic field={selected} />
        </div>
        <PublicLink href={`/courses?pathway=${selected}`} className="academy-explorer__link" aria-label={`${t("cta")}: ${fieldName}`}>
          <span>{t("cta")}</span><ArrowUpRight size={18} aria-hidden="true" />
        </PublicLink>
      </div>
    </div>
  );
}
