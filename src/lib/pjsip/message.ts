import { 
    DongleExtendedClient,
    textSplitBase64ForAmiSplitFirst
} from "chan-dongle-extended-client";

import { getAvailableContactsOfEndpoint } from "./endpointsContacts";

import { SyncEvent } from "ts-events-extended";
import { Base64 } from "js-base64";

import { messageContext } from "./dbInterface";

const appKeyword = "semasim";

let body_id= 0;

export async function sendMessage(
    endpoint: string,
    from: string,
    headers: Record<string, string>,
    body: string,
    message_type: string,
    response_to_call_id?: string,
    visible_message?: string
) {

    let bodyInHeader= typeof( visible_message ) === "string";

    headers = { ...headers, "body_id": `${body_id++}` };

    if (response_to_call_id)
        headers = { ...headers, response_to_call_id };


    let offsetKey: string;

    if (bodyInHeader) {
        offsetKey = computeVariableLine(
            toSipHeaders(
                message_type,
                { ...headers, "body_split_count": "XXXX", "part_number": "XXXX", "base64_body": "" }
            )
        );
    } else offsetKey = "Base64Body";


    let bodyParts = textSplitBase64ForAmiSplitFirst(
        body,
        offsetKey
    ).map(part => Base64.decode(part));

    headers = { ...headers, "body_split_count": `${bodyParts.length}` };

    for (let contact of await getAvailableContactsOfEndpoint(endpoint))
        for (let index = 0; index < bodyParts.length; index++){

            let body:string;

            if( bodyInHeader ){
                headers= { ...headers, "base64_body": Base64.encode(bodyParts[index]) };
                body= (index===0)?visible_message!:"";
            }else body= bodyParts[index];

            await DongleExtendedClient.localhost().ami.messageSend(
                `pjsip:${contact}`,
                from,
                body,
                toSipHeaders(message_type, { ...headers, "part_number": `${index}` })
            );

        }

}

function toSipHeaders(
    message_type: string,
    headers: Record<string, string>
): Record<string, string> {

    let sipHeaders: Record<string, string> = {};

    sipHeaders[`${appKeyword}-message_type`] = message_type;

    for (let key of Object.keys(headers))
        sipHeaders[`${appKeyword}-${message_type}-${key}`] = headers[key];

    return sipHeaders;


}

function computeVariableLine(sipHeaders: Record<string, string>): string {

    let line = "";

    for (let key of Object.keys(sipHeaders))
        line += `${key}=${sipHeaders[key]},`;

    return "Variables" + line.slice(0, -1);

}


function getActualTo(toUri: string): string {

    return toUri.match(/^(?:pj)?sip:([^@]+)/)![1];

}

function getEndpoint(from: string): string {

    return from.match(/^<sip:([^@]+)/)![1];

}


export interface PacketSipMessage {
    to: string;
    from_endpoint: string;
    headers: {
        call_id: string;
        [key: string]: string;
    };
    body: string;
}

let evtPacketSipMessage: SyncEvent<PacketSipMessage> | undefined = undefined;

export function getEvtPacketSipMessage(): SyncEvent<PacketSipMessage> {

    if (evtPacketSipMessage) return evtPacketSipMessage;

    evtPacketSipMessage = new SyncEvent<PacketSipMessage>();

    getEvtPacketReassembled().attach(({ to, from, headers, body }) => {

        let packet: PacketSipMessage = {
            "to": getActualTo(to),
            "from_endpoint": getEndpoint(from),
            headers,
            body
        };

        evtPacketSipMessage!.post(packet);

    });

    return evtPacketSipMessage;


}

interface PacketReassembled {
    to: string;
    from: string;
    headers: {
        call_id: string;
        [key: string]: string;
    };
    body: string;
}

function getEvtPacketReassembled(): SyncEvent<PacketReassembled> {

    let evt = new SyncEvent<PacketReassembled>();

    let evtPacketWithExtraHeaders = getEvtPacketWithExtraHeaders();

    evtPacketWithExtraHeaders.attach(async ({ to, from, headers, body }) => {


        let { body_split_count, body_part_number, body_id, ...restHeaders } = headers;

        let packet: Partial<PacketReassembled> = {
            to, from,
            "headers": restHeaders,
        };

        let bodyParts: string[] = [];

        bodyParts[headers.body_part_number] = body;

        while (bodyParts.filter(v=>v).length !== parseInt(body_split_count)) {

            let { headers, body } = await evtPacketWithExtraHeaders.waitFor(newPacket => (
                to === newPacket.to &&
                from === newPacket.from &&
                body_id === newPacket.headers.body_id
            ));

            bodyParts[headers.body_part_number] = body;

        }

        packet.body = bodyParts.join("");

        evt.post(packet as PacketReassembled);

    });

    return evt;

}




