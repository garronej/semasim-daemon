import { wd } from "../frontend";
import * as f from "../tools/mysqlCustom";
import { deploy } from "../deploy";
import * as assert from "assert";

/** exported only for tests */
export let query: f.Api["query"];
let esc: f.Api["esc"];
let buildInsertQuery: f.Api["buildInsertQuery"];


/** Must be called and awaited before use */
export function launch() {

    const api = f.createPoolAndGetApi({
        ...deploy.dbAuth.value,
        "database": "semasim_webphone",
    });

    query = api.query;
    esc = api.esc;
    buildInsertQuery = api.buildInsertQuery;

}

/** For test purpose only */
export async function flush() {
    await query("DELETE FROM instance");
}

function parseMessage(row: Record<string, f.TSql>): { message: wd.Message<"ENCRYPTED">; chat_id: number; } {

    //NOTE: Typescript fail to infer that message is always init.
    let message: wd.Message<"ENCRYPTED"> = null as any;

    const id_ = row["id_"] as number;
    const time = row["time"] as number;
    const text = { "encrypted_string": row["text_enc"] as string };
    const direction: wd.Message._Base<"ENCRYPTED">["direction"] =
        row["is_incoming"] === 1 ? "INCOMING" : "OUTGOING";

    switch (direction) {
        case "INCOMING": {

            const isNotification = row["incoming_is_notification"] === 1;

            if (isNotification) {

                const m: wd.Message.Incoming.Notification<"ENCRYPTED"> = {
                    id_, time, text, direction, isNotification
                };

                message = m;

            } else {

                const m: wd.Message.Incoming.Text<"ENCRYPTED"> = {
                    id_, time, text, direction, isNotification
                };

                message = m;

            }

        } break;
        case "OUTGOING": {

            const status: wd.Message.Outgoing._Base<"ENCRYPTED">["status"] = (() => {
                switch (row["outgoing_status_code"] as (0 | 1 | 2)) {
                    case 0: return "PENDING";
                    case 1: return "SEND REPORT RECEIVED";
                    case 2: return "STATUS REPORT RECEIVED";
                }
            })();

            switch (status) {
                case "PENDING": {

                    const m: wd.Message.Outgoing.Pending<"ENCRYPTED"> = {
                        id_, time, text, direction, status
                    };

                    message = m;

                } break;
                case "SEND REPORT RECEIVED": {

                    const m: wd.Message.Outgoing.SendReportReceived<"ENCRYPTED"> = {
                        id_, time, text, direction, status,
                        "isSentSuccessfully":
                            row["outgoing_is_sent_successfully"] === 1
                    };

                    message = m;


                } break;
                case "STATUS REPORT RECEIVED": {

                    const deliveredTime =
                        row["outgoing_delivered_time"] as number | null;

                    const email_enc =
                        row["outgoing_sent_by_email_enc"] as string | null;

                    if (email_enc === null) {

                        const m: wd.Message.Outgoing.StatusReportReceived.SentByUser<"ENCRYPTED"> = {
                            id_, time, text, direction, status,
                            deliveredTime,
                            "sentBy": { "who": "USER" }
                        };

                        message = m;

                    } else {

                        const m: wd.Message.Outgoing.StatusReportReceived.SentByOther<"ENCRYPTED"> = {
                            id_, time, text, direction, status,
                            deliveredTime,
                            "sentBy": { "who": "OTHER", "email": { "encrypted_string": email_enc } }
                        };

                        message = m;

                    }


                } break;
            }

        } break;
    }

    assert(!!message);

    return { message, "chat_id": row["chat"] as number };

}

export async function deleteAllUserInstance(
    user: number
): Promise<void> {

    const sql = `DELETE FROM instance WHERE user=${esc(user)};`;

    await query(sql, { user });

}

