export type StubResult = { data: unknown; error: unknown | null };

export const successful = (data: unknown): StubResult => ({ data, error: null });

export class QueryStub implements PromiseLike<StubResult> {
  readonly operations: Array<[string, ...unknown[]]> = [];

  constructor(private readonly result: StubResult) {}

  select(columns: string) {
    this.operations.push(['select', columns]);
    return this;
  }

  eq(column: string, value: unknown) {
    this.operations.push(['eq', column, value]);
    return this;
  }

  gte(column: string, value: unknown) {
    this.operations.push(['gte', column, value]);
    return this;
  }

  lt(column: string, value: unknown) {
    this.operations.push(['lt', column, value]);
    return this;
  }

  gt(column: string, value: unknown) {
    this.operations.push(['gt', column, value]);
    return this;
  }

  neq(column: string, value: unknown) {
    this.operations.push(['neq', column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.operations.push(['in', column, values]);
    return this;
  }

  contains(column: string, value: unknown) {
    this.operations.push(['contains', column, value]);
    return this;
  }

  or(expression: string) {
    this.operations.push(['or', expression]);
    return this;
  }

  order(column: string, options?: unknown) {
    this.operations.push(['order', column, options]);
    return this;
  }

  limit(value: number) {
    this.operations.push(['limit', value]);
    return this;
  }

  range(from: number, to: number) {
    this.operations.push(['range', from, to]);
    return this;
  }

  insert(value: unknown) {
    this.operations.push(['insert', value]);
    return this;
  }

  upsert(value: unknown, options?: unknown) {
    this.operations.push(['upsert', value, options]);
    return this;
  }

  update(value: unknown) {
    this.operations.push(['update', value]);
    return this;
  }

  delete() {
    this.operations.push(['delete']);
    return this;
  }

  maybeSingle() {
    this.operations.push(['maybeSingle']);
    return Promise.resolve(this.result);
  }

  single() {
    this.operations.push(['single']);
    return Promise.resolve(this.result);
  }

  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

export class SupabaseStub {
  readonly queries: Array<{ table: string; query: QueryStub }> = [];
  readonly rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];

  constructor(
    private readonly results: Record<string, StubResult[]> = {},
    private readonly rpcResults: Record<string, StubResult[]> = {},
  ) {}

  from(table: string) {
    const query = new QueryStub(this.results[table]?.shift() ?? successful(null));
    this.queries.push({ table, query });
    return query;
  }

  queriesFor(table: string) {
    return this.queries.filter((entry) => entry.table === table).map((entry) => entry.query);
  }

  rpc(name: string, args?: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return Promise.resolve(this.rpcResults[name]?.shift() ?? successful(null));
  }
}
