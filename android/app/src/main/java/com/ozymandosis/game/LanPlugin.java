package com.ozymandosis.game;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.nsd.DiscoveryRequest;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ext.SdkExtensions;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

/**
 * Local-network play for Android (js/net/lan.js). See D19 and docs/WORK-ORDER-FIRST-RELEASE.md §1.
 *
 * Android gates the local network from API 37 (and on 36 under the
 * RESTRICT_LOCAL_NETWORK compat change). This feature is exactly the gated set:
 * accepting incoming TCP, outgoing TCP, multicast, and .local names. So:
 *  - Hosting accepts connections, which always needs the permission: ACCESS_LOCAL_NETWORK
 *    on 37+, NEARBY_WIFI_DEVICES (neverForLocation) on 33–36. It is asked for at the
 *    moment of hosting, and a refusal is reported to the game, never a crash.
 *  - Joining by discovery on 37+ uses NsdManager's system picker (FLAG_SHOW_PICKER):
 *    the player chooses the device, the grant covers that device and persists across
 *    reboots, and the broad permission is never requested.
 *  - Joining by code (no discovery) connects to an address the picker never saw, so it
 *    asks for the same permission as hosting.
 * Revoking the permission in Settings restarts the app process (Android does that for
 * runtime permissions), so a revoked grant is simply asked for again next time.
 */