export async function getOrCreateInstance(
    user: number,
    imsi: string
): Promise<{ instance_id: number; chats: wd.Chat<"ENCRYPTED">[]; }> {

    const sql = [
        "SELECT @instance_ref:=NULL;",
        buildInsertQuery("instance", { user, imsi }, "IGNORE"),
        `SELECT @instance_ref:=id_ AS id_`,
        `FROM instance`,
        `WHERE user=${esc(user)} AND imsi=${esc(imsi)}`,
        `;`,
        `SELECT *`,
        `FROM chat`,
        `WHERE instance=@instance_ref`,
        `;`,
        `SELECT message.*`,
        `FROM message`,
        `INNER JOIN chat ON chat.id_=message.chat`,
        `WHERE chat.instance=@instance_ref`,
        `ORDER BY message.time DESC`,
        `LIMIT 20`
    ].join("\n");

    const resp = await query(sql, { user });

    const chatById = new Map<number, wd.Chat<"ENCRYPTED">>();

    for (const row of resp[3] as Record<string, f.TSql>[]) {

        const chat: wd.Chat<"ENCRYPTED"> = {
            "id_": row["id_"] as number,
            "contactNumber": { "encrypted_string": row["contact_number_enc"] as string },
            "contactName": { "encrypted_string": row["contact_name_enc"] as string },
            "contactIndexInSim": { "encrypted_number_or_null": row["contact_index_in_sim_enc"] as string },
            "messages": [],
            "idOfLastMessageSeen": row["last_message_seen"] as number | null
        };

        chatById.set(chat.id_, chat);

    }


    for (const row of resp[4]) {

        const { message, chat_id } = parseMessage(row);

        chatById.get(chat_id)!.messages.push(message);

    }

    const chats = Array.from(chatById.values());

    for (const chat of chats) {

        chat.messages.reverse();

    }

    return {
        "instance_id": resp[2][0]["id_"],
        chats
    };

}

export async function newChat(
    user: number,
    instance_id: number,
    contactNumber: wd.Encryptable["string"]["ENCRYPTED"],
    contactName: wd.Encryptable["string"]["ENCRYPTED"],
    contactIndexInSim: wd.Encryptable["number | null"]["ENCRYPTED"]
): Promise<{ chat_id: number; }> {


    const sql = [
        `SELECT _ASSERT( COUNT(*) , 'instance not found')`,
        `FROM instance`,
        `WHERE user= ${esc(user)} AND id_= ${esc(instance_id)}`,
        `;`,
        buildInsertQuery("chat", {
            "instance": instance_id,
            "contact_number_enc": contactNumber.encrypted_string,
            "contact_name_enc": contactName.encrypted_string,
            "contact_index_in_sim_enc": contactIndexInSim.encrypted_number_or_null,
            "last_message_seen": null
        }, "THROW ERROR")
    ].join("\n");


    const resp = await query(sql, { user, instance_id });

    return { "chat_id": resp.pop().insertId };

}

export async function fetchOlderMessages(
    user: number,
    chat_id: number,
    olderThanMessageId: number
): Promise<wd.Message<"ENCRYPTED">[]> {

    const sql = [
        `SELECT @older_than_time:=NULL`,
        `;`,
        `SELECT _ASSERT( COUNT(*), 'chat not found (fetchOlderMessages)')`,
        `FROM chat`,
        `INNER JOIN instance ON instance.id_=chat.instance`,
        `WHERE chat.id_=${esc(chat_id)} AND instance.user=${esc(user)}`,
        `;`,
        `SELECT @older_than_time:=time`,
        `FROM message`,
        `WHERE id_=${esc(olderThanMessageId)}`,
        `;`,
        `SELECT _ASSERT(@older_than_time IS NOT NULL, 'Message older than !exist')`,
        `;`,
        `SELECT *`,
        `FROM message`,
        `WHERE chat=${esc(chat_id)} AND time < @older_than_time`,
        `ORDER BY message.time DESC`,
        `LIMIT 100`
    ].join("\n");

    const resp = await query(sql, { user, chat_id });

    return resp
        .pop()
        .map(row => parseMessage(row).message)
        .reverse()
        ;

}

export async function updateChat(
    user: number,
    chat_id: number,
    contactIndexInSim: wd.Encryptable["number | null"]["ENCRYPTED"] | undefined,
    contactName: wd.Encryptable["string"]["ENCRYPTED"] | undefined,
    idOfLastMessageSeen: number | null | undefined
): Promise<void> {

    const fields: { [key: string]: f.TSql } = { "id_": chat_id };

    if (contactIndexInSim !== undefined) {
        fields["contact_index_in_sim_enc"] = contactIndexInSim.encrypted_number_or_null;
    }

    if (contactName !== undefined) {
        fields["contact_name_enc"] = contactName.encrypted_string;
    }

    if (idOfLastMessageSeen !== undefined) {
        fields["last_message_seen"] = idOfLastMessageSeen;
    }

    const sql = [
        `SELECT _ASSERT( COUNT(*), 'chat not found (updateChat)')`,
        `FROM chat`,
        `INNER JOIN instance ON instance.id_=chat.instance`,
        `WHERE chat.id_=${esc(chat_id)} AND instance.user=${esc(user)}`,
        `;`,
        buildInsertQuery("chat", fields, "UPDATE")
    ].join("\n");

    await query(sql, { user, chat_id });

    return;

}

