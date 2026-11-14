import {defineSchema,defineTable} from 'convex/server';
import {v} from 'convex/values';
export default defineSchema({
 users:defineTable({postCount:v.number()}),
 posts:defineTable({author:v.id('users'),title:v.string(),body:v.string(),created_at:v.number(),updated_at:v.number(),sort_id:v.string()}).index('feed',['created_at','sort_id']).index('author_feed',['author','created_at','sort_id']),
 likes:defineTable({user:v.id('users'),post:v.id('posts')}).index('user_post',['user','post']).index('post',['post']),
});
