import { postFields } from './workload.js';

const valid = (ok) => { if (!ok) throw new Error('invalid_response'); };
const pick = (rows, rng) => rows[Math.floor(rng() * rows.length)];
const unavailable = () => { throw new Error('unavailable_target'); };
const remember = (rows, item) => [...rows.filter(row => row.id !== item.id), item].slice(-100);

export function initialState(user, visible, config) {
  return { user: user.id, index: user.index, owned: user.posts.slice(-100), likes: user.likes.slice(-100), visible: visible.slice(-config.pageSize), sequence: config.dataset.postsPerUser, offset: config.pageSize };
}

export async function performAction(client, state, action, config, rng, prerequisite) {
  const posts = client.records('posts'), likes = client.records('likes');
  const page = async (own, offset = 0) => {
    const result = await posts.list({ pagination: { limit: config.pageSize, offset }, order: ['-created_at', '-id'], ...(own ? { filters: [{ column: 'author', value: state.user }] } : {}) });
    valid(Array.isArray(result.records) && result.records.length <= config.pageSize);
    for (const post of result.records) valid(typeof post.id === 'string' && typeof post.body === 'string' && post.body.length === config.bodyBytes && (!own || post.author === state.user));
    return result;
  };
  if (action === 'listPublic' || action === 'listOwn') {
    const own = action === 'listOwn';
    const result = await page(own);
    valid(result.records.length > 0 && !('total_count' in result));
    if (own) state.owned = result.records.map(p => p.id);
    else state.visible = result.records.map(p => p.id);
  } else if (action === 'read') {
    if (!state.visible.length) { prerequisite(); state.visible = (await page(false)).records.map(p => p.id); }
    if (!state.visible.length) unavailable();
    const id = pick(state.visible, rng), post = await posts.read(id);
    valid(post?.id === id && typeof post.author === 'string' && typeof post.title === 'string' && post.body?.length === config.bodyBytes);
  } else if (action === 'create' || action === 'edit') {
    if (action === 'edit' && !state.owned.length) { prerequisite(); state.owned = (await page(true)).records.map(p => p.id); }
    if (action === 'edit' && !state.owned.length) unavailable();
    const fields = postFields(config, state.index, state.sequence + 1);
    if (action === 'create') {
      const id = await posts.create({ author: state.user, ...fields });
      valid(typeof id === 'string' && id.length > 0);
      state.owned = [...state.owned, id].slice(-100);
      state.visible = [...state.visible, id].slice(-config.pageSize);
    } else await posts.update(pick(state.owned, rng), fields);
    state.sequence++;
  } else if (action === 'unlike') {
    if (!state.likes.length) {
      prerequisite();
      const result = await likes.list({ pagination: { limit: config.pageSize } });
      valid(result.records.every(l => l.user === state.user && typeof l.id === 'string' && typeof l.post === 'string'));
      state.likes = result.records.map(l => ({ id: l.id, post: l.post }));
    }
    if (!state.likes.length) unavailable();
    const like = pick(state.likes, rng);
    await likes.delete(like.id);
    state.likes = state.likes.filter(l => l.id !== like.id);
  } else if (action === 'like') {
    // Bounded search: current visible pool plus at most four API feed pages (including an empty wrap).
    // TrailBase custom-order feeds support offsets, not cursors; keep progress independent of listPublic.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidates = state.visible.filter(id => !state.likes.some(l => l.post === id));
      for (let probe = 0; probe < 5 && candidates.length; probe++) {
        const index = Math.floor(rng() * candidates.length), post = candidates.splice(index, 1)[0];
        prerequisite();
        const existing = await likes.list({ pagination: { limit: 1 }, filters: [{ column: 'post', value: post }] });
        valid(existing.records.every(l => l.post === post && l.user === state.user));
        if (existing.records.length) {
          state.likes = remember(state.likes, { id: existing.records[0].id, post });
          continue;
        }
        const id = await likes.create({ user: state.user, post });
        valid(typeof id === 'string' && id.length > 0);
        state.likes = remember(state.likes, { id, post });
        return;
      }
      if (attempt < 4) {
        prerequisite();
        const result = await page(false, state.offset);
        state.visible = result.records.map(p => p.id);
        // Prepared feed walks must also support the native page-based SDK; legacy offsets stay unchanged.
        state.offset = result.records.length ? state.offset + (config.version === 'social-prepared-v1' ? config.pageSize : result.records.length) : 0;
      }
    }
    unavailable();
  } else throw new Error('Unknown action');
}
