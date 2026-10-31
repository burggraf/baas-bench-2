import PocketBase, { BaseAuthStore, isTokenExpired } from 'pocketbase';

// The shared workload contract maps onto native collections; all traffic uses the official SDK.
export function pocketbaseClient(origin, fetch) {
  if (!['http://127.0.0.1:4000', 'http://pocketbase:4000'].includes(origin)) throw new Error('Unexpected PocketBase origin');
  const pb = new PocketBase(origin, new BaseAuthStore());
  pb.autoCancellation(false);
  pb.beforeSend = (url, options) => {
    const target = new URL(url);
    if (target.origin !== origin || !target.pathname.startsWith('/api/')) throw new Error('Unexpected SDK origin/path');
    return { url, options: { ...options, fetch } };
  };
  const row = record => record && ({ ...record, ...(record.created ? { created_at: Math.floor(Date.parse(record.created)/1000), updated_at: Math.floor(Date.parse(record.updated)/1000) } : {}) });
  const refresh = () => pb.collection('users').authRefresh();
  const renew = async () => { if (pb.authStore.token && isTokenExpired(pb.authStore.token, 30)) await refresh(); };
  return {
    user: () => pb.authStore.record,
    tokens: () => ({ auth_token: pb.authStore.token }),
    register: ({ username, password }) => pb.collection('users').create({ username, password, passwordConfirm: password }),
    login: (username, password) => pb.collection('users').authWithPassword(username, password),
    refresh,
    async logout() { pb.authStore.clear(); return true; },
    async deleteUser() { const id = pb.authStore.record?.id; if (!id) throw new Error('Missing auth'); await pb.collection('users').delete(id); pb.authStore.clear(); },
    records(name) {
      if (!['posts', 'likes'].includes(name)) throw new Error('Unexpected collection');
      const collection = pb.collection(name);
      return {
        async list({ pagination: { limit = 20, offset = 0 } = {}, order = [], filters = [], count = false } = {}) {
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset % limit) throw new Error('Unsupported pagination offset');
          const clauses = filters.map(({column, value}) => {
            if (!(name === 'posts' ? ['author'] : ['post', 'user']).includes(column) || typeof value !== 'string') throw new Error('Unsupported filter');
            return pb.filter(`${column} = {:value}`, { value });
          });
          if (order.some(field => !['-created_at', '-id'].includes(field))) throw new Error('Unsupported order');
          await renew();
          const result = await collection.getList(offset/limit+1, limit, {
            sort: order.map(field => field === '-created_at' ? '-created' : field).join(','), filter: clauses.join(' && '), skipTotal: !count,
            fields: name === 'posts' ? 'id,author,title,body,created,updated' : 'id,user,post',
          });
          return { records: result.items.map(row), ...(count ? { total_count: result.totalItems } : {}) };
        },
        async read(id) { await renew(); return row(await collection.getOne(id)); },
        async create(fields) { await renew(); return (await collection.create(fields)).id; },
        async createBulk(records) {
          await renew();
          const batch = pb.createBatch();
          for (const record of records) batch.collection(name).create(record);
          const result = await batch.send();
          if (!Array.isArray(result) || result.length !== records.length || result.some(item => ![200, 201].includes(item.status) || typeof item.body?.id !== 'string')) throw new Error('Invalid SDK batch response');
          return result.map(item => item.body.id);
        },
        async update(id, fields) { await renew(); await collection.update(id, fields); },
        async delete(id) { await renew(); await collection.delete(id); },
      };
    },
  };
}
