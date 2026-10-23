export function supabaseService() { return new Proxy({}, { get() { throw new Error('Database access prohibited in student harness'); } }); }
