import * as webApi from "../../api";

export const data= {
        "title": "My SIMs",
        "table_panel_title": "My SIM cards",
        "table_rows": [
            { "title": "Number", "key": "sim_number" },
            { "title": "Operator", "key": "sim_service_provider" },
            { "title": "SIM ICCID", "key": "sim_iccid" },
            { "title": "Host Dongle's IMEI", "key": "dongle_imei" }
        ],
        "form_instructions": [
            "The SIM you want to add must be inserted inside a Huawei USB dongle connected to a Semasim Gateway.",
            "The Gateway must be up and connected to internet at the time you attempt the registration."
        ].join("\n"),
        "form_fields": {
            "imei": {
                "text": "Huawei USB Dongle's IMEI",
                "placeholder": "15 digits, printed on Dongle."
            },
            "last_four_digits_of_iccid": {
                "text": "Last four digits of SIM's ICCID",
                "placeholder": "4 digits, Printed on SIM"
            },
            "pin_first_try": {
                "text": "SIM card's PIN code",
                "placeholder": "e.g 0000"
            },
            "pin_second_try": {
                "text": "PIN code second try",
                "placeholder": "Not required, e.g. 1234"
            }
        },
        "form_title": "Add new SIM card",
        "success": "Success!",
        "wait": "Please wait...",
        "submit": "Submit"
};


export function buildData(
    email: string,
    userEndpoints: {
        dongle_imei: string;
        sim_iccid: string;
        sim_service_provider: string | null;
        sim_number: string | null;
    }[]
) {

    return { ...data, email, userEndpoints };

}