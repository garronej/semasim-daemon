import { Auth } from "../lib/web/sessionManager";
import { types as feTypes } from "../frontend";
export declare function launch(): Promise<void>;
/**
 * -Create new subscription
 * -Re-enable subscription that have been canceled.
 * -Update default source for user.
 */
export declare function subscribeUser(auth: Auth, sourceId?: string): Promise<void>;
/** Assert customer exist and is subscribed */
export declare function unsubscribeUser(auth: Auth): Promise<void>;
export declare function getSubscriptionInfos(auth: Auth, iso?: string): Promise<feTypes.SubscriptionInfos>;
export declare function isUserSubscribed(auth: Auth): Promise<boolean>;
export declare function registerWebHooks(app: import("express").Express): void;