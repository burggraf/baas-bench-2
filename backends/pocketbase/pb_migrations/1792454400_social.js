migrate((app) => {
  // Fresh PocketBase already provisions its native users auth collection.
  const users = app.findCollectionByNameOrId('users');
  users.createRule = '';
  users.listRule = users.viewRule = users.updateRule = users.deleteRule = 'id = @request.auth.id';
  users.fields.getByName('email').required = false;
  users.fields.add(new TextField({ name: 'username', required: true, max: 100 }));
  users.addIndex('idx_users_username', true, 'username', '');
  users.passwordAuth = { enabled: true, identityFields: ['username'] };
  users.authToken.duration = 3600;
  users.authAlert.enabled = false;
  app.save(users);
  const posts = new Collection({
    name: 'posts', type: 'base', listRule: '', viewRule: '',
    createRule: '@request.auth.id != "" && author = @request.auth.id',
    updateRule: '@request.auth.id != "" && author = @request.auth.id && @request.body.author:changed = false',
    deleteRule: '@request.auth.id != "" && author = @request.auth.id',
    fields: [
      { name: 'author', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: 'title', type: 'text', required: true, max: 200 },
      { name: 'body', type: 'text', required: true, max: 4096 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE INDEX idx_posts_feed ON posts (created DESC, id DESC)', 'CREATE INDEX idx_posts_own ON posts (author, created DESC, id DESC)'],
  });
  app.save(posts);
  app.save(new Collection({
    name: 'likes', type: 'base', listRule: '@request.auth.id != "" && user = @request.auth.id', viewRule: '@request.auth.id != "" && user = @request.auth.id',
    createRule: '@request.auth.id != "" && user = @request.auth.id', updateRule: null,
    deleteRule: '@request.auth.id != "" && user = @request.auth.id',
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: 'post', type: 'relation', collectionId: posts.id, required: true, maxSelect: 1, cascadeDelete: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_likes_user_post ON likes (user, post)'],
  }));
  // Native SDK batches are preparation-only; timed actions still issue individual requests.
  const settings = app.settings();
  settings.batch.enabled = true;
  app.save(settings);
});
