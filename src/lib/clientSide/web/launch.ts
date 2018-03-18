import * as express from "express";
import * as forceDomain from "forcedomain";
import * as https from "https";
import * as http from "http";
import { handlers as apiHandlers } from "./apiHandlers";
import * as apiServer from "../../../tools/webApi";
import { webApiDeclaration } from "../../../semasim-frontend";
import * as sessionManager from "./sessionManager";
import * as dbWebphone from "./dbWebphone";
import * as frontend from "../../../semasim-frontend";

import * as logger from "morgan";

import * as c from "../../_constants";

export async function launch(
    httpsServer: https.Server,
    httpServer: http.Server
): Promise<void> {

    await Promise.all([
        sessionManager.launch(),
        dbWebphone.launch()
    ]);

    const hostname = `www.${c.shared.domain}`;

    (() => {

        let app = express();

        app.use(forceDomain({
            hostname,
            "port": 443,
            "protocol": "https"
        }));

        httpServer.on("request", app);

    })();

    let app = express();

    app.use(forceDomain({ "hostname": `www.${c.shared.domain}` }))

    apiServer.init({
        app,
        "apiPath": webApiDeclaration.apiPath,
        "handlers": apiHandlers,
        "isAuthenticated": async (req, res) => {

            await sessionManager.loadRequestSession(req, res);

            return !!sessionManager.getAuth(req.session!);

        },
        "onError": {
            "badRequest": req => {
                if( !!req.session ){

                    sessionManager.setAuth(req.session!, undefined);

                }
            }
        },
        "logger": apiServer.getDefaultLogger({
            "logOnlyErrors": false,
            "stringifyAuthentication": req=> {

                let auth= sessionManager.getAuth(req.session!);

                if( !!auth ){
                    return `user: ${auth.email}`;
                }else{
                    return "user not authenticated";
                }

            }
        })
    });

    app
        .use(express.static(frontend.pathToStatic))
        .get(/\.[a-zA-Z0-9]{1,8}$/, (req, res) => res.status(404).end())
        .use((req, res, next) => sessionManager.loadRequestSession(req, res).then(()=> next()))
        .use(logger("dev"))
        .get(["/login", "/register"], (req, res, next) => !!sessionManager.getAuth(req.session!) ? res.redirect("/") : next())
        .get("/login", (req, res) => res.send(frontend.pagesHtml.login))
        .get("/register", (req, res) => res.send(frontend.pagesHtml.register))
        .use((req, res, next) => !!sessionManager.getAuth(req.session!) ? next() : res.redirect("/login"))
        .get("/", (req, res) => res.redirect("/manager"))
        .get("/manager", (req, res) => res.send(frontend.pagesHtml.manager))
        .get("/webphone", (req, res) => res.send(frontend.pagesHtml.webphone))
        .use((req, res, next) => res.status(404).end())
        ;

    httpsServer.on("request", app);


}



