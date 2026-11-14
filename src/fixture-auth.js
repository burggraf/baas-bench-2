// Optional untimed authentication lifecycle. Default backends retain native login/logout.
export const authorizeFixture = (context,client,user) => context ? context.authorize(client,user) : client.login(user.username,user.password);
export const releaseFixture = (context,client,user) => context ? context.release(client,user) : client.logout();
