import {setupConvexAuth} from '@convex-dev/auth/server';
import {setupUsernamePassword} from '@convex-dev/auth/methods/username-password/server';
import {components,internal} from './_generated/api';
// Match the established comparison's native 3,600-second access-token policy.
const auth=setupConvexAuth({component:components.auth,accessTokenTtlSeconds:3600});
export const {signOut,refreshSession,isAuthenticated}=auth;
export const {signUpWithUsernamePassword,signInWithUsernamePassword}=setupUsernamePassword(auth,{component:components.authPassword,usernameComponent:components.authUsername}).attachUserCallbacks({createUser:internal.users.createUser});
