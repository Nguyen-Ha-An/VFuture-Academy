import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

const isAsync = (type: unknown): type is (props: unknown) => Promise<ReactNode> =>
  typeof type === 'function' && type.constructor?.name === 'AsyncFunction';

/**
 * Stand-in for the RSC renderer: awaits nested async server components (bench slots such as
 * the trace rail and readout) so the browser harness can mount the resolved tree. Errors are
 * rethrown so error boundaries/fault states still get exercised by the caller.
 */
export async function resolveAsync(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (isAsync(element.type)) return resolveAsync(await element.type(element.props));
  const { children, ...rest } = element.props;
  const entries = await Promise.all(Object.entries(rest).map(async ([key, value]) =>
    [key, isValidElement(value) || Array.isArray(value) ? await resolveAsync(value as ReactNode) : value] as const));
  // Spread static children back as arguments so React does not treat them as a keyed list.
  if (Array.isArray(children)) return cloneElement(element, Object.fromEntries(entries), ...(await Promise.all(children.map(resolveAsync))));
  return cloneElement(element, Object.fromEntries(entries), ...(children === undefined ? [] : [await resolveAsync(children as ReactNode)]));
}