@CapacitorPlugin(
    name = "LanPlugin",
    permissions = {
        @Permission(alias = "localNetwork", strings = { "android.permission.ACCESS_LOCAL_NETWORK" }),
        @Permission(alias = "nearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES }),
    }
)
public class LanPlugin extends Plugin {
    private static final int API_LOCAL_NETWORK = 37;
    private LanHost host;
    private NsdManager.RegistrationListener registration;
    private WifiManager.MulticastLock lock;
    private final Handler main = new Handler(Looper.getMainLooper());

    private NsdManager nsd() { return (NsdManager) getContext().getSystemService(Context.NSD_SERVICE); }

    /** Which permission alias guards the local network on this device, or null if none does. */
    private static String alias() {
        if (Build.VERSION.SDK_INT >= API_LOCAL_NETWORK) return "localNetwork";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return "nearbyWifi";
        return null;
    }
    private boolean granted() { String a = alias(); return a == null || getPermissionState(a) == PermissionState.GRANTED; }

    // ── permission ───────────────────────────────────────────────
    /** Resolves {granted} after asking if needed (for hosting and joining by code). */
    @PluginMethod
    public void access(PluginCall call) {
        if (granted()) { call.resolve(new JSObject().put("granted", true)); return; }
        requestPermissionForAlias(alias(), call, "accessResult");
    }
    @PermissionCallback
    private void accessResult(PluginCall call) {
        boolean ok = granted();
        call.resolve(new JSObject().put("granted", ok).put("permanent", !ok && !shouldShowRationale()));
    }
    private boolean shouldShowRationale() {
        String a = alias(); if (a == null || getActivity() == null) return false;
        String perm = a.equals("localNetwork") ? "android.permission.ACCESS_LOCAL_NETWORK" : Manifest.permission.NEARBY_WIFI_DEVICES;
        return getActivity().shouldShowRequestPermissionRationale(perm);
    }
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // ── hosting ──────────────────────────────────────────────────
    @PluginMethod
    public void startHost(PluginCall call) {
        if (!granted()) { requestPermissionForAlias(alias(), call, "hostAfterPermission"); return; }
        doHost(call);
    }
    @PermissionCallback
    private void hostAfterPermission(PluginCall call) {
        if (!granted()) { call.reject("Local network permission denied", "denied"); return; }
        doHost(call);
    }
    private void doHost(PluginCall call) {
        stop();
        try {
            host = new LanHost();
        } catch (Exception e) {
            // on 37+ without the grant, binding or accepting is refused: say so, don't crash
            call.reject("Could not open a game on this network: " + e.getMessage(), e instanceof SecurityException ? "denied" : "failed");
            return;
        }
        final int port = host.port();
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(call.getString("name", "Ozymandosis"));
        info.setServiceType(call.getString("service", "_ozymandosis._tcp"));
        info.setPort(port);
        registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo s) { }
            @Override public void onRegistrationFailed(NsdServiceInfo s, int err) { } // the join code still works
            @Override public void onServiceUnregistered(NsdServiceInfo s) { }
            @Override public void onUnregistrationFailed(NsdServiceInfo s, int err) { }
        };
        try { nsd().registerService(info, NsdManager.PROTOCOL_DNS_SD, registration); }
        catch (RuntimeException e) { registration = null; } // advertising is the convenience; the code is the guarantee
        JSObject r = new JSObject();
        r.put("port", port);
        r.put("addrs", JSArray.from(localAddresses().toArray()));
        r.put("advertised", registration != null);
        call.resolve(r);
    }
    @PluginMethod
    public void stopHost(PluginCall call) { stop(); call.resolve(); }
    private void stop() {
        if (registration != null) { try { nsd().unregisterService(registration); } catch (RuntimeException ignored) { } registration = null; }
        if (host != null) { host.close(); host = null; }
    }
    @Override
    protected void handleOnDestroy() { stop(); releaseLock(); }

    /** Site-local IPv4 addresses of this device, Wi-Fi first (what a join code carries). */
    private static List<String> localAddresses() {
        List<String> wifi = new ArrayList<>(), other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                    (ni.getName().startsWith("wlan") ? wifi : other).add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        wifi.addAll(other);
        return wifi;
    }

    // ── discovery ────────────────────────────────────────────────
    @PluginMethod
    public void discover(PluginCall call) {
        String type = call.getString("service", "_ozymandosis._tcp");
        if (Build.VERSION.SDK_INT >= API_LOCAL_NETWORK) { pick(call, type); return; }
        // 36 and below: an ordinary search. Under the 36 compat restriction it needs the permission too.
        if (!granted()) { requestPermissionForAlias(alias(), call, "discoverAfterPermission"); return; }
        search(call, type, call.getInt("timeoutMs", 3000));
    }
    @PermissionCallback
    private void discoverAfterPermission(PluginCall call) {
        if (!granted()) { call.reject("Local network permission denied", "denied"); return; }
        search(call, call.getString("service", "_ozymandosis._tcp"), call.getInt("timeoutMs", 3000));
    }

    /** API 37+: the system picker. No ACCESS_LOCAL_NETWORK needed; the chosen device is granted. */
    @androidx.annotation.RequiresApi(API_LOCAL_NETWORK)
    private void pick(PluginCall call, String type) {
        final boolean[] done = { false };
        DiscoveryRequest req = new DiscoveryRequest.Builder(type).setFlags(DiscoveryRequest.FLAG_SHOW_PICKER).build();
        NsdManager.ServiceInfoCallback cb = new NsdManager.ServiceInfoCallback() {
            @Override public void onServiceInfoCallbackRegistrationFailed(int err) {
                if (done[0]) return; done[0] = true;
                call.reject("Could not search this network (error " + err + ")", err == NsdManager.FAILURE_PERMISSION_DENIED ? "denied" : "failed");
            }
            @Override public void onServiceUpdated(NsdServiceInfo s) {
                if (done[0]) return; done[0] = true;
                call.resolve(new JSObject().put("picker", true).put("services", JSArray.from(new Object[] { describe(s) })));
            }
            @Override public void onServiceLost() { }
            @Override public void onServiceInfoCallbackUnregistered() {
                if (done[0]) return; done[0] = true; // dismissed without choosing
                call.resolve(new JSObject().put("picker", true).put("cancelled", true).put("services", new JSArray()));
            }
        };
        try { nsd().registerServiceInfoCallback(req, main::post, cb); }
        catch (RuntimeException e) { if (!done[0]) { done[0] = true; call.reject("Could not search this network: " + e.getMessage(), "failed"); } }
    }

    /** API 36 and below: collect what answers within the timeout, resolving each. */
    private void search(PluginCall call, String type, int timeoutMs) {
        acquireLock();
        final NsdManager m = nsd();
        final Map<String, NsdServiceInfo> found = new LinkedHashMap<>();
        final NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int err) { }
            @Override public void onStopDiscoveryFailed(String t, int err) { }
            @Override public void onDiscoveryStarted(String t) { }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceFound(NsdServiceInfo s) { synchronized (found) { found.put(s.getServiceName(), s); } }
            @Override public void onServiceLost(NsdServiceInfo s) { synchronized (found) { found.remove(s.getServiceName()); } }
        };
        try { m.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener); }
        catch (RuntimeException e) { releaseLock(); call.reject("Could not search this network: " + e.getMessage(), "failed"); return; }
        main.postDelayed(() -> {
            try { m.stopServiceDiscovery(listener); } catch (RuntimeException ignored) { }
            List<NsdServiceInfo> list; synchronized (found) { list = new ArrayList<>(found.values()); }
            resolveAll(m, list, 0, new JSArray(), call);
        }, Math.min(10000, Math.max(1000, timeoutMs)));
    }
    // One resolution at a time (the pre-34 API refuses concurrent resolves).
    @SuppressWarnings("deprecation")
    private void resolveAll(NsdManager m, List<NsdServiceInfo> list, int i, JSArray out, PluginCall call) {
        if (i >= list.size()) { releaseLock(); call.resolve(new JSObject().put("picker", false).put("services", out)); return; }
        NsdManager.ResolveListener rl = new NsdManager.ResolveListener() {
            @Override public void onResolveFailed(NsdServiceInfo s, int err) { main.post(() -> resolveAll(m, list, i + 1, out, call)); }
            @Override public void onServiceResolved(NsdServiceInfo s) {
                if (host == null || s.getPort() != host.port()) out.put(describe(s)); // not our own game
                main.post(() -> resolveAll(m, list, i + 1, out, call));
            }
        };
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) m.resolveService(list.get(i), (Executor) main::post, rl);
            else m.resolveService(list.get(i), rl);
        } catch (RuntimeException e) { main.post(() -> resolveAll(m, list, i + 1, out, call)); }
    }
    @SuppressWarnings("deprecation")
    private static JSObject describe(NsdServiceInfo s) {
        List<String> addrs = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { for (InetAddress a : s.getHostAddresses()) addrs.add(a.getHostAddress()); }
        else if (s.getHost() != null) addrs.add(s.getHost().getHostAddress());
        return new JSObject().put("name", s.getServiceName()).put("port", s.getPort()).put("addrs", JSArray.from(addrs.toArray()));
    }

    // Before T extensions 7, mDNS on Wi-Fi needs a multicast lock (released after the search).
    private void acquireLock() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && SdkExtensions.getExtensionVersion(Build.VERSION_CODES.TIRAMISU) >= 7) return;
        WifiManager w = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (w == null || lock != null) return;
        lock = w.createMulticastLock("ozymandosis-lan"); lock.setReferenceCounted(false); lock.acquire();
    }
    private void releaseLock() { if (lock != null) { try { lock.release(); } catch (RuntimeException ignored) { } lock = null; } }
}
