import type { FilterChip } from './chips';
import { FilterLink } from './FilterBar';

export type ResultsHeaderProps = {
  /** Focus target after the filters change (`tabIndex=-1`); also names the results section. */
  id: string;
  /** The formatted count, e.g. "12 resources". */
  count: string;
  chips?: FilterChip[];
  /** Accessible name of the chip list, e.g. "Active filters". */
  chipsLabel: string;
  /** Accessible name of one chip link, e.g. `label => t('removeFilter', { label })`. */
  removeLabel: (label: string) => string;
  /**
   * Announce count changes politely (default). DirectoryPage turns this off when a FilterBar moves
   * focus to the count after a change: the focused count is read out once, never twice.
   */
  live?: boolean;
};

/** The directory results line: the count (a focus target) plus one removable chip per applied filter. */
export function ResultsHeader({ id, count, chips, chipsLabel, removeLabel, live = true }: ResultsHeaderProps) {
  return <div className="vf-l-results">
    <p id={id} tabIndex={-1} className="vf-label vf-l-results-count" aria-live={live ? 'polite' : undefined}>{count}</p>
    {chips?.length ? <ul className="vf-l-chips" aria-label={chipsLabel}>
      {chips.map(chip => <li key={chip.key}>
        <FilterLink href={chip.href} className="vf-l-chip" aria-label={removeLabel(chip.label)}>
          <span className="vf-tag" data-plain="">{chip.label}<span className="vf-l-chip-x" aria-hidden="true">×</span></span>
        </FilterLink>
      </li>)}
    </ul> : null}
  </div>;
}
