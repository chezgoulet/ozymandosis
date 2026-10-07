package com.ozymandosis.game;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The LAN signaling endpoint, hosted by the phone itself: the same protocol as
 * server/signal.cjs (host, join, signal, kick; room "*" joins the only room), over
 * a minimal RFC 6455 WebSocket on an ephemeral port. It only introduces players;
 * the match runs over WebRTC directly between devices. No address is logged (D16).
 */
final class LanHost {
    private static final int MAX_FRAME = 4 * 1024 * 1024, MAX_PEERS = 5;
    private static final String LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private final ServerSocket server;
    private final Map<String, Room> rooms = new HashMap<>();
    private final List<Conn> conns = new ArrayList<>();
    private final SecureRandom random = new SecureRandom();
    private volatile boolean open = true;

    private static final class Room { String code; Conn host; final Map<Integer, Conn> peers = new LinkedHashMap<>(); int seq; }
    private final class Conn {
        final Socket socket; final OutputStream out; Room room; int id; String name = "";
        Conn(Socket s) throws IOException { socket = s; out = s.getOutputStream(); }
        synchronized void frame(int op, byte[] data) {
            try {
                int len = data.length;
                ByteArrayOutputStream b = new ByteArrayOutputStream(len + 10);
                b.write(0x80 | op);
                if (len < 126) b.write(len);
                else if (len < 65536) { b.write(126); b.write(len >>> 8); b.write(len & 255); }
                else { b.write(127); for (int i = 7; i >= 0; i--) b.write(i >= 4 ? 0 : (len >>> (8 * i)) & 255); }
                b.write(data);
                out.write(b.toByteArray()); out.flush();
            } catch (IOException e) { close(); }
        }
        void send(JSONObject o) { frame(1, o.toString().getBytes(StandardCharsets.UTF_8)); }
        void close() { try { socket.close(); } catch (IOException ignored) { } }
    }

