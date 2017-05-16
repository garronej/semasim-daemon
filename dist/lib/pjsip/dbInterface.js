"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [0, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _this = this;
Object.defineProperty(exports, "__esModule", { value: true });
var ts_exec_queue_1 = require("ts-exec-queue");
var mysql = require("mysql");
exports.callContext = "from-sip-call";
exports.messageContext = "from-sip-message";
var dbParams = {
    "host": "127.0.0.1",
    "user": "root",
    "password": "abcde12345"
};
var connection = mysql.createConnection(__assign({}, dbParams, { "database": "asterisk", "multipleStatements": true }));
function query(sql, values) {
    return new Promise(function (resolve, reject) {
        var r = connection.query(sql, values || [], function (err, results) { return err ? reject(err) : resolve(results); });
        //console.log(r.sql);
    });
}
var authId = "semasim-default-auth";
var isDbInit = false;
function initDb() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, query([
                        "INSERT INTO `ps_auths`",
                        "(`id`, `auth_type`, `username`, `password`) VALUES (?, ?, ?, ?)",
                        "ON DUPLICATE KEY UPDATE",
                        "`auth_type`= VALUES(`auth_type`), `username`= VALUES(`username`), `password`= VALUES(`password`)"
                    ].join("\n"), [
                        authId, "userpass", "admin", "admin"
                    ])];
                case 1:
                    _a.sent();
                    isDbInit = true;
                    return [2 /*return*/];
            }
        });
    });
}
var dbWriteCluster = {};
exports.addEndpoint = ts_exec_queue_1.execQueue(dbWriteCluster, "DB_WRITE", function (imei, callback) { return __awaiter(_this, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log("addEndpoint", imei);
                if (!!isDbInit) return [3 /*break*/, 2];
                return [4 /*yield*/, initDb()];
            case 1:
                _a.sent();
                _a.label = 2;
            case 2: return [4 /*yield*/, query([
                    "INSERT INTO `ps_aors`",
                    "(`id`,`max_contacts`,`qualify_frequency`) VALUES (?, ?, ?)",
                    "ON DUPLICATE KEY UPDATE",
                    "`max_contacts`= VALUES(`max_contacts`),",
                    "`qualify_frequency`= VALUES(`qualify_frequency`)",
                    ";",
                    "INSERT INTO `ps_endpoints`",
                    "(`id`,`disallow`,`allow`,`context`,`message_context`, `aors`, `auth`, `force_rport`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    "ON DUPLICATE KEY UPDATE",
                    "`disallow`= VALUES(`disallow`),",
                    "`allow`= VALUES(`allow`),",
                    "`context`= VALUES(`context`),",
                    "`message_context`= VALUES(`message_context`),",
                    "`aors`= VALUES(`aors`),",
                    "`auth`= VALUES(`auth`)"
                ].join("\n"), [
                    imei, 12, 5,
                    imei, "all", "alaw,ulaw", exports.callContext, exports.messageContext, imei, authId, "no"
                ])];
            case 3:
                _a.sent();
                callback();
                return [2 /*return*/];
        }
    });
}); });
//# sourceMappingURL=dbInterface.js.map