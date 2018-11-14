"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const https = require("https");
const http = require("http");
const fs = require("fs");
const tls = require("tls");
const net = require("net");
const ws = require("ws");
//NOTE: Must be located before importing files that may use it.
exports.getLocalRunningInstance = () => runningInstance;
const deploy_1 = require("../deploy");
const dbSemasim = require("./dbSemasim");
const dbWebphone = require("./dbWebphone");
const dbTurn = require("./dbTurn");
const pushNotifications = require("./pushNotifications");
const logger = require("logger");
const backendConnections = require("./toBackend/connections");
const gatewayConnections = require("./toGateway/connections");
const uaConnections = require("./toUa/connections");
const loadBalancerConnection = require("./toLoadBalancer/connection");
const web = require("./web/launch");
const debug = logger.debugFactory();
function beforeExit() {
    return __awaiter(this, void 0, void 0, function* () {
        debug("BeforeExit...");
        yield dbSemasim.setAllSimOffline(gatewayConnections.getImsis());
        debug("BeforeExit completed in time");
    });
}
exports.beforeExit = beforeExit;
let runningInstance;
function launch(daemonNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        debug("Launch");
        const tlsCerts = (() => {
            const out = Object.assign({}, deploy_1.deploy.getDomainCertificatesPath());
            for (const key in out) {
                out[key] = fs.readFileSync(out[key]).toString("utf8");
            }
            return out;
        })();
        const interfaceAddress = deploy_1.networkTools.getInterfaceAddressInRange(deploy_1.deploy.semasimIpRange);
        const servers = [
            https.createServer(tlsCerts),
            http.createServer(),
            tls.createServer(tlsCerts),
            tls.createServer(tlsCerts),
            net.createServer()
        ];
        const [spoofedLocalAddressAndPort] = yield Promise.all([
            (() => __awaiter(this, void 0, void 0, function* () {
                /* CNAME www.[dev.]semasim.com => A [dev.]semasim.com => '<dynamic ip>' */
                const address1 = yield deploy_1.networkTools.heResolve4(`www.${deploy_1.deploy.getBaseDomain()}`);
                /* SRV _sips._tcp.[dev.]semasim.com => [ { name: 'sip.[dev.]semasim.com', port: 443 } ] */
                const [sipSrv] = yield deploy_1.networkTools.resolveSrv(`_sips._tcp.${deploy_1.deploy.getBaseDomain()}`);
                /* A _sips._tcp.[dev.]semasim.com => '<dynamic ip>' */
                const address2 = yield deploy_1.networkTools.heResolve4(sipSrv.name);
                const _wrap = (localAddress, localPort) => ({ localAddress, localPort });
                return {
                    "https": _wrap(address1, 443),
                    "http": _wrap(address1, 80),
                    "sipUa": _wrap(address2, sipSrv.port),
                    "sipGw": _wrap(address2, 80)
                };
            }))(),
            Promise.all(servers.map(server => new Promise(resolve => server
                .once("error", error => { throw error; })
                .listen(0, interfaceAddress)
                .once("listening", () => resolve(server))))),
            dbTurn.launch(),
            dbWebphone.launch(),
            dbSemasim.launch()
        ]);
        runningInstance = Object.assign({ interfaceAddress,
            daemonNumber }, (() => {
            const ports = servers.map(server => server.address().port);
            return {
                "httpsPort": ports[0],
                "httpPort": ports[1],
                "sipUaPort": ports[2],
                "sipGwPort": ports[3],
                "interInstancesPort": ports[4]
            };
        })());
        pushNotifications.launch();
        loadBalancerConnection.connect();
        web.launch(servers[0], servers[1]);
        uaConnections.listen(new ws.Server({ "server": servers[0] }), spoofedLocalAddressAndPort.https);
        uaConnections.listen(servers[2], spoofedLocalAddressAndPort.sipUa);
        gatewayConnections.listen(servers[3], spoofedLocalAddressAndPort.sipGw);
        backendConnections.listen(servers[4]);
        debug(`Instance ${daemonNumber} successfully launched`);
    });
}
exports.launch = launch;