
import { webApiDeclaration as apiDeclaration } from "../../semasim-frontend";
import * as dbSemasim from "../dbSemasim";
import { 
    Handler, 
    Handlers, 
    internalErrorCustomHttpCode, 
    httpCodes 
} from "../../tools/webApi";
import * as sessionManager from "./sessionManager";
import { getUserWebUaInstanceId } from "../toUa/localApiHandlers";


import { 
    version as semasim_gateway_version ,
    misc as gwMisc,
    types as gwTypes
} from "../../semasim-gateway";

export const handlers: Handlers = {};

//TODO: regexp for password once and for all!!!
//TODO: regexp for friendly name!!!
//TODO: set some reasonable max length for text messages... maybe set max packet length

{

    const methodName = apiDeclaration.registerUser.methodName;
    type Params = apiDeclaration.registerUser.Params;
    type Response = apiDeclaration.registerUser.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": false,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            gwMisc.isValidEmail(params.email) &&
            typeof params.password === "string"
        ),
        "handler": async ({ email, password }) => {

            const user = await dbSemasim.createUserAccount(email, password);

            if (!user) {
                return "EMAIL NOT AVAILABLE";
            }

            await dbSemasim.addOrUpdateUa({
                "instance": getUserWebUaInstanceId(user),
                "userEmail": email,
                "platform": "web",
                "pushToken": "",
                "software": "JsSIP"
            });

            return "CREATED";

        }
    };

    handlers[methodName] = handler;

}

{

    const methodName = apiDeclaration.loginUser.methodName;
    type Params = apiDeclaration.loginUser.Params;
    type Response = apiDeclaration.loginUser.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": false,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            gwMisc.isValidEmail(params.email) &&
            typeof params.password === "string"
        ),
        "handler": async ({ email, password }, session) => {

            let user = await dbSemasim.authenticateUser(email, password);

            if (!user) {

                return false;

            }

            sessionManager.setAuth(session, {
                user, "email": email.toLocaleLowerCase()
            });

            return true;

        }
    };

    handlers[methodName] = handler;

}

{

    const methodName = apiDeclaration.logoutUser.methodName;
    type Params = apiDeclaration.logoutUser.Params;
    type Response = apiDeclaration.logoutUser.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => params === undefined,
        "handler": (_params, session) => {

            sessionManager.setAuth(session, undefined);

            return undefined;

        }
    };

    handlers[methodName] = handler;

}

{

    const methodName = apiDeclaration.sendRenewPasswordEmail.methodName;
    type Params = apiDeclaration.sendRenewPasswordEmail.Params;
    type Response = apiDeclaration.sendRenewPasswordEmail.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": false,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            gwMisc.isValidEmail(params.email)
        ),
        "handler": async ({ email }) => {

            const hash = await dbSemasim.getUserHash(email);

            //TODO send email

            return hash !== undefined;

        }
    };

    handlers[methodName] = handler;

}

{

    const methodName = "version";
    type Params = {};

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "text/plain; charset=utf-8",
        "sanityCheck": (params) => params instanceof Object,
        "handler": async () => Buffer.from(semasim_gateway_version, "utf8")
    };

    handlers[methodName] = handler;

}

{

    const methodName = "linphonerc";

    type Params = { 
        email_as_hex: string; 
        password_as_hex: string; 
    } | {
        email_as_hex: string; 
        password_as_hex: string; 
        uuid: string; 
        platform: gwTypes.Ua.Platform;
        push_token_as_hex: string;
    };


    const hexToUtf8 = (hexStr: string) => Buffer.from(hexStr, "hex").toString("utf8");

    const substitute4BytesChar = (str: string) => Array.from(str)
        .map(c => Buffer.from(c, "utf8").length <= 3 ? c : "?")
        .join("")
        ;

    const toIni = (config: object): string => Object.keys(config).map(
        keySection => [
            `[${keySection}]`,
            ...(Object.keys(config[keySection])
                .map(keyEntry => `${keyEntry}=${config[keySection][keyEntry]}`))
        ].join("\n")
    ).join("\n\n");


    //text/plain

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "text/plain; charset=utf-8",
        "sanityCheck": params => {
            try {
                return (
                    gwMisc.isValidEmail(hexToUtf8(params.email_as_hex)) &&
                    !!hexToUtf8(params.password_as_hex) &&
                    !("uuid" in params) ||
                    (
                        "uuid" in params &&
                        gwMisc.sanityChecks.platform(params.platform) &&
                        !!hexToUtf8(params.password_as_hex)
                    )
                );
            } catch {
                return false;
            }
        },
        "handler": async params => {

            const email = hexToUtf8(params.email_as_hex).toLowerCase();
            const password = hexToUtf8(params.password_as_hex);

            const user = await dbSemasim.authenticateUser(email, password);

            if (!user) {

                const error = new Error("User not authenticated");

                internalErrorCustomHttpCode.set(error, httpCodes.UNAUTHORIZED);

                throw error;

            }

            if ("uuid" in params) {

                await dbSemasim.addOrUpdateUa({
                    "instance": `"<urn:uuid:${params.uuid}>"`,
                    "userEmail": email,
                    "platform": params.platform,
                    "pushToken": hexToUtf8(params.push_token_as_hex),
                    //TODO: Remove this field from project.
                    "software": ""
                });

            }

            const p_email = `enc_email=${gwMisc.urlSafeB64.enc(email)}`;
            const config: object = {};
            let endpointCount = 0;
            let contactCount = 0;

            for (
                const { sim, friendlyName, password, ownership, phonebook, isOnline }
                of await dbSemasim.getUserSims({ user, email })
            ) {

                if (ownership.status === "SHARED NOT CONFIRMED") {
                    continue;
                }

                config[`nat_policy_${endpointCount}`] = {
                    "ref": `nat_policy_${endpointCount}`,
                    "stun_server": "semasim.com",
                    "protocols": "stun,ice"
                };

                //TODO: It's dirty to have this here, do we even need XML anymore?
                const safeFriendlyName = substitute4BytesChar(friendlyName.replace(/"/g, `\\"`));

                /** 
                 * iso does not really need to be in the contact parameters.
                 * The gateway already know the SIM's origin country.
                 * We set it here however to inform linphone about it,
                 * linphone does not have the lib to parse IMSI so
                 * we need to provide this info.
                 * */
                config[`proxy_${endpointCount}`] = {
                    "reg_proxy": `<sip:semasim.com;transport=TLS>`,
                    "reg_route": `sip:semasim.com;transport=TLS;lr`,
                    "reg_expires": `${21601}`,
                    "reg_identity": `"${safeFriendlyName}" <sip:${sim.imsi}@semasim.com;transport=TLS;${p_email}>`,
                    "contact_parameters": `${p_email};iso=${sim.country ? sim.country.iso : "undefined"}`,
                    "reg_sendregister": isOnline ? "1" : "0",
                    "publish": "0",
                    "nat_policy_ref": `nat_policy_${endpointCount}`
                };

                config[`auth_info_${endpointCount}`] = {
                    "username": sim.imsi,
                    "userid": sim.imsi,
                    "passwd": password
                };

                for (const contact of phonebook) {

                    const safeContactName = substitute4BytesChar(contact.name.replace(/"/g, `\\"`));

                    config[`friend_${contactCount}`] = {
                        "url": `"${safeContactName} (proxy_${endpointCount})" <sip:${contact.number_raw}@semasim.com>`,
                        "pol": "accept",
                        "subscribe": "0"
                    };

                    contactCount++;

                }

                endpointCount++;

            }

            return Buffer.from(toIni(config), "utf8");

        }
    };

    handlers[methodName] = handler;

}