    LanHost() throws IOException {
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(0)); // every interface: guests reach us on the Wi-Fi address
        Thread t = new Thread(this::acceptLoop, "ozy-lan-accept"); t.setDaemon(true); t.start();
        Thread beat = new Thread(this::heartbeat, "ozy-lan-beat"); beat.setDaemon(true); beat.start();
    }
    int port() { return server.getLocalPort(); }

    void close() {
        open = false;
        try { server.close(); } catch (IOException ignored) { }
        synchronized (this) { for (Conn c : new ArrayList<>(conns)) c.close(); conns.clear(); rooms.clear(); }
    }

    private void acceptLoop() {
        while (open) {
            try {
                Socket s = server.accept();
                s.setTcpNoDelay(true);
                Thread t = new Thread(() -> serve(s), "ozy-lan-conn"); t.setDaemon(true); t.start();
            } catch (IOException e) { if (!open) return; }
        }
    }
    private void heartbeat() {
        while (open) {
            try { Thread.sleep(25000); } catch (InterruptedException e) { return; }
            List<Conn> all; synchronized (this) { all = new ArrayList<>(conns); }
            for (Conn c : all) c.frame(9, new byte[0]);
        }
    }

    private void serve(Socket s) {
        Conn c = null;
        try {
            InputStream in = s.getInputStream();
            String key = handshake(in);
            if (key == null) { s.close(); return; }
            String accept = Base64.encodeToString(MessageDigest.getInstance("SHA-1").digest((key + GUID).getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP);
            c = new Conn(s);
            c.out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            c.out.flush();
            synchronized (this) { conns.add(c); }
            ByteArrayOutputStream msg = new ByteArrayOutputStream();
            while (open) {
                int b0 = in.read(), b1 = in.read();
                if (b0 < 0 || b1 < 0) break;
                boolean fin = (b0 & 0x80) != 0, masked = (b1 & 0x80) != 0; int op = b0 & 0x0f;
                long len = b1 & 0x7f;
                if (len == 126) len = (readN(in, 2));
                else if (len == 127) len = readN(in, 8);
                if (len > MAX_FRAME || len < 0) break;
                byte[] mask = masked ? readFully(in, 4) : null;
                byte[] payload = readFully(in, (int) len);
                if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
                if (op == 8) { c.frame(8, new byte[0]); break; }
                if (op == 9) { c.frame(10, payload); continue; }
                if (op == 10) continue;
                if (op == 0 || op == 1 || op == 2) {
                    msg.write(payload);
                    if (msg.size() > MAX_FRAME) break;
                    if (fin) { String text = msg.toString("UTF-8"); msg.reset(); onMessage(c, text); }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) { onClose(c); c.close(); } else try { s.close(); } catch (IOException ignored) { }
        }
    }

    // HTTP upgrade request: the path must be /ws; returns Sec-WebSocket-Key or null.
    private static String handshake(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int n = 0, x;
        while ((x = in.read()) >= 0) {
            b.write(x);
            n = (x == '\r' || x == '\n') ? n + 1 : 0;
            if (n == 4) break;
            if (b.size() > 8192) return null;
        }
        String[] lines = b.toString("ISO-8859-1").split("\r\n");
        if (lines.length == 0 || !lines[0].matches("GET /ws(\\?.*)? HTTP/1\\.1")) return null;
        String key = null; boolean upgrade = false;
        for (String l : lines) {
            int i = l.indexOf(':'); if (i < 0) continue;
            String k = l.substring(0, i).trim().toLowerCase(Locale.ROOT), v = l.substring(i + 1).trim();
            if (k.equals("sec-websocket-key")) key = v;
            if (k.equals("upgrade") && v.equalsIgnoreCase("websocket")) upgrade = true;
        }
        return upgrade ? key : null;
    }
    private static long readN(InputStream in, int n) throws IOException { long v = 0; for (byte b : readFully(in, n)) v = (v << 8) | (b & 0xff); return v; }
    private static byte[] readFully(InputStream in, int n) throws IOException {
        byte[] b = new byte[n]; int o = 0;
        while (o < n) { int r = in.read(b, o, n - o); if (r < 0) throw new IOException("closed"); o += r; }
        return b;
    }

    private String code() { String s; do { StringBuilder b = new StringBuilder(); for (int i = 0; i < 4; i++) b.append(LETTERS.charAt(random.nextInt(LETTERS.length()))); s = b.toString(); } while (rooms.containsKey(s)); return s; }
    private static JSONObject obj(Object... kv) { JSONObject o = new JSONObject(); try { for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]); } catch (Exception ignored) { } return o; }
    private static String clip(String s, int n) { return s.length() > n ? s.substring(0, n) : s; }

    private synchronized void onMessage(Conn c, String raw) {
        JSONObject m;
        try { m = new JSONObject(raw); } catch (Exception e) { return; }
        String op = m.optString("op");
        if (op.equals("host")) {
            if (c.room != null) return;
            Room r = new Room(); r.code = code(); r.host = c; rooms.put(r.code, r);
            c.room = r; c.id = 0; c.name = clip(m.optString("name", "Host"), 18);
            c.send(obj("op", "hosted", "room", r.code, "id", 0, "ice", new JSONArray()));
        } else if (op.equals("join")) {
            if (c.room != null) return;
            String want = m.optString("room", "").toUpperCase(Locale.ROOT);
            Room r = want.equals("*") ? (rooms.size() == 1 ? rooms.values().iterator().next() : null) : rooms.get(want);
            if (r == null) { c.send(obj("op", "error", "msg", want.equals("*") ? (rooms.isEmpty() ? "No game is open there yet." : "More than one game is open there. Enter its room code.") : "No room with that code.")); return; }
            if (r.peers.size() >= MAX_PEERS) { c.send(obj("op", "error", "msg", "Room is full.")); return; }
            c.room = r; c.id = ++r.seq; c.name = clip(m.optString("name", "Guest"), 18);
            r.peers.put(c.id, c);
            c.send(obj("op", "joined", "room", r.code, "id", c.id, "ice", new JSONArray(), "hostName", r.host.name));
            r.host.send(obj("op", "peer", "id", c.id, "name", c.name));
        } else if (op.equals("signal") && c.room != null && m.optJSONObject("data") != null) {
            Room r = c.room; int to = m.optInt("to", -1);
            Conn target = c == r.host ? r.peers.get(to) : (to == 0 ? r.host : null);
            if (target != null) target.send(obj("op", "signal", "from", c.id, "data", m.optJSONObject("data")));
        } else if (op.equals("kick") && c.room != null && c == c.room.host) {
            Conn p = c.room.peers.get(m.optInt("id", -1));
            if (p != null) { p.send(obj("op", "error", "msg", "Removed by host.")); p.close(); }
        }
    }
    private synchronized void onClose(Conn c) {
        conns.remove(c);
        Room r = c.room; if (r == null) return;
        c.room = null;
        if (r.host == c) {
            for (Conn p : r.peers.values()) { p.send(obj("op", "closed")); p.room = null; }
            rooms.remove(r.code);
        } else if (r.peers.get(c.id) == c) {
            r.peers.remove(c.id); r.host.send(obj("op", "left", "id", c.id));
        }
    }
}
