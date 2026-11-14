import {internalMutationGeneric as internalMutation} from 'convex/server';
import {v} from 'convex/values';
export const createUser=internalMutation({args:{method:v.object({name:v.literal('usernamePassword'),profile:v.object({})})},returns:v.id('users'),handler:async ctx=>ctx.db.insert('users',{postCount:0})});
