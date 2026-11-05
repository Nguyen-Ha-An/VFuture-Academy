/** Preserve an explicitly cleared field across JSON without adding absent fields. */
export function canonicalAnswer(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalAnswer);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, canonicalAnswer(entry)]));
  }
  return value;
}
export function canonicalAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, canonicalAnswer(value)]));
}

/** JSON object key order is not stable across PostgreSQL jsonb round trips. */
export function sameCanonicalAnswer(left:unknown,right:unknown):boolean {
  const a=canonicalAnswer(left),b=canonicalAnswer(right);
  const same=(x:unknown,y:unknown):boolean => {
    if(x===y)return true;
    if(Array.isArray(x) || Array.isArray(y)) return Array.isArray(x) && Array.isArray(y) && x.length===y.length && x.every((value,index)=>same(value,y[index]));
    if(typeof x!=='object' || x===null || typeof y!=='object' || y===null)return false;
    const leftObject=x as Record<string,unknown>,rightObject=y as Record<string,unknown>;
    const keys=Object.keys(leftObject);
    return keys.length===Object.keys(rightObject).length && keys.every(key=>Object.hasOwn(rightObject,key) && same(leftObject[key],rightObject[key]));
  };
  return same(a,b);
}