interface PacketWithExtraHeaders {
    to: string;
    from: string;
    headers: {
        call_id: string;
        body_split_count: string;
        body_part_number: string;
        body_id: string;
        [key: string]: string;
    };
    body: string;
}


function getEvtPacketWithExtraHeaders(): SyncEvent<PacketWithExtraHeaders> {

    let evt = new SyncEvent<PacketWithExtraHeaders>();

    getEvtPacketRaw().attach(packetRaw => {

        let mainBody = Base64.decode(packetRaw.base64_body);

        let packet: PacketWithExtraHeaders = {
            "to": packetRaw.to,
            "from": packetRaw.from,
            "headers": {
                "call_id": packetRaw.call_id,
                "body_split_count": `${1}`,
                "body_part_number": `${1}`,
                "body_id": `${undefined}`,
            },
            "body": mainBody
        };


        try {

            let { body, ...extra_headers } = JSON.parse(mainBody);

            if (!body) throw new Error();

            packet.body = body;
            packet.headers = {
                ...packet.headers,
                ...extra_headers
            };

        } catch (error) { }

        evt!.post(packet);


    });

    return evt;

}


interface PacketRaw {
    to: string;
    from: string;
    call_id: string;
    content_length: string;
    base64_body: string;
}

function getEvtPacketRaw(): SyncEvent<PacketRaw> {

    let evt = new SyncEvent<PacketRaw>();

    let ami = DongleExtendedClient.localhost().ami;

    initDialplan().then(() => {

        ami.evt.attach(
            ({ event, context, priority }) => (
                event === "Newexten" &&
                context === messageContext &&
                priority === "1"
            ),
            async newExten => {

                let packet: Partial<PacketRaw> = {};

                let uniqueId = newExten.uniqueid;

                while (true) {

                    let { application, appdata } = newExten;

                    if (application === "Hangup") break;

                    let match: RegExpMatchArray | null;

                    if (
                        application === "NoOp" &&
                        (match = appdata.match(/^([^=]+)===(.*)$/))
                    ) packet[match[1]] = match[2];

                    newExten = await ami.evt.waitFor(
                        ({ uniqueid }) => uniqueid === uniqueId
                    );

                }

                if (!packet.base64_body && packet.content_length) {

                    sendMessage(
                        getEndpoint(packet.from!),
                        getActualTo(packet.to!),
                        {},
                        "TOO LONG!",
                        "error",
                        packet.call_id
                    );

                    return;

                }

                evt!.post(packet as PacketRaw);

            }
        );

    });


    return evt;

}

async function initDialplan() {

    let ami = DongleExtendedClient.localhost().ami;

    let arrAppData = [
        "to===${MESSAGE(to)}",
        "from===${MESSAGE(from)}",
        "call_id===${MESSAGE_DATA(Call-ID)}",
        "content_length===${MESSAGE_DATA(Content-Length)}",
        "base64_body===${BASE64_ENCODE(${MESSAGE(body)})}"
    ];


    let matchAllExt = "_.";

    await ami.removeExtension(matchAllExt, messageContext);

    let priority = 1;

    for (let appData of arrAppData)
        await ami.addDialplanExtension(messageContext, matchAllExt, priority++, "NoOp", appData);

    await ami.addDialplanExtension(messageContext, matchAllExt, priority, "Hangup");

}

/* let arrAppData = [
        ...[
            "MESSAGE(to)",
            "MESSAGE(from)",
            "MESSAGE_DATA(Via)",
            "MESSAGE_DATA(To)",
            "MESSAGE_DATA(From)",
            "MESSAGE_DATA(Call-ID)",
            "MESSAGE_DATA(CSeq)",
            "MESSAGE_DATA(Allow)",
            "MESSAGE_DATA(Content-Type)",
            "MESSAGE_DATA(User-Agent)",
            "MESSAGE_DATA(Authorization)",
            "MESSAGE_DATA(Content-Length)",
            "MESSAGE_DATA(True-Content-Type)"
        ].map(variable => `${variable}===\${${variable}}`),
        `MESSAGE(base-64-encoded-body)===\${BASE64_ENCODE(\${MESSAGE(body)})}`
    ];
    */