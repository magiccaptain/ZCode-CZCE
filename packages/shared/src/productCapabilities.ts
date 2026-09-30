import { z } from "zod";

/** 产品范围契约；具体产品组装层拥有固定值，不能从用户或服务环境推导。 */
export const productCapabilitiesSchema = z.strictObject({
  localAgent: z.boolean(),
  localProviderConfig: z.boolean(),
  skills: z.boolean(),
  mcp: z.boolean(),
  webProduct: z.boolean(),
  appUpdates: z.boolean(),
  pluginMarketplace: z.boolean(),
  productAccount: z.boolean(),
  productSubscription: z.boolean(),
  sharing: z.boolean(),
  telemetry: z.boolean(),
  remoteWorkspaces: z.boolean(),
  mobileRemoteControl: z.boolean(),
});

export type ProductCapabilities = Readonly<z.infer<typeof productCapabilitiesSchema>>;
export const APP_UPDATES_UNAVAILABLE = "APP_UPDATES_UNAVAILABLE";
