import Foundation
import Capacitor
import Network
import UIKit

// Local-network play for iOS (js/net/lan.js; D19; work order §1).
//
// Hosting: an NWListener on an ephemeral port speaking WebSocket, advertised over
// Bonjour as _ozymandosis._tcp, running the same signaling protocol as
// server/signal.cjs. Discovery: NWBrowser, then a short connection to each result
// to learn its address. iOS asks the player for Local Network access the first time
// either runs; that prompt only appears because Info.plist carries both
// NSBonjourServices and NSLocalNetworkUsageDescription (without the second, discovery
// fails silently: invisible in the simulator, obvious on a device). A refusal comes
// back as a policy-denied error, which is reported to the game as "denied".
// No address is ever logged (D16).
@objc(LanPlugin)
public class LanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LanPlugin"
    public let jsName = "LanPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "access", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]
    private let queue = DispatchQueue(label: "ozymandosis.lan")
    private var host: LanSignal?

    private static func denied(_ e: NWError) -> Bool {
        if case .dns(let code) = e { return code == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) }
        return false
    }

    // iOS has no way to ask ahead of time: the prompt appears on first use.
    @objc func access(_ call: CAPPluginCall) { call.resolve(["granted": true]) }
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } ; call.resolve() }
    }

    @objc func startHost(_ call: CAPPluginCall) {
        host?.stop(); host = nil
        let name = String((call.getString("name") ?? "Ozymandosis").prefix(40))
        let type = call.getString("service") ?? "_ozymandosis._tcp"
        do {
            let h = try LanSignal(queue: queue, name: name, type: type)
            host = h
            var answered = false
            h.onState = { [weak self] state in
                guard !answered else { return }
                switch state {
                case .ready:
                    answered = true
                    call.resolve(["port": Int(h.port), "addrs": LanPlugin.localAddresses(), "advertised": true])
                case .waiting(let e), .failed(let e):
                    answered = true
                    self?.host?.stop(); self?.host = nil
                    call.reject("Could not open a game on this network: \(e)", LanPlugin.denied(e) ? "denied" : "failed")
                default: break
                }
            }
            h.start()
        } catch {
            call.reject("Could not open a game on this network: \(error)", "failed")
        }
    }
    @objc func stopHost(_ call: CAPPluginCall) { host?.stop(); host = nil; call.resolve() }

    @objc func discover(_ call: CAPPluginCall) {
        let type = call.getString("service") ?? "_ozymandosis._tcp"
        let timeout = Double(min(10000, max(1000, call.getInt("timeoutMs") ?? 3000))) / 1000
        let browser = NWBrowser(for: .bonjour(type: type, domain: nil), using: .tcp)
        var results = Set<NWBrowser.Result>(), failed: NWError?
        browser.browseResultsChangedHandler = { r, _ in results = r }
        browser.stateUpdateHandler = { s in if case .waiting(let e) = s { failed = e } ; if case .failed(let e) = s { failed = e } }
        browser.start(queue: queue)
        queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
            browser.cancel()
            if let e = failed, results.isEmpty, LanPlugin.denied(e) { call.reject("Local network permission denied", "denied"); return }
            self?.resolve(Array(results), call: call)
        }
    }
    // A service is a name, not an address: connect briefly to learn where it is.
    private func resolve(_ results: [NWBrowser.Result], call: CAPPluginCall) {
        let group = DispatchGroup(), lock = NSLock()
        var out: [[String: Any]] = []
        for r in results {
            guard case .service(let name, _, _, _) = r.endpoint else { continue }
            group.enter()
            let conn = NWConnection(to: r.endpoint, using: .tcp)
            var done = false
            let finish = { (entry: [String: Any]?) in
                lock.lock(); defer { lock.unlock() }
                if done { return }; done = true
                if let e = entry, self.host == nil || (e["port"] as? Int) != Int(self.host!.port) { out.append(e) }
                conn.cancel(); group.leave()
            }
            conn.stateUpdateHandler = { s in
                switch s {
                case .ready:
                    if case .hostPort(let h, let p)? = conn.currentPath?.remoteEndpoint {
                        var ip = "\(h)"; if let pct = ip.firstIndex(of: "%") { ip = String(ip[..<pct]) }
                        finish(["name": name, "port": Int(p.rawValue), "addrs": [ip]])
                    } else { finish(nil) }
                case .failed, .cancelled: finish(nil)
                default: break
                }
            }
            conn.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 3) { finish(nil) }
        }
        group.notify(queue: queue) { call.resolve(["picker": false, "services": out]) }
    }

    static func localAddresses() -> [String] {
        var wifi: [String] = [], other: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
        defer { freeifaddrs(ifaddr) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard let sa = i.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET), (Int32(i.ifa_flags) & IFF_LOOPBACK) == 0, (Int32(i.ifa_flags) & IFF_UP) != 0 else { continue }
            var buf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &buf, socklen_t(buf.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: buf), name = String(cString: i.ifa_name)
                if name.hasPrefix("en0") { wifi.append(ip) } else { other.append(ip) }
            }
        }
        return wifi + other
    }
}

