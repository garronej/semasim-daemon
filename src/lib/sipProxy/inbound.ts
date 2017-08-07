import * as net from "net";
import * as sip from "./sip";
import { SyncEvent, VoidSyncEvent } from "ts-events-extended";
import { DongleExtendedClient } from "chan-dongle-extended-client";
import * as os from "os";
import * as outbound from "./outbound";
import * as outboundApi from "./outbound.api";
import { startListening as apiStartListening } from "./inbound.api";

import * as admin from "../admin";
import { Contact } from "../admin";

import * as tls from "tls";

import "colors";

import * as _debug from "debug";
let debug = _debug("_sipProxy/inbound");

//TODO change that otherwise only work on raspberry pi
const localIp= os.networkInterfaces()["eth0"].filter( ({family})=> family === "IPv4" )[0]["address"];

export const evtIncomingMessage = new SyncEvent<{
    contact: admin.Contact;
    message: sip.Request;
}>();

export const evtOutgoingMessage = new SyncEvent<{ 
    sipRequest: sip.Request;
    evtReceived: VoidSyncEvent;
}>();


export let asteriskSockets: sip.Store;
export let proxySocket: sip.Socket;

export async function start() {

    debug("(re)Staring !");

    asteriskSockets = new sip.Store();

    proxySocket = new sip.Socket(
        tls.connect({ 
            "host": outbound.hostname, 
            "port": outbound.listeningPortForDevices 
        }) as any
    );

    proxySocket.setKeepAlive(true);

    /*
    proxySocket.evtPacket.attach(sipPacket =>
        console.log("From proxy:\n", sip.stringify(sipPacket).yellow, "\n\n")
    );
    proxySocket.evtData.attach(chunk =>
        console.log("From proxy:\n", chunk.yellow, "\n\n")
    );
    */

    proxySocket.evtRequest.attach(async sipRequest => {


        let flowToken = sipRequest.headers.via[0].params[outbound.flowTokenKey]!;

        let asteriskSocket = asteriskSockets.get(flowToken);

        if (!asteriskSocket)
            asteriskSocket = createAsteriskSocket(flowToken, proxySocket);

        if (!asteriskSocket.evtConnect.postCount)
            await asteriskSocket.evtConnect.waitFor();


        if (sipRequest.method === "REGISTER") {

            sipRequest.headers["user-agent"] = Contact.buildValueOfUserAgentField(
                sip.parseUri(sipRequest.headers.from.uri).user!,
                sipRequest.headers.contact![0].params["+sip.instance"]!,
                sipRequest.headers["user-agent"]!
            );

            asteriskSocket.addPathHeader(sipRequest);

        } else
            asteriskSocket.shiftRouteAndAddRecordRoute(sipRequest);


        let branch = asteriskSocket.addViaHeader(sipRequest);

        //TODO match with authentication
        if (sip.isPlainMessageRequest(sipRequest)) {

            asteriskSocket.evtResponse.attachOncePrepend(
                ({ headers }) => headers.via[0].params["branch"] === branch,
                async sipResponse => {

                    if (sipResponse.status !== 202) return;

                    let contact = await admin.getContactFromAstSocketSrcPort(asteriskSocket!.localPort);

                    if (!contact) {

                        //TODO? Change result code, is it possible ?
                        debug(`Contact not found for incoming message!!!`);

                        return;

                    }

                    evtIncomingMessage.post({ contact, "message": sipRequest });

                }
            );

        }

        asteriskSocket.write(sipRequest);

    });


    proxySocket.evtResponse.attach(sipResponse => {

        let flowToken = sipResponse.headers.via[0].params[outbound.flowTokenKey]!;

        let asteriskSocket = asteriskSockets.get(flowToken);

        if (!asteriskSocket) return;

        asteriskSocket.rewriteRecordRoute(sipResponse);

        sipResponse.headers.via.shift();

        asteriskSocket.write(sipResponse);

    });


    proxySocket.evtClose.attachOnce(() => {

        //TODO see what is the state of contacts

        debug("proxy socket closed, destroying all asterisk socket, waiting and restarting");

        asteriskSockets.destroyAll();

        setTimeout(() => start(), 3000);

    });


    proxySocket.evtConnect.attachOnce(async () => {

        debug("connection established with proxy");

        apiStartListening();

        for (let { imei } of await DongleExtendedClient.localhost().getActiveDongles())
            notifyHandledDongle( imei );

    });

    DongleExtendedClient.localhost().evtNewActiveDongle.attach(({imei}) => notifyHandledDongle(imei));

    async function notifyHandledDongle(imei: string ) {

        if (!proxySocket.evtConnect.postCount)
            await proxySocket.evtConnect.waitFor();

        await outboundApi.claimDongle.run(imei);

        debug("Dongle Successfully claimed");

    }

    function createAsteriskSocket(flowToken: string, proxySocket: sip.Socket): sip.Socket {

        debug(`${flowToken} Creating asterisk socket`);

        //let asteriskSocket = new sip.Socket(net.createConnection(5060, "127.0.0.1"));
        let asteriskSocket = new sip.Socket(net.createConnection(5060, localIp));

        asteriskSocket.disablePong = true;

        asteriskSocket.evtPing.attach(() => console.log("Asterisk ping!"));

        asteriskSockets.add(flowToken, asteriskSocket);

        /*
        asteriskSocket.evtPacket.attach(sipPacket =>
            console.log("From Asterisk:\n", sip.stringify(sipPacket).grey, "\n\n")
        );

        asteriskSocket.evtData.attach(chunk =>
            console.log("From Asterisk:\n", chunk.grey, "\n\n")
        );
        */

        asteriskSocket.evtPacket.attachPrepend(
            ({ headers }) => headers["content-type"] === "application/sdp",
            sipPacket => {

                let sdp = sip.parseSdp(sipPacket.content);

                sip.overwriteGlobalAndAudioAddrInSdpCandidates(sdp);

                sipPacket.content = sip.stringifySdp(sdp);

            }
        );


        asteriskSocket.evtRequest.attach(sipRequest => {

            let branch = proxySocket.addViaHeader(sipRequest, outbound.extraParamFlowToken(flowToken));

            proxySocket.shiftRouteAndAddRecordRoute(sipRequest, "semasim-inbound-proxy.invalid");

            if (sip.isPlainMessageRequest(sipRequest)) {
                let evtReceived = new VoidSyncEvent();
                evtOutgoingMessage.post({ sipRequest, evtReceived });
                proxySocket.evtResponse.attachOncePrepend(
                    ({ headers }) => headers.via[0].params["branch"] === branch,
                    () => evtReceived.post()
                )
            }

            proxySocket.write(sipRequest);

        });

        asteriskSocket.evtResponse.attach(sipResponse => {

            if (proxySocket.evtClose.postCount) return;

            proxySocket.rewriteRecordRoute(sipResponse, "semasim-inbound-proxy.invalid");

            sipResponse.headers.via.shift();

            proxySocket.write(sipResponse);

        });

        return asteriskSocket;
    }

}