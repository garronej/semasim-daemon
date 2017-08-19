import { DongleExtendedClient, Ami } from "chan-dongle-extended-client";
import { Contact } from "./endpointsContacts";
import { evtOutgoingMessage, evtIncomingMessage } from "./inboundSipProxy";
import * as sip from "./sipLibrary";
import { SyncEvent } from "ts-events-extended";
import * as c from "./constants";


import * as _debug from "debug";
let debug = _debug("_admin/message");

export const evtMessage= evtIncomingMessage;

export async function start() {

    let ami = DongleExtendedClient.localhost().ami;

    let matchAllExt = "_.";

    await ami.dialplanExtensionRemove(matchAllExt, c.sipMessageContext);

    await ami.dialplanExtensionAdd(c.sipMessageContext, matchAllExt, 1, "Hangup");


};

export function sendMessage(
    contact: Contact,
    from_number: string,
    headers: Record<string, string>,
    text: string,
    from_number_sim_name?: string
): Promise<boolean> {

    return new Promise<boolean>((resolve, reject) => {

        //debug("sendMessage", { contact, from_number, headers, text, from_number_sim_name });

        let actionId = Ami.generateUniqueActionId();

        let uri= contact.path.split(",")[0].match(/^<(.*)>$/)![1].replace(/;lr/,"");

        DongleExtendedClient.localhost().ami.messageSend(
            `pjsip:${contact.endpoint}/${uri}`, from_number, actionId
        ).catch( error=> reject(error));

        evtOutgoingMessage.attachOnce(
            ({ sipRequest }) => sipRequest.content === actionId,
            ({ sipRequest, evtReceived }) => {

                //TODO: inform that the name come from the SD card
                if (from_number_sim_name) sipRequest.headers.from.name = `"${from_number_sim_name} (sim)"`;

                sipRequest.uri= contact.uri;
                sipRequest.headers.to= { "name": undefined, "uri": contact.uri, "params": {} };

                delete sipRequest.headers.contact;

                sipRequest.content = text;

                sipRequest.headers = { ...sipRequest.headers, ...headers };

                evtReceived.waitFor(3500).then(() => resolve(true)).catch(() => resolve(false));

            }
        );


    });


}