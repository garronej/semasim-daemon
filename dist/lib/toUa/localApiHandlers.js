"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const backendToUa_1 = require("../../sip_api_declarations/backendToUa");
const connections = require("./connections");
const dbSemasim = require("../dbSemasim");
const frontend_1 = require("../../frontend");
const dcSanityChecks = require("chan-dongle-extended-client/dist/lib/sanityChecks");
const pushNotifications = require("../pushNotifications");
const gatewayRemoteApiCaller = require("../toGateway/remoteApiCaller");
const remoteApiCaller = require("./remoteApiCaller");
const dbWebphone = require("../dbWebphone");
const emailSender = require("../emailSender");
const sessionManager = require("../web/sessionManager");
const gateway_1 = require("../../gateway");
const stripe = require("../stripe");
const noThrow_1 = require("../../tools/noThrow");
exports.handlers = {};
/** Throw if session object associated with the connection is no longer authenticated. */
function getAuthenticatedSession(socket) {
    const session = connections.getSession(socket);
    if (!sessionManager.isAuthenticated(session)) {
        throw new Error("Connection authentication no longer valid");
    }
    return session;
}
{
    const methodName = backendToUa_1.apiDeclaration.getUsableUserSims.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.includeContacts === "boolean"),
        "handler": async ({ includeContacts }, socket) => {
            const session = getAuthenticatedSession(socket);
            //TODO: Create a SQL request that pull only usable sims
            const userSims = await dbSemasim.getUserSims(session)
                .then(userSims => userSims.filter(frontend_1.types.UserSim.Usable.match));
            if (!includeContacts) {
                for (const userSim of userSims) {
                    userSim.sim.storage.contacts = [];
                    userSim.phonebook = [];
                }
            }
            return userSims;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.unlockSim.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imei(params.imei) &&
            typeof params.pin === "string" &&
            !!params.pin.match(/^[0-9]{4}$/)),
        "handler": ({ imei, pin }, socket) => gatewayRemoteApiCaller.unlockSim(imei, pin, socket.remoteAddress)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.registerSim.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            dcSanityChecks.imei(params.imei) &&
            typeof params.friendlyName === "string"),
        "handler": async ({ imsi, imei, friendlyName }, socket) => {
            const session = getAuthenticatedSession(socket);
            const dongleSipPasswordAndTowardSimEncryptKeyStr = await gatewayRemoteApiCaller.getDongleSipPasswordAndTowardSimEncryptKeyStr(imsi);
            if (!dongleSipPasswordAndTowardSimEncryptKeyStr) {
                throw new Error("Dongle not found");
            }
            const { dongle, sipPassword, towardSimEncryptKeyStr } = dongleSipPasswordAndTowardSimEncryptKeyStr;
            if (dongle.imei !== imei) {
                throw new Error("Attack prevented");
            }
            //NOTE: The user may have changer ip since he received the request
            //in this case the query will crash... not a big deal.
            const userUas = await dbSemasim.registerSim(session, dongle.sim, friendlyName, sipPassword, towardSimEncryptKeyStr, dongle, socket.remoteAddress, dongle.isGsmConnectivityOk, dongle.cellSignalStrength);
            //TODO: this should be an api method
            pushNotifications.sendSafe(userUas, { "type": "RELOAD CONFIG" });
            //NOTE: Here we break the rule of gathering all db request
            //but as sim registration is not a so common operation it's not
            //a big deal.
            return dbSemasim.getUserSims(session)
                .then(userSims => userSims
                .filter(frontend_1.types.UserSim.Owned.match)
                .find(({ sim }) => sim.imsi === imsi));
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.unregisterSim.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi)),
        "handler": async ({ imsi }, socket) => {
            const session = getAuthenticatedSession(socket);
            const { affectedUas, owner } = await dbSemasim.unregisterSim(session, imsi);
            //TODO: We should have a different method for the ua that lost perm and the ua that have got the sim unregistered by the user.
            remoteApiCaller.notifySimPermissionLost(imsi, affectedUas.filter(({ instance }) => session.shared.uaInstanceId !== instance));
            if (owner.user !== session.user) {
                const getUserUas = noThrow_1.buildNoThrowProxyFunction(dbSemasim.getUserUas, dbSemasim);
                const { ownership: { sharedWith: { confirmed } } } = (await dbSemasim.getUserSims(owner))
                    .find(({ sim }) => sim.imsi === imsi);
                Promise.all([owner.shared.email, ...confirmed].map(email => getUserUas(email)))
                    .then(arrOfUas => arrOfUas.reduce((prev, curr) => [...prev, ...curr], []))
                    .then(uas => remoteApiCaller.notifyOtherSimUserUnregisteredSim({ imsi, "email": session.shared.email }, uas));
            }
            pushNotifications.sendSafe(affectedUas, { "type": "RELOAD CONFIG" });
            gatewayRemoteApiCaller.reNotifySimOnline(imsi);
            return undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.rebootDongle.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi)),
        "handler": async ({ imsi }, socket) => {
            const session = getAuthenticatedSession(socket);
            //TODO: Reboot dongle should be by imei
            const isAllowedTo = await dbSemasim.getUserSims(session)
                .then(userSims => !!userSims.find(({ sim }) => sim.imsi === imsi));
            if (!isAllowedTo) {
                throw new Error("user not allowed to reboot this dongle");
            }
            const { isSuccess } = await gatewayRemoteApiCaller.rebootDongle(imsi);
            if (!isSuccess) {
                throw new Error("Reboot dongle error");
            }
            return undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const { methodName } = backendToUa_1.apiDeclaration.shareSim;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.emails instanceof Array &&
            !!params.emails.length &&
            !params.emails.find(email => !gateway_1.misc.isValidEmail(email)) &&
            typeof params.message === "string"),
        "handler": async ({ imsi, emails, message }, socket) => {
            const session = getAuthenticatedSession(socket);
            const affectedUsers = await dbSemasim.shareSim(session, imsi, emails, message);
            const getUserSims = noThrow_1.buildNoThrowProxyFunction(dbSemasim.getUserSims, dbSemasim);
            const getUserUas = noThrow_1.buildNoThrowProxyFunction(dbSemasim.getUserUas, dbSemasim);
            getUserSims(session).then(userSims => userSims
                .filter(frontend_1.types.UserSim.Owned.match)
                .find(({ sim }) => sim.imsi === imsi)).then(userSim => emailSender.sharingRequestSafe(session.shared.email, userSim, message, [
                ...affectedUsers.notRegistered.map(email => ({ email, "isRegistered": false })),
                ...affectedUsers.registered.map(({ shared: { email } }) => ({ email, "isRegistered": true }))
            ]));
            for (const auth of affectedUsers.registered) {
                Promise.all([
                    getUserSims(auth)
                        .then(userSims => userSims
                        .filter(frontend_1.types.UserSim.Shared.NotConfirmed.match)
                        .find(({ sim }) => sim.imsi === imsi)),
                    getUserUas(auth.shared.email)
                ]).then(([userSim, uas]) => remoteApiCaller.notifySimSharingRequest(userSim, uas));
            }
            return undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const { methodName } = backendToUa_1.apiDeclaration.stopSharingSim;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.emails instanceof Array &&
            !!params.emails.length &&
            !params.emails.find(email => !gateway_1.misc.isValidEmail(email))),
        "handler": async ({ imsi, emails }, socket) => {
            const session = getAuthenticatedSession(socket);
            const noLongerRegisteredUas = await dbSemasim.stopSharingSim(session, imsi, emails);
            if (noLongerRegisteredUas.length !== 0) {
                gatewayRemoteApiCaller.reNotifySimOnline(imsi);
            }
            remoteApiCaller.notifySimPermissionLost(imsi, [
                ...noLongerRegisteredUas,
                ...await dbSemasim.getUserUas(session.shared.email)
            ]);
            //TODO: Other ua should be notified that no longer sharing.
            pushNotifications.sendSafe(noLongerRegisteredUas, { "type": "RELOAD CONFIG" });
            return undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.changeSimFriendlyName.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            typeof params.friendlyName === "string"),
        "handler": async ({ imsi, friendlyName }, socket) => {
            const session = getAuthenticatedSession(socket);
            const userUas = await dbSemasim.setSimFriendlyName(session, imsi, friendlyName);
            pushNotifications.sendSafe(userUas, { "type": "RELOAD CONFIG" });
            return undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const { methodName } = backendToUa_1.apiDeclaration.acceptSharingRequest;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            typeof params.friendlyName === "string"),
        "handler": async ({ imsi, friendlyName }, socket) => {
            const session = getAuthenticatedSession(socket);
            const userUas = await dbSemasim.setSimFriendlyName(session, imsi, friendlyName);
            //TODO: Send notification to other user ua that there is a new sim
            pushNotifications.sendSafe(userUas, { "type": "RELOAD CONFIG" });
            const { ownership: { ownerEmail, otherUserEmails }, password } = await dbSemasim.getUserSims(session)
                .then(userSims => userSims
                .filter(frontend_1.types.UserSim.Shared.Confirmed.match)
                .find(({ sim }) => sim.imsi === imsi));
            const getUserUas = noThrow_1.buildNoThrowProxyFunction(dbSemasim.getUserUas, dbSemasim);
            Promise.all([ownerEmail, ...otherUserEmails].map(email => getUserUas(email)))
                .then(arrOfUas => arrOfUas.reduce((prev, curr) => [...prev, ...curr], []))
                .then(uas => remoteApiCaller.notifySharingRequestResponse({ imsi, "email": session.shared.email, "isAccepted": true }, uas));
            return { password };
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.rejectSharingRequest.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi)),
        "handler": async ({ imsi }, socket) => {
            const session = getAuthenticatedSession(socket);
            const { owner } = await dbSemasim.unregisterSim(session, imsi);
            remoteApiCaller.notifySharingRequestResponse({ imsi, "email": session.shared.email, "isAccepted": false }, await dbSemasim.getUserUas(owner.shared.email));
            return undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.createContact.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            typeof params.name === "string" &&
            typeof params.number === "string"),
        "handler": async ({ imsi, name, number }, socket) => {
            const session = getAuthenticatedSession(socket);
            const userSim = await dbSemasim.getUserSims(session)
                .then(userSims => userSims
                .filter(frontend_1.types.UserSim.Usable.match)
                .find(({ sim }) => sim.imsi === imsi));
            if (!userSim) {
                throw new Error("User does not have access to this sim");
            }
            if (!!userSim.phonebook.find(({ number_raw }) => number_raw === number)) {
                throw new Error("Already a contact with this number");
            }
            const storageInfos = await Promise.resolve((() => {
                if (userSim.sim.storage.infos.storageLeft !== 0) {
                    return gatewayRemoteApiCaller.createContact(imsi, name, number);
                }
                return undefined;
            })());
            //TODO: this function should return number local format.
            const uasRegisteredToSim = await dbSemasim.createOrUpdateSimContact(imsi, name, number, storageInfos);
            pushNotifications.sendSafe(uasRegisteredToSim, { "type": "RELOAD CONFIG" });
            remoteApiCaller.notifyContactCreatedOrUpdated({
                imsi,
                name,
                "number_raw": number,
                "storage": storageInfos !== undefined ? ({
                    "mem_index": storageInfos.mem_index,
                    "name_as_stored": storageInfos.name_as_stored,
                    "new_digest": storageInfos.new_storage_digest
                }) : undefined
            }, uasRegisteredToSim.filter(({ instance }) => session.shared.uaInstanceId !== instance));
            //TODO: see wtf with number local format here why the hell there isn't new_digest.
            return storageInfos !== undefined ? ({
                "mem_index": storageInfos.mem_index,
                "name_as_stored_in_sim": storageInfos.name_as_stored,
                "new_digest": storageInfos.new_storage_digest
            }) : undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const { methodName } = backendToUa_1.apiDeclaration.updateContactName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.contactRef instanceof Object &&
            (typeof params.contactRef["mem_index"] === "number" ||
                typeof params.contactRef["number"] === "string") &&
            typeof params.newName === "string" &&
            params.newName !== ""),
        "handler": async ({ imsi, contactRef, newName }, socket) => {
            const session = getAuthenticatedSession(socket);
            const userSim = await dbSemasim.getUserSims(session)
                .then(userSims => userSims
                .filter(frontend_1.types.UserSim.Usable.match)
                .find(({ sim }) => sim.imsi === imsi));
            if (!userSim) {
                throw new Error("User does not have access to this sim");
            }
            let contact;
            if ("mem_index" in contactRef) {
                contact = userSim.phonebook.find(({ mem_index }) => mem_index === contactRef.mem_index);
            }
            else {
                contact = userSim.phonebook.find(({ number_raw }) => number_raw === contactRef.number);
            }
            if (!contact) {
                throw new Error("Referenced contact does not exist does not exist.");
            }
            if (contact.name === newName) {
                //No need to update contact, name unchanged
                return contact.mem_index !== undefined ?
                    ({
                        "name_as_stored_in_sim": userSim.sim.storage.contacts
                            .find(({ index }) => index === contact.mem_index).name,
                        "new_digest": userSim.sim.storage.digest
                    }) : undefined;
            }
            let storageInfos;
            if (contact.mem_index !== undefined) {
                const resp = await gatewayRemoteApiCaller.updateContactName(imsi, contact.mem_index, newName);
                if (resp) {
                    storageInfos = {
                        "mem_index": contact.mem_index,
                        "name_as_stored": resp.new_name_as_stored,
                        "new_storage_digest": resp.new_storage_digest
                    };
                }
                else {
                    //TODO: the contact should maybe be updated anyway
                    throw new Error("update contact failed on the gateway");
                }
            }
            else {
                storageInfos = undefined;
            }
            const uasRegisteredToSim = await dbSemasim.createOrUpdateSimContact(imsi, newName, contact.number_raw, storageInfos);
            pushNotifications.sendSafe(uasRegisteredToSim, { "type": "RELOAD CONFIG" });
            remoteApiCaller.notifyContactCreatedOrUpdated({
                imsi,
                "name": newName,
                "number_raw": contact.number_raw,
                "storage": storageInfos !== undefined ? ({
                    "mem_index": storageInfos.mem_index,
                    "name_as_stored": storageInfos.name_as_stored,
                    "new_digest": storageInfos.new_storage_digest
                }) : undefined
            }, uasRegisteredToSim.filter(({ instance }) => session.shared.uaInstanceId !== instance));
            return storageInfos !== undefined ?
                ({
                    "name_as_stored_in_sim": storageInfos.name_as_stored,
                    "new_digest": storageInfos.new_storage_digest
                }) : undefined;
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.deleteContact.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi) &&
            params.contactRef instanceof Object &&
            (typeof params.contactRef["mem_index"] === "number" ||
                typeof params.contactRef["number"] === "string")),
        "handler": async ({ imsi, contactRef }, socket) => {
            const session = getAuthenticatedSession(socket);
            const userSim = await dbSemasim.getUserSims(session)
                .then(userSims => userSims
                .filter(frontend_1.types.UserSim.Usable.match)
                .find(({ sim }) => sim.imsi === imsi));
            if (!userSim) {
                throw new Error("User does not have access to this sim");
            }
            let contact;
            if ("mem_index" in contactRef) {
                contact = userSim.phonebook.find(({ mem_index }) => mem_index === contactRef.mem_index);
            }
            else {
                contact = userSim.phonebook.find(({ number_raw }) => number_raw === contactRef.number);
            }
            if (!contact) {
                throw new Error("Referenced contact does not exist does not exist.");
            }
            let prQuery;
            let storage;
            if (contact.mem_index !== undefined) {
                //TODO: avoid var
                const resp = await gatewayRemoteApiCaller.deleteContact(imsi, contact.mem_index);
                if (!resp) {
                    throw new Error("Delete contact failed on dongle");
                }
                storage = {
                    "mem_index": contact.mem_index,
                    "new_digest": resp.new_storage_digest
                };
                prQuery = dbSemasim.deleteSimContact(imsi, {
                    "mem_index": contact.mem_index,
                    "new_storage_digest": resp.new_storage_digest
                });
            }
            else {
                storage = undefined;
                prQuery = dbSemasim.deleteSimContact(imsi, { "number_raw": contact.number_raw });
            }
            const uasRegisteredToSim = await prQuery;
            remoteApiCaller.notifyContactDeleted({
                imsi,
                "number_raw": contact.number_raw,
                storage
            }, uasRegisteredToSim.filter(({ instance }) => session.shared.uaInstanceId !== instance));
            pushNotifications.sendSafe(uasRegisteredToSim, { "type": "RELOAD CONFIG" });
            return { "new_digest": storage !== undefined ? storage.new_digest : undefined };
        }
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.shouldAppendPromotionalMessage.methodName;
    const handler = {
        "sanityCheck": params => params === undefined,
        "handler": async (_params, socket) => {
            const session = getAuthenticatedSession(socket);
            return !(await stripe.isUserSubscribed(session));
        }
    };
    exports.handlers[methodName] = handler;
}
//Web UA data
{
    const methodName = backendToUa_1.apiDeclaration.getOrCreateInstance.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            dcSanityChecks.imsi(params.imsi)),
        "handler": ({ imsi }, socket) => dbWebphone.getOrCreateInstance(getAuthenticatedSession(socket).user, imsi)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.newChat.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.instance_id === "number" &&
            params.contactNumber instanceof Object &&
            typeof params.contactNumber.encrypted_string === "string" &&
            params.contactName instanceof Object &&
            typeof params.contactName.encrypted_string === "string" &&
            params.contactIndexInSim instanceof Object &&
            typeof params.contactIndexInSim.encrypted_number_or_null === "string"),
        "handler": (params, socket) => dbWebphone.newChat(getAuthenticatedSession(socket).user, params.instance_id, params.contactNumber, params.contactName, params.contactIndexInSim)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.fetchOlderMessages.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.chat_id === "number" &&
            typeof params.olderThanMessageId === "number"),
        "handler": ({ chat_id, olderThanMessageId }, socket) => dbWebphone.fetchOlderMessages(getAuthenticatedSession(socket).user, chat_id, olderThanMessageId)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.updateChat.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.chat_id === "number" &&
            (params.contactIndexInSim === undefined ||
                params.contactIndexInSim instanceof Object &&
                    typeof params.contactIndexInSim.encrypted_number_or_null === "string") && (params.contactName === undefined ||
            params.contactName instanceof Object &&
                typeof params.contactName.encrypted_string === "string") && (params.idOfLastMessageSeen === undefined ||
            params.idOfLastMessageSeen === null ||
            typeof params.idOfLastMessageSeen === "number")),
        "handler": (params, socket) => dbWebphone.updateChat(getAuthenticatedSession(socket).user, params.chat_id, params.contactIndexInSim, params.contactName, params.idOfLastMessageSeen).then(() => undefined)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.destroyChat.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.chat_id === "number"),
        "handler": ({ chat_id }, socket) => dbWebphone.destroyChat(getAuthenticatedSession(socket).user, chat_id).then(() => undefined)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.newMessage.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.chat_id === "number" &&
            (() => {
                const m = params.message;
                return (m instanceof Object &&
                    typeof m.time === "number" &&
                    m.text instanceof Object &&
                    typeof m.text.encrypted_string === "string" &&
                    ((m.direction === "INCOMING" &&
                        typeof m.isNotification === "boolean")
                        ||
                            (m.direction === "OUTGOING" && ((m.status === "PENDING" &&
                                true) || (m.status === "SEND REPORT RECEIVED" &&
                                typeof m.isSentSuccessfully === "boolean") || (m.status === "STATUS REPORT RECEIVED" &&
                                (typeof m.deliveredTime === "number" ||
                                    m.deliveredTime === null) && (m.sentBy instanceof Object &&
                                (m.sentBy.who === "USER" ||
                                    (m.sentBy.who === "OTHER" &&
                                        m.sentBy.email instanceof Object &&
                                        typeof m.sentBy.email.encrypted_string === "string"))))))));
            })()),
        "handler": ({ chat_id, message }, socket) => dbWebphone.newMessage(getAuthenticatedSession(socket).user, chat_id, message)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.notifySendReportReceived.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.message_id === "number" &&
            typeof params.isSentSuccessfully === "boolean"),
        "handler": ({ message_id, isSentSuccessfully }, socket) => dbWebphone.updateMessageOnSendReport(getAuthenticatedSession(socket).user, message_id, isSentSuccessfully).then(() => undefined)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.notifyStatusReportReceived.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.message_id === "number" &&
            (typeof params.deliveredTime === "number" ||
                params.deliveredTime === null)),
        "handler": ({ message_id, deliveredTime }, socket) => dbWebphone.updateMessageOnStatusReport(getAuthenticatedSession(socket).user, message_id, deliveredTime).then(() => undefined)
    };
    exports.handlers[methodName] = handler;
}
{
    const methodName = backendToUa_1.apiDeclaration.notifyStatusReportReceived.methodName;
    const handler = {
        "sanityCheck": params => (params instanceof Object &&
            typeof params.message_id === "number" &&
            (typeof params.deliveredTime === "number" ||
                params.deliveredTime === null)),
        "handler": ({ message_id, deliveredTime }, socket) => dbWebphone.updateMessageOnStatusReport(getAuthenticatedSession(socket).user, message_id, deliveredTime).then(() => undefined)
    };
    exports.handlers[methodName] = handler;
}