// The signaling endpoint: same protocol as server/signal.cjs.
final class LanSignal {
    private let listener: NWListener
    private let queue: DispatchQueue
    var onState: ((NWListener.State) -> Void)?
    var port: UInt16 { listener.port?.rawValue ?? 0 }

    private final class Conn { let c: NWConnection; var room: Room?; var id = 0; var name = ""; init(_ c: NWConnection) { self.c = c } }
    private final class Room { var code = ""; var host: Conn!; var peers: [Int: Conn] = [:]; var order: [Int] = []; var seq = 0 }
    private var rooms: [String: Room] = [:]
    private var conns: [ObjectIdentifier: Conn] = [:]

    init(queue: DispatchQueue, name: String, type: String) throws {
        self.queue = queue
        let params = NWParameters.tcp
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        ws.maximumMessageSize = 4 * 1024 * 1024
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        params.includePeerToPeer = false
        listener = try NWListener(using: params, on: .any)
        listener.service = NWListener.Service(name: name, type: type)
    }
    func start() {
        listener.stateUpdateHandler = { [weak self] s in self?.onState?(s) }
        listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
        listener.start(queue: queue)
    }
    func stop() {
        listener.cancel()
        for c in conns.values { c.c.cancel() }
        conns.removeAll(); rooms.removeAll()
    }

    private func accept(_ nw: NWConnection) {
        let c = Conn(nw); conns[ObjectIdentifier(c)] = c
        nw.stateUpdateHandler = { [weak self] s in
            switch s { case .failed, .cancelled: self?.closed(c); default: break }
        }
        nw.start(queue: queue)
        receive(c)
    }
    private func receive(_ c: Conn) {
        c.c.receiveMessage { [weak self] data, ctx, _, err in
            guard let self = self else { return }
            if err != nil { c.c.cancel(); return }
            if let meta = ctx?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata, meta.opcode == .close { c.c.cancel(); return }
            if let d = data, let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { self.message(c, m) }
            self.receive(c)
        }
    }
    private func send(_ c: Conn?, _ o: [String: Any]) {
        guard let c = c, let d = try? JSONSerialization.data(withJSONObject: o) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        c.c.send(content: d, contentContext: NWConnection.ContentContext(identifier: "m", metadata: [meta]), isComplete: true, completion: .contentProcessed { _ in })
    }
    private func code() -> String {
        let letters = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
        var s = ""; repeat { s = String((0..<4).map { _ in letters.randomElement()! }) } while rooms[s] != nil
        return s
    }
    private func message(_ c: Conn, _ m: [String: Any]) {
        switch m["op"] as? String {
        case "host":
            guard c.room == nil else { return }
            let r = Room(); r.code = code(); r.host = c; rooms[r.code] = r
            c.room = r; c.id = 0; c.name = String(((m["name"] as? String) ?? "Host").prefix(18))
            send(c, ["op": "hosted", "room": r.code, "id": 0, "ice": []])
        case "join":
            guard c.room == nil else { return }
            let want = ((m["room"] as? String) ?? "").uppercased()
            let r = want == "*" ? (rooms.count == 1 ? rooms.values.first : nil) : rooms[want]
            guard let room = r else { send(c, ["op": "error", "msg": want == "*" ? (rooms.isEmpty ? "No game is open there yet." : "More than one game is open there. Enter its room code.") : "No room with that code."]); return }
            guard room.peers.count < 5 else { send(c, ["op": "error", "msg": "Room is full."]); return }
            room.seq += 1; c.room = room; c.id = room.seq; c.name = String(((m["name"] as? String) ?? "Guest").prefix(18))
            room.peers[c.id] = c
            send(c, ["op": "joined", "room": room.code, "id": c.id, "ice": [], "hostName": room.host.name])
            send(room.host, ["op": "peer", "id": c.id, "name": c.name])
        case "signal":
            guard let room = c.room, let data = m["data"] as? [String: Any] else { return }
            let to = m["to"] as? Int ?? -1
            let target = c === room.host ? room.peers[to] : (to == 0 ? room.host : nil)
            send(target, ["op": "signal", "from": c.id, "data": data])
        case "kick":
            guard let room = c.room, c === room.host, let id = m["id"] as? Int, let p = room.peers[id] else { return }
            send(p, ["op": "error", "msg": "Removed by host."]); p.c.cancel()
        default: break
        }
    }
    private func closed(_ c: Conn) {
        conns.removeValue(forKey: ObjectIdentifier(c))
        guard let room = c.room else { return }
        c.room = nil
        if room.host === c {
            for p in room.peers.values { send(p, ["op": "closed"]); p.room = nil }
            rooms.removeValue(forKey: room.code)
        } else if room.peers[c.id] === c {
            room.peers.removeValue(forKey: c.id); send(room.host, ["op": "left", "id": c.id])
        }
    }
}
