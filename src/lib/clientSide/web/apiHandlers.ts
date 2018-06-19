
import * as dcSanityChecks from "chan-dongle-extended-client/dist/lib/sanityChecks";
import {
    webApiDeclaration as d
} from "../../../semasim-frontend";
import * as db from "../../dbSemasim";
import { Handler, Handlers, internalErrorCustomHttpCode, httpCodes } from "../../../tools/webApi";
import * as sessionManager from "./sessionManager";
import * as dbw from "./dbWebphone";
import * as gatewaySideSockets from "../sipProxy/gatewaySideSockets";
import * as pushNotifications from "../../pushNotifications";

import { types as gwTypes, version as semasim_gateway_version } from "../../../semasim-gateway";
import isValidEmail = gwTypes.misc.isValidEmail


import * as html_entities from "html-entities";
const entities = new html_entities.XmlEntities;

export const handlers: Handlers = {};

//TODO: regexp for password once and for all!!!
//TODO: regexp for friendly name!!!
//TODO: set some reasonable max length for text messages... maybe set max packet length

(() => {

    let methodName = d.registerUser.methodName;
    type Params = d.registerUser.Params;
    type Response = d.registerUser.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": false,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            isValidEmail(params.email) &&
            typeof params.password === "string"
        ),
        "handler": async ({ email, password }) => {

            let user = await db.createUserAccount(email, password);

            return user ? "CREATED" : "EMAIL NOT AVAILABLE";

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.loginUser.methodName;
    type Params = d.loginUser.Params;
    type Response = d.loginUser.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": false,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            isValidEmail(params.email) &&
            typeof params.password === "string"
        ),
        "handler": async ({ email, password }, session) => {

            let user = await db.authenticateUser(email, password);

            if (!user) {

                console.log(" authentication failed ");

                return false;

            }

            console.log(" authentication success");

            sessionManager.setAuth(session, {
                user, "email": email.toLocaleLowerCase()
            });

            return true;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.logoutUser.methodName;
    type Params = d.logoutUser.Params;
    type Response = d.logoutUser.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => params === undefined,
        "handler": (params, session) => {

            sessionManager.setAuth(session, undefined);

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.sendRenewPasswordEmail.methodName;
    type Params = d.sendRenewPasswordEmail.Params;
    type Response = d.sendRenewPasswordEmail.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": false,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            isValidEmail(params.email)
        ),
        "handler": async ({ email }) => {

            let hash = await db.getUserHash(email);

            //TODO send email

            return hash !== undefined;

        }
    };

    handlers[methodName] = handler;

})();


(() => {

    let methodName = d.getSims.methodName;
    type Params = d.getSims.Params;
    type Response = d.getSims.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => params === undefined,
        "handler": (params, session) => db.getUserSims(sessionManager.getAuth(session)!.user)
    };

    handlers[methodName] = handler;

})();

(() => {

    /*
    TODO: optimizations.
    */

    let methodName = d.getUnregisteredLanDongles.methodName;
    type Params = d.getUnregisteredLanDongles.Params;
    type Response = d.getUnregisteredLanDongles.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => params === undefined,
        "handler": async (params, session, remoteAddress) =>
            db.filterDongleWithRegistrableSim(
                sessionManager.getAuth(session)!.user,
                await gatewaySideSockets.getDongles(remoteAddress)
            )
    };

    handlers[methodName] = handler;

})();


