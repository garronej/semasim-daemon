
import { webApiDeclaration as apiDeclaration } from "../../semasim-frontend";
import * as dbSemasim from "../dbSemasim";
import * as dbTurn from "../dbTurn";
import { 
    Handler, 
    Handlers, 
    internalErrorCustomHttpCode, 
    httpCodes 
} from "../../tools/webApi";
import * as sessionManager from "./sessionManager";
import { getUserWebUaInstanceId } from "../toUa/localApiHandlers";
import * as dcSanityChecks from "chan-dongle-extended-client/dist/lib/sanityChecks";


import { 
    version as semasim_gateway_version ,
    misc as gwMisc,
    types as gwTypes
} from "../../semasim-gateway";

import * as html_entities from "html-entities";
const entities = new html_entities.XmlEntities;

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

    const methodName = "get-user-linphone-config";

    type Params = { 
        email_as_hex: string; 
        password_as_hex: string; 
        uuid: string; 
        format?: "XML" | "INI" 
    };

    const hexToUtf8 = (hexStr: string) => Buffer.from(hexStr, "hex").toString("utf8");

    const substitute4BytesChar = (str: string) => Array.from(str)
        .map(c => Buffer.from(c, "utf8").length <= 3 ? c : "?")
        .join("")
        ;

    const toXml = (config: object): string => {

        return [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            [
                `<config xmlns="http://www.linphone.org/xsds/lpconfig.xsd" `,
                `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `,
                `xsi:schemaLocation="http://www.linphone.org/xsds/lpconfig.xsd lpconfig.xsd">`,
            ].join(""),
            ...(() => {

                const sections: string[] = [];

                for (const keySection in config) {

                    sections.push([
                        `  <section name="${keySection}">`,
                        ...(() => {

                            const entries: string[] = [];

                            for (const keyEntry in config[keySection]) {

                                entries.push([
                                    `    <entry name="${keyEntry}" overwrite="true">`,
                                    entities.encode(config[keySection][keyEntry]),
                                    `</entry>`
                                ].join(""));

                            }

                            return entries;

                        })(),
                        `  </section>`
                    ].join("\n"));

                }

                return sections;

            })(),
            `</config>`
        ].join("\n");

    };

    const toIni = (config: object): string => {

        return Object.keys(config).map(
            keySection => [
                `[${keySection}]`,
                ...(Object.keys(config[keySection])
                    .map(keyEntry => `${keyEntry}=${config[keySection][keyEntry]}`))
            ].join("\n")
        ).join("\n\n");

    };

    //text/plain

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "application/xml; charset=utf-8",
        "sanityCheck": params => {
            try {
                return (
                    gwMisc.isValidEmail(hexToUtf8(params.email_as_hex)) &&
                    !!hexToUtf8(params.password_as_hex) &&
                    typeof params.uuid === "string" &&
                    (
                        params.format === undefined ||
                        params.format === "INI" ||
                        params.format === "XML"
                    )
                );
            } catch {
                return false;
            }
        },
        "handler": async (params, _session, _remoteAddress, _req, overwriteResponseContentType) => {

            const email = hexToUtf8(params.email_as_hex).toLowerCase();
            const password = hexToUtf8(params.password_as_hex);

            const turnAuth= await dbTurn.renewAndGetCred(`"<urn:uuid:${params.uuid}>"`);

            const format = params.format || "XML";

            const user = await dbSemasim.authenticateUser(email, password);

            if (!user) {

                const error = new Error("User not authenticated");

                internalErrorCustomHttpCode.set(error, httpCodes.UNAUTHORIZED);

                throw error;

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

                /*
                 * If we believe what is stated here 
                 * https://www.slideshare.net/saghul/ice-4414037
                 * The UDP relay is required only when 
                 * both the gateway and the client 
                 * are behind symmetric NATs.
                 * But so far we do not provide TURN
                 * access to the gateway because there is no
                 * way to renew the password.
                 * In other word we force the user to connect
                 * he's gateway NOT behind a symmetric NAT
                 * and thus the UDP relay will never be mandatory.
                 * Given the fact that linphone does not implement
                 * TURN relay via TCP and TLS we can disable turn
                 * all together.
                 * We leave the everything set up for TURN and
                 * just remove "turn" from protocol this way 
                 * if we ever move on ont the gateway side we can quickly
                 * restore everything.
                 * 
                 * The problems we currently have when we enable turn are:
                 * -On coturn log we sometime have a bunch of those lines:
                 * 7: session 0...01: realm <semasim> user <cc4...d014>: incoming packet message processed, 
                 * error 437: Mismatched allocation: wrong transaction ID
                 * Then linphone does not offer ANY candidate.
                 * -Outgoing calls are always relayed.
                 */
                config[`nat_policy_${endpointCount}`] = {
                    "ref": `nat_policy_${endpointCount}`,
                    "stun_server": "semasim.com",
                    //"protocols": "stun,turn,ice",
                    "protocols": "stun,ice",
                    "stun_server_username": turnAuth.username
                };

                //TODO: It's dirty to have this here, do we even need XML anymore?
                const safeFriendlyName = substitute4BytesChar(
                    format === "XML" ? friendlyName : friendlyName.replace(/"/g, `\\"`)
                );

                /** 
                 * iso does not really need to be in the contact parameters.
                 * The gateway already know the SIM's origin country.
                 * We set it here however to inform linphone about it,
                 * linphone does not have the lib to parse IMSI so
                 * we need to provide this info.
                 * The fact that the iso travel in the sip messages
                 * is just a side effect.
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

                    //TODO: It's dirty to have this here.
                    const safeContactName = substitute4BytesChar(
                        format === "XML" ? contact.name : contact.name.replace(/"/g, `\\"`)
                    );

                    config[`friend_${contactCount}`] = {
                        "url": `"${safeContactName} (proxy_${endpointCount})" <sip:${contact.number_raw}@semasim.com>`,
                        "pol": "accept",
                        "subscribe": "0"
                    };

                    contactCount++;

                }

                endpointCount++;

            }

            config[`auth_info_${endpointCount}`] = {
                "username": turnAuth.username,
                "userid": turnAuth.username,
                "passwd": turnAuth.credential,
                "realm": "semasim"
            };

            if (format === "INI") {

                overwriteResponseContentType("text/plain; charset=utf-8");

            }

            return Buffer.from(
                format === "XML" ? toXml(config) : toIni(config),
                "utf8"
            );

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

    const methodName = "declare-ua";

    type Params = {
        platform: gwTypes.Ua.Platform;
        email_as_hex: string;
        password_as_hex: string;
        uuid: string;
        push_token_as_hex: string;
    };;

    const hexToUtf8 = (hexStr: string) => Buffer.from(hexStr, "hex").toString("utf8");

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "text/plain; charset=utf-8",
        "sanityCheck": params => {
            try {
                return (
                    gwMisc.sanityChecks.platform(params.platform) &&
                    gwMisc.isValidEmail(hexToUtf8(params.email_as_hex)) &&
                    !!hexToUtf8(params.password_as_hex) &&
                    typeof params.uuid === "string" &&
                    !!hexToUtf8(params.push_token_as_hex)
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

            await dbSemasim.addOrUpdateUa({
                "instance": `"<urn:uuid:${params.uuid}>"`,
                "userEmail": email,
                "platform": params.platform,
                "pushToken": hexToUtf8(params.push_token_as_hex),
                "software": ""
            });

            return Buffer.from("UA SUCCESSFULLY REGISTERED", "utf8");

        }
    };

    handlers[methodName] = handler;

}

{

    const methodName = "is-sim-online";

    type Params = {
        email_as_hex: string;
        password_as_hex: string;
        imsi: string;
    };

    const hexToUtf8 = (hexStr: string) => Buffer.from(hexStr, "hex").toString("utf8");

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "text/plain; charset=utf-8",
        "sanityCheck": params => {
            try {
                return (
                    gwMisc.isValidEmail(hexToUtf8(params.email_as_hex)) &&
                    !!hexToUtf8(params.password_as_hex) &&
                    dcSanityChecks.imsi(params.imsi)
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

            return dbSemasim.getUserSims({ user, email }).then(
                userSims => userSims.find(({ sim }) => sim.imsi === params.imsi)
            ).then(userSim => !userSim ? false : userSim.isOnline)
                .then(isOnline => Buffer.from(isOnline ? "1" : "0", "utf8"));

        }
    };

    handlers[methodName] = handler;

}
