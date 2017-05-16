"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
var pjsip = require("../pjsip");
//import { diagnostics } from "./diagnostics";
exports.gain = "4000";
//TODO: Read from config file
exports.context = "from-dongle";
exports.outboundExt = "outbound";
exports.jitterBuffer = {
    type: "fixed",
    params: "2500,10000"
};
function call(channel) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log("... FROM DONGLE CALL");
                    _a = channel.request.extension;
                    switch (_a) {
                        case exports.outboundExt: return [3 /*break*/, 1];
                    }
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, call.outbound(channel)];
                case 2:
                    _b.sent();
                    return [3 /*break*/, 5];
                case 3: return [4 /*yield*/, call.inbound(channel)];
                case 4:
                    _b.sent();
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
exports.call = call;
(function (call) {
    function inbound(channel) {
        return __awaiter(this, void 0, void 0, function () {
            var _, imei, contactsToDial_, contactsToDial;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("... INBOUND !");
                        _ = channel.relax;
                        return [4 /*yield*/, _.getVariable("DONGLEIMEI")];
                    case 1:
                        imei = (_a.sent());
                        console.log({ imei: imei });
                        return [4 /*yield*/, _.getVariable("PJSIP_DIAL_CONTACTS(" + imei + ")")];
                    case 2:
                        contactsToDial_ = _a.sent();
                        console.log({ contactsToDial_: contactsToDial_ });
                        return [4 /*yield*/, pjsip.getAvailableContactsOfEndpoint(imei)];
                    case 3:
                        contactsToDial = (_a.sent()).map(function (contact) { return "PJSIP/" + contact; }).join("&");
                        if (!contactsToDial) {
                            console.log("No contact to dial!");
                            return [2 /*return*/];
                        }
                        console.log({ contactsToDial: contactsToDial });
                        return [4 /*yield*/, _.exec("Dial", [contactsToDial, "", "b(" + exports.context + "^" + exports.outboundExt + "^" + 1 + ")"])];
                    case 4:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    }
    call.inbound = inbound;
    function outbound(channel) {
        return __awaiter(this, void 0, void 0, function () {
            var _;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _ = channel.relax;
                        console.log("OUTBOUND !");
                        return [4 /*yield*/, _.setVariable("JITTERBUFFER(" + exports.jitterBuffer.type + ")", exports.jitterBuffer.params)];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, _.setVariable("AGC(rx)", exports.gain)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    }
    call.outbound = outbound;
})(call = exports.call || (exports.call = {}));
//# sourceMappingURL=call.js.map