(() => {

    let methodName = d.unlockSim.methodName;
    type Params = d.unlockSim.Params;
    type Response = d.unlockSim.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imei(params.imei) &&
            typeof params.pin === "string" &&
            !!params.pin.match(/^[0-9]{4}$/)
        ),
        "handler": async ({ imei, pin }, session, remoteAddress) => {

            let result = await gatewaySideSockets.unlockDongle(
                imei, pin, remoteAddress, sessionManager.getAuth(session)!
            );

            if (result === undefined) {
                throw new Error("Unlock failed, internal error");
            }

            return result;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.registerSim.methodName;
    type Params = d.registerSim.Params;
    type Response = d.registerSim.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            typeof params.friendlyName === "string"
        ),
        "handler": async ({ imsi, friendlyName }, session, remoteAddress) => {

            try {

                var { dongle, sipPassword } = (await gatewaySideSockets.getSipPasswordAndDongle(
                    imsi,
                    remoteAddress
                ))!;

            } catch{

                throw new Error("Dongle not found");

            }

            const userUas = await db.registerSim(
                session.auth!.user,
                dongle.sim,
                friendlyName,
                sipPassword,
                dongle,
                remoteAddress
            );

            pushNotifications.send(userUas, "RELOAD CONFIG");

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.unregisterSim.methodName;
    type Params = d.unregisterSim.Params;
    type Response = d.unregisterSim.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi)
        ),
        "handler": async ({ imsi }, session) => {

            let affectedUas = await db.unregisterSim(
                session.auth!.user,
                imsi
            );

            gatewaySideSockets.reNotifySimOnline(imsi);

            pushNotifications.send(affectedUas, "RELOAD CONFIG");

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.shareSim.methodName;
    type Params = d.shareSim.Params;
    type Response = d.shareSim.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.emails instanceof Array &&
            !!params.emails.length &&
            !params.emails.find(email => !isValidEmail(email)) &&
            typeof params.message === "string"
        ),
        "handler": async (params, session) => {

            let { imsi, emails, message } = params;

            let affectedUsers = await db.shareSim(
                session.auth!,
                imsi,
                emails,
                message
            );

            //TODO: send email to notify new sim shared

            return affectedUsers;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.stopSharingSim.methodName;
    type Params = d.stopSharingSim.Params;
    type Response = d.stopSharingSim.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.emails instanceof Array &&
            !!params.emails.length &&
            !params.emails.find(email => !isValidEmail(email))
        ),
        "handler": async ({ imsi, emails }, session) => {

            let noLongerRegisteredUas = await db.stopSharingSim(
                session.auth!.user,
                imsi,
                emails
            );

            if (noLongerRegisteredUas.length) {

                gatewaySideSockets.reNotifySimOnline(imsi);

                pushNotifications.send(noLongerRegisteredUas, "RELOAD CONFIG");

            }

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = d.setSimFriendlyName.methodName;
    type Params = d.setSimFriendlyName.Params;
    type Response = d.setSimFriendlyName.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            typeof params.friendlyName === "string"
        ),
        "handler": async ({ imsi, friendlyName }, session) => {

            let userUas = await db.setSimFriendlyName(
                session.auth!.user,
                imsi,
                friendlyName
            );

            pushNotifications.send(userUas, "RELOAD CONFIG");

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();


(() => {

    const methodName = d.createContact.methodName;
    type Params = d.createContact.Params;
    type Response = d.createContact.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            typeof params.name === "string" &&
            typeof params.number === "string"
        ),
        "handler": async ({ imsi, name, number }, session, remoteAddress) => {

            const result = await gatewaySideSockets.createContact(
                imsi, name, number, sessionManager.getAuth(session)!
            );

            if (result === undefined) {
                throw new Error("Unlock failed, internal error");
            }

            return result;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    const methodName = d.updateContactName.methodName;
    type Params = d.updateContactName.Params;
    type Response = d.updateContactName.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.contactRef instanceof Object &&
            (
                typeof params.contactRef["mem_index"] === "number" ||
                typeof params.contactRef["number"] === "string"
            ) &&
            typeof params.newName === "string" &&
            params.newName !== ""
        ),
        "handler": async ({ imsi, contactRef, newName }, session, remoteAddress) => {

            const result = await gatewaySideSockets.updateContactName(
                imsi, contactRef, newName, sessionManager.getAuth(session)!
            );

            if( !result.isSuccess ){
                throw new Error("Update contact error");
            }

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();

(() => {

    const methodName = d.deleteContact.methodName;
    type Params = d.deleteContact.Params;
    type Response = d.deleteContact.Response;

    const handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.contactRef instanceof Object &&
            (
                typeof params.contactRef["mem_index"] === "number" ||
                typeof params.contactRef["number"] === "string"
            )
        ),
        "handler": async ({ imsi, contactRef }, session, remoteAddress) => {

            const result = await gatewaySideSockets.deleteContact(
                imsi, contactRef, sessionManager.getAuth(session)!
            );

            if( !result.isSuccess ){
                throw new Error("Delete contact error");
            }

            return undefined;

        }
    };

    handlers[methodName] = handler;

})();


(() => {

    //TODO: enable "Send DTMFs in SIP" disable "Send DTMFs in stream" in static config
    //TODO: remove response from declaration
    const methodName = "get-user-linphone-config";
    type Params = { email_as_hex: string; password_as_hex: string; };;

    const hexToUtf8 = (hexStr: string) => Buffer.from(hexStr, "hex").toString("utf8");

    const ov = ` overwrite="true" `;
    const domain = "semasim.com";

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "application/xml",
        "sanityCheck": params => {
            try {
                return (
                    isValidEmail(hexToUtf8(params.email_as_hex)) &&
                    typeof hexToUtf8(params.password_as_hex) === "string"
                );
            } catch {
                return false;
            }
        },
        "handler": async params => {

            const email = hexToUtf8(params.email_as_hex).toLowerCase();
            const password = hexToUtf8(params.password_as_hex);

            const user = await db.authenticateUser(email, password);

            if (!user) {

                const error = new Error("User not authenticated");

                internalErrorCustomHttpCode.set(error, httpCodes.UNAUTHORIZED);

                throw error;

            }

            const endpointEntries: string[] = [];
            const contactEntries: string[] = [];

            const p_email = `enc_email=${gwTypes.misc.urlSafeB64.enc(email)}`;

            for (const { sim, friendlyName, password, ownership, phonebook } of await db.getUserSims(user)) {

                if (ownership.status === "SHARED NOT CONFIRMED") {
                    continue;
                }

                endpointEntries[endpointEntries.length] = [
                    `  <section name="nat_policy_${endpointEntries.length}">`,
                    `    <entry name="ref" ${ov}>nat_policy_${endpointEntries.length}</entry>`,
                    `    <entry name="stun_server" ${ov}>${domain}</entry>`,
                    `    <entry name="protocols" ${ov}>stun,ice</entry>`,
                    `  </section>`,
                    `  <section name="proxy_${endpointEntries.length}">`,
                    `    <entry name="reg_proxy" ${ov}>sip:${domain};transport=TLS</entry>`,
                    `    <entry name="reg_route" ${ov}>sip:${domain};transport=TLS;lr</entry>`,
                    `    <entry name="reg_expires" ${ov}>${21601}</entry>`,
                    [
                        `    <entry name="reg_identity" ${ov}>`,
                        entities.encode(`"${friendlyName}" <sip:${sim.imsi}@${domain};transport=TLS;${p_email}>`),
                        `</entry>`,
                    ].join(""),
                    `    <entry name="contact_parameters" ${ov}>${p_email}</entry>`, //TODO: See if it work with Ios, if not remove
                    `    <entry name="reg_sendregister" ${ov}>1</entry>`,
                    `    <entry name="publish" ${ov}>0</entry>`,
                    `    <entry name="nat_policy_ref" ${ov}>nat_policy_${endpointEntries.length}</entry>`,
                    `  </section>`,
                    `  <section name="auth_info_${endpointEntries.length}">`,
                    `    <entry name="username" ${ov}>${sim.imsi}</entry>`,
                    `    <entry name="userid" ${ov}>${sim.imsi}</entry>`,
                    `    <entry name="passwd" ${ov}>${password}</entry>`,
                    `  </section>`
                ].join("\n");

                for (const contact of phonebook) {

                    contactEntries[contactEntries.length] = [
                        `  <section name="friend_${contactEntries.length}">`,
                        [
                            `    <entry name="url" ${ov}>`,
                            entities.encode(
                                `"${contact.name} (${friendlyName})" <sip:${contact.number_local_format}@${domain}>`
                            ),
                            `</entry>`
                        ].join(""),
                        `    <entry name="pol" ${ov}>accept</entry>`,
                        `    <entry name="subscribe" ${ov}>0</entry>`,
                        `  </section>`,
                    ].join("\n");

                }

            }

            return Buffer.from([
                `<?xml version="1.0" encoding="UTF-8"?>`,
                [
                    `<config xmlns="http://www.linphone.org/xsds/lpconfig.xsd" `,
                    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `,
                    `xsi:schemaLocation="http://www.linphone.org/xsds/lpconfig.xsd lpconfig.xsd">`,
                ].join(""),
                ...endpointEntries,
                ...contactEntries,
                `</config>`
            ].join("\n"), "utf8");

        }
    };

    handlers[methodName] = handler;


})();

(() => {

    const methodName = "version";
    type Params = {};

    const handler: Handler.Generic<Params> = {
        "needAuth": false,
        "contentType": "text/plain; charset=utf-8",
        "sanityCheck": (params) => params instanceof Object,
        "handler": async () => Buffer.from( semasim_gateway_version, "utf8")
    };

    handlers[methodName] = handler;

})();


import dw = d.webphoneData;

(() => {

    let methodName = dw.fetch.methodName;
    type Params = dw.fetch.Params;
    type Response = dw.fetch.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => params === undefined,
        "handler": (params, session) => dbw.fetch(sessionManager.getAuth(session)!)
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.newInstance.methodName;
    type Params = dw.newInstance.Params;
    type Response = dw.newInstance.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            dcSanityChecks.imsi(params.imsi)
        ),
        "handler": (params, session) => dbw.newInstance(
            sessionManager.getAuth(session)!.user,
            params.imsi
        )
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.newChat.methodName;
    type Params = dw.newChat.Params;
    type Response = dw.newChat.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            typeof params.instance_id === "number" &&
            typeof params.contactNumber === "string" &&
            typeof params.contactName === "string" &&
            ( typeof params.contactIndexInSim === "number" || params.contactIndexInSim === null )
        ),
        "handler": (params, session) => dbw.newChat(
            sessionManager.getAuth(session)!.user,
            params.instance_id,
            params.contactNumber,
            params.contactName,
            params.contactIndexInSim
        )
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.updateChat.methodName;
    type Params = dw.updateChat.Params;
    type Response = dw.updateChat.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            typeof params.chat_id === "number" &&
            (
                params.lastSeenTime === undefined ||
                typeof params.lastSeenTime === "number"
            ) && (
                params.contactName === undefined ||
                typeof params.contactName === "string"
            ) && (
                params.contactIndexInSim === undefined ||
                typeof params.contactIndexInSim === "number" ||
                params.contactIndexInSim === null
            )
        ),
        "handler": (params, session) => dbw.updateChat(
            sessionManager.getAuth(session)!.user,
            params.chat_id,
            params.lastSeenTime,
            params.contactName,
            params.contactIndexInSim
        )
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.destroyChat.methodName;
    type Params = dw.destroyChat.Params;
    type Response = dw.destroyChat.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            typeof params.chat_id === "number"
        ),
        "handler": (params, session) => dbw.destroyChat(
            sessionManager.getAuth(session)!.user,
            params.chat_id
        )
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.newMessage.methodName;
    type Params = dw.newMessage.Params;
    type Response = dw.newMessage.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            typeof params.chat_id === "number" &&
            params.message instanceof Object &&
            typeof params.message.time === "number" &&
            typeof params.message.text === "string" &&
            (
                (
                    params.message.direction === "INCOMING" &&
                    typeof params.message.isNotification === "boolean"
                ) ||
                (
                    params.message.direction === "OUTGOING" &&
                    (
                        params.message.status === "TRANSMITTED TO GATEWAY" ||
                        (
                            params.message.status === "SEND REPORT RECEIVED" &&
                            (
                                typeof params.message.dongleSendTime === "number" ||
                                params.message.dongleSendTime === null
                            )
                        ) ||
                        (
                            params.message.status === "STATUS REPORT RECEIVED" &&
                            (
                                typeof params.message.dongleSendTime === "number" ||
                                params.message.dongleSendTime === null
                            ) && (
                                typeof params.message.deliveredTime === "number" ||
                                params.message.deliveredTime === null
                            )
                        )
                    ) &&
                    params.message.sentBy instanceof Object &&
                    (
                        params.message.sentBy.who === "MYSELF" ||
                        (
                            params.message.sentBy.who === "OTHER" &&
                            isValidEmail(params.message.sentBy.email)
                        )
                    )
                )
            )
        ),
        "handler": (params, session) => dbw.newMessage(
            sessionManager.getAuth(session)!.user,
            params.chat_id,
            params.message
        )
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.updateOutgoingMessageStatusToSendReportReceived.methodName;
    type Params = dw.updateOutgoingMessageStatusToSendReportReceived.Params;
    type Response = dw.updateOutgoingMessageStatusToSendReportReceived.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            typeof params.message_id === "number" &&
            (
                typeof params.dongleSendTime === "number" ||
                params.dongleSendTime === null
            )
        ),
        "handler": (params, session) => dbw.updateOutgoingMessageStatusToSendReportReceived(
            sessionManager.getAuth(session)!.user,
            params.message_id,
            params.dongleSendTime
        )
    };

    handlers[methodName] = handler;

})();

(() => {

    let methodName = dw.updateOutgoingMessageStatusToStatusReportReceived.methodName;
    type Params = dw.updateOutgoingMessageStatusToStatusReportReceived.Params;
    type Response = dw.updateOutgoingMessageStatusToStatusReportReceived.Response;

    let handler: Handler.JSON<Params, Response> = {
        "needAuth": true,
        "contentType": "application/json-custom; charset=utf-8",
        "sanityCheck": params => (
            params instanceof Object &&
            typeof params.message_id === "number" &&
            (
                typeof params.deliveredTime === "number" ||
                params.deliveredTime === null
            )
        ),
        "handler": (params, session) => dbw.updateOutgoingMessageStatusToStatusReportReceived(
            sessionManager.getAuth(session)!.user,
            params.message_id,
            params.deliveredTime
        )
    };

    handlers[methodName] = handler;

})();
