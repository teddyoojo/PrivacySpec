export const installAccountFixtures = (base) =>
  base.extend({ accountId: async (_fixtures, use) => use("account-1") });
