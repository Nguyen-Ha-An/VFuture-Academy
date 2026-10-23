/** Faithful geometric reconstruction of the supplied VFuture Academy symbol. */
export function VFutureLogo({ academy = false }: { academy?: boolean }) {
  return (
    <span className="vfuture-logo" aria-hidden="true">
      <svg className="vfuture-logo__symbol" viewBox="0 0 126 125" fill="currentColor" focusable="false">
        <path d="M2 0H39V10H19L29 30H47V39H33L45 63L39 75Z" />
        <path d="M0 57L10 52L33 102L86 0H126L64 124L53 103L59 91L64 101L109 10H93L33 125Z" />
      </svg>
      <span className="vfuture-logo__type"><span className="vfuture-logo__name">VFUTURE</span><span className="vfuture-logo__division">{academy ? 'ACADEMY' : 'LABS'}</span></span>
    </span>
  );
}
