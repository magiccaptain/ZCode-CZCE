import type {
  AccountAccessIdentityInput,
  AccountRequestAuthInput,
  AccountRequestAuthMaterial,
  AccountRequestAuthResolver,
} from "./accountProviderRequestAuthService.js";
import type { ZCodeAccountAccess, ZCodeProviderAccountAccess } from "@zcode/shared";
import {
  assertProductAccountEnabled,
  type AccountProductCapabilities,
} from "../productAccountBoundary.js";

/**
 * 请求期 Account 鉴权边界。
 *
 * 服务按 Active Model 的静态 family/mode 约束，从当前账号连接解析请求材料。
 * 它不保存 Provider Config，也不提供 Registry fallback。
 */
export interface IAccountRequestAuthService {
  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

export function createAccountRequestAuthService(
  resolver: AccountRequestAuthResolver,
  productCapabilities?: AccountProductCapabilities,
): IAccountRequestAuthService {
  return {
    resolveAccessCurrent(access) {
      if (productCapabilities?.productAccount === false) return Promise.resolve(null);
      return resolver.resolveAccessCurrent(access);
    },
    async resolveCurrent(input) {
      assertProductAccountEnabled(productCapabilities);
      return resolver.resolveCurrent(input);
    },
    async assertCurrent(input) {
      assertProductAccountEnabled(productCapabilities);
      return resolver.assertCurrent(input);
    },
  };
}

export type {
  AccountRequestAuthInput,
  AccountAccessIdentityInput,
  AccountRequestAuthMaterial,
  AccountRequestAuthResolver,
} from "./accountProviderRequestAuthService.js";
