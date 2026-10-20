-- Schema only. All accounts, posts and likes are created through the SDK.
CREATE TABLE posts (
  id BLOB PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  author BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 16384),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE INDEX posts_latest ON posts(created_at DESC, id DESC);
CREATE INDEX posts_author_latest ON posts(author, created_at DESC, id DESC);

CREATE TRIGGER posts_updated_at AFTER UPDATE OF title, body ON posts
BEGIN
  UPDATE posts SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TABLE likes (
  id BLOB PRIMARY KEY NOT NULL CHECK(is_uuid_v7(id)) DEFAULT (uuid_v7()),
  user BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  post BLOB NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user, post)
) STRICT;

CREATE INDEX likes_post ON likes(post);
