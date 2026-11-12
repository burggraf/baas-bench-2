import { postFields } from './workload.js';

const valid = (ok) => { if (!ok) throw new Error('invalid_response'); };
const pick = (rows, rng) => rows[Math.floor(rng() * rows.length)];
const unavailable = () => { throw new Error('unavailable_target'); };

// These arrays belong to one user's state. Preserve their order and bounds
// without creating intermediate filter/spread/slice arrays on every action.
function removeId(rows, id) {
  let kept = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].id !== id) rows[kept++] = rows[i];
  rows.length = kept;
}
function appendBounded(rows, item, limit) {
  const discard = Math.max(0, rows.length + 1 - limit);
  if (discard) {
    for (let i = discard; i < rows.length; i++) rows[i - discard] = rows[i];
    rows.length -= discard;
  }
  rows.push(item);
}
function remember(rows, item) {
  removeId(rows, item.id);
  appendBounded(rows, item, 100);
}
function copyIds(rows, records) {
  rows.length = records.length;
  for (let i = 0; i < records.length; i++) rows[i] = records[i].id;
}

// A VU awaits each action. Buffers stay private to its state and release all
// item references after a search; membership is rebuilt after every feed page
// so discovered likes and bounded-cache evictions keep their original meaning.
const searchBuffers = new WeakMap();
function acquireSearch(state) {
  let buffers = searchBuffers.get(state);
  if (!buffers) {
    buffers = { liked: new Set(), candidates: [], busy: false };
    searchBuffers.set(state, buffers);
  }
  // Also preserve independent candidate snapshots if a caller overlaps searches.
  if (buffers.busy) return { liked: new Set(), candidates: [], busy: true };
  buffers.busy = true;
  return buffers;
}

export function initialState(user, visible, config) {
  return { user: user.id, index: user.index, owned: user.posts.slice(-100), likes: user.likes.slice(-100), visible: visible.slice(-config.pageSize), sequence: config.dataset.postsPerUser, offset: config.pageSize };
}

// SDK record handles keep a live client reference, so authentication still rotates normally.
const recordApis = new WeakMap();
async function page(posts, state, config, own, offset = 0) {
  const result = await posts.list({ pagination: { limit: config.pageSize, offset }, order: ['-created_at', '-id'], ...(own ? { filters: [{ column: 'author', value: state.user }] } : {}) });
  valid(Array.isArray(result.records) && result.records.length <= config.pageSize);
  for (const post of result.records) valid(typeof post.id === 'string' && typeof post.body === 'string' && post.body.length === config.bodyBytes && (!own || post.author === state.user));
  return result;
}

export async function performAction(client, state, action, config, rng, prerequisite, payloadFields) {
  let apis = recordApis.get(client);
  if (!apis) {
    apis = { posts: client.records('posts'), likes: client.records('likes') };
    recordApis.set(client, apis);
  }
  const { posts, likes } = apis;
  if (action === 'listPublic' || action === 'listOwn') {
    const own = action === 'listOwn';
    const result = await page(posts, state, config, own);
    valid(result.records.length > 0 && !('total_count' in result));
    copyIds(own ? state.owned : state.visible, result.records);
  } else if (action === 'read') {
    if (!state.visible.length) { prerequisite(); copyIds(state.visible, (await page(posts, state, config, false)).records); }
    if (!state.visible.length) unavailable();
    const id = pick(state.visible, rng), post = await posts.read(id);
    valid(post?.id === id && typeof post.author === 'string' && typeof post.title === 'string' && post.body?.length === config.bodyBytes);
  } else if (action === 'create' || action === 'edit') {
    if (action === 'edit' && !state.owned.length) { prerequisite(); copyIds(state.owned, (await page(posts, state, config, true)).records); }
    if (action === 'edit' && !state.owned.length) unavailable();
    const fields = payloadFields ? payloadFields(state.index, state.sequence + 1) : postFields(config, state.index, state.sequence + 1);
    if (action === 'create') {
      const id = await posts.create({ author: state.user, ...fields });
      valid(typeof id === 'string' && id.length > 0);
      appendBounded(state.owned, id, 100);
      appendBounded(state.visible, id, config.pageSize);
    } else await posts.update(pick(state.owned, rng), fields);
    state.sequence++;
  } else if (action === 'unlike') {
    if (!state.likes.length) {
      prerequisite();
      const result = await likes.list({ pagination: { limit: config.pageSize } });
      valid(result.records.every(l => l.user === state.user && typeof l.id === 'string' && typeof l.post === 'string'));
      state.likes.length = result.records.length;
      for (let i = 0; i < result.records.length; i++) {
        const like = result.records[i];
        state.likes[i] = { id: like.id, post: like.post };
      }
    }
    if (!state.likes.length) unavailable();
    const like = pick(state.likes, rng);
    await likes.delete(like.id);
    removeId(state.likes, like.id);
  } else if (action === 'like') {
    // Bounded search: current visible pool plus at most four API feed pages (including an empty wrap).
    // TrailBase custom-order feeds support offsets, not cursors; keep progress independent of listPublic.
    const buffers = acquireSearch(state), { liked, candidates } = buffers;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        liked.clear(); candidates.length = 0;
        for (let i = 0; i < state.likes.length; i++) liked.add(state.likes[i].post);
        for (let i = 0; i < state.visible.length; i++) {
          const id = state.visible[i];
          if (!liked.has(id)) candidates.push(id);
        }
        for (let probe = 0; probe < 5 && candidates.length; probe++) {
          const index = Math.floor(rng() * candidates.length), post = candidates[index];
          for (let i = index + 1; i < candidates.length; i++) candidates[i - 1] = candidates[i];
          candidates.length--;
          prerequisite();
          const existing = await likes.list({ pagination: { limit: 1 }, filters: [{ column: 'post', value: post }] });
          valid(existing.records.every(l => l.post === post && l.user === state.user));
          if (existing.records.length) {
            remember(state.likes, { id: existing.records[0].id, post });
            continue;
          }
          const id = await likes.create({ user: state.user, post });
          valid(typeof id === 'string' && id.length > 0);
          remember(state.likes, { id, post });
          return;
        }
        if (attempt < 4) {
          prerequisite();
          const result = await page(posts, state, config, false, state.offset);
          copyIds(state.visible, result.records);
          // Prepared feed walks must also support the native page-based SDK; legacy offsets stay unchanged.
          state.offset = result.records.length ? state.offset + (config.version === 'social-prepared-v1' ? config.pageSize : result.records.length) : 0;
        }
      }
      unavailable();
    } finally { liked.clear(); candidates.length = 0; buffers.busy = false; }
  } else throw new Error('Unknown action');
}