export async function destroyChat(
    user: number,
    chat_id: number
): Promise<undefined> {

    const sql = [
        `SELECT _ASSERT( COUNT(*), 'chat not found (destroy chat)')`,
        `FROM chat`,
        `INNER JOIN instance ON instance.id_=chat.instance`,
        `WHERE chat.id_=${esc(chat_id)} AND instance.user=${esc(user)}`,
        `;`,
        `DELETE FROM chat WHERE id_= ${esc(chat_id)}`
    ].join("\n");

    await query(sql, { user, chat_id });

    return;

}

//TODO: Wrap assert user own chat in a template.
export async function newMessage(
    user: number,
    chat_id: number,
    message: wd.NoId<
        wd.Message.Incoming<"ENCRYPTED"> |
        wd.Message.Outgoing.Pending<"ENCRYPTED"> |
        wd.Message.Outgoing.StatusReportReceived<"ENCRYPTED">
    >
): Promise<{ message_id: number; }> {

    const m: wd.Message<"ENCRYPTED"> = { ...message, "id_": NaN } as any;

    let is_incoming: 0 | 1;
    let incoming_is_notification: 0 | 1 | null = null;
    let outgoing_status_code: 0 | 1 | 2 | null = null;
    let outgoing_is_sent_successfully: 0 | 1 | null = null;
    let outgoing_delivered_time: number | null = null;
    let outgoing_sent_by_email_enc: string | null = null;

    if (m.direction === "INCOMING") {

        is_incoming = f.bool.enc(true);
        incoming_is_notification = f.bool.enc(m.isNotification);

    } else {

        is_incoming = f.bool.enc(false);

        switch (m.status) {
            case "PENDING":
                outgoing_status_code = 0;
                break;
            case "SEND REPORT RECEIVED":
                outgoing_status_code = 1;
                outgoing_is_sent_successfully =
                    f.bool.enc(m.isSentSuccessfully);
                break;
            case "STATUS REPORT RECEIVED":
                outgoing_status_code = 2;
                outgoing_delivered_time = m.deliveredTime;
                if (m.sentBy.who === "OTHER") {
                    outgoing_sent_by_email_enc = m.sentBy.email.encrypted_string;
                }
                break;
        }

    }

    const sql = [
        `SELECT _ASSERT( COUNT(*), 'chat not found (newMessage)')`,
        `FROM chat`,
        `INNER JOIN instance ON instance.id_=chat.instance`,
        `WHERE chat.id_=${esc(chat_id)} AND instance.user=${esc(user)}`,
        `;`,
        buildInsertQuery("message", {
            "chat": chat_id,
            "time": message.time,
            "text_enc": message.text.encrypted_string,
            is_incoming,
            incoming_is_notification,
            outgoing_status_code,
            outgoing_is_sent_successfully,
            outgoing_delivered_time,
            outgoing_sent_by_email_enc
        }, "THROW ERROR")
    ].join("\n");

    const resp = await query(sql, { user, chat_id });

    return { "message_id": resp.pop().insertId };

}

export async function updateMessageOnSendReport(
    user: number,
    message_id: number,
    isSentSuccessfully: boolean
): Promise<void> {

    const sql = [
        `SELECT _ASSERT( COUNT(*), 'Message not found')`,
        `FROM message`,
        `INNER JOIN chat ON chat.id_=message.chat`,
        `INNER JOIN instance ON instance.id_=chat.instance`,
        `WHERE ` + [
            `instance.user=${esc(user)}`,
            `message.id_=${esc(message_id)}`,
            `message.outgoing_status_code=0`
        ].join(" AND "),
        `;`,
        buildInsertQuery("message", {
            "id_": message_id,
            "outgoing_status_code": 1,
            "outgoing_is_sent_successfully": isSentSuccessfully ? 1 : 0
        }, "UPDATE")
    ].join("\n");

    await query(sql, { user, message_id });

}

export async function updateMessageOnStatusReport(
    user: number,
    message_id: number,
    deliveredTime: number | null
): Promise<void> {

    const sql = [
        `SELECT _ASSERT( COUNT(*), 'Message not found')`,
        `FROM message`,
        `INNER JOIN chat ON chat.id_=message.chat`,
        `INNER JOIN instance ON instance.id_=chat.instance`,
        `WHERE ` + [
            `instance.user=${esc(user)}`,
            `message.id_=${esc(message_id)}`,
            `message.outgoing_status_code=1`
        ].join(" AND "),
        `;`,
        buildInsertQuery("message", {
            "id_": message_id,
            "outgoing_status_code": 2,
            "outgoing_delivered_time": deliveredTime
        }, "UPDATE")
    ].join("\n");

    await query(sql, { user, message_id });

}
