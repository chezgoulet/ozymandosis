package com.ozymandosis.game;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing for the Android subscription (work order §3; docs/MONETIZATION.md).
 *
 * The app only asks Play for prices and runs the purchase sheet. It never decides
 * that a player is subscribed: every purchase token goes to the play service
 * (POST /api/billing/play/verify), which checks it with the Play Developer API,
 * binds it to the account and acknowledges it. The account binding travels with
 * the purchase as obfuscatedAccountId, which the service issues.
 *
 * Play Console setup: one subscription product (ozymandosis_membership) with base
 * plans "monthly" ($2) and "annual" ($12). Prices shown come from Play.
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {
    private BillingClient client;
    private PluginCall pending;             // the purchase sheet currently open
    private final List<Runnable> waiting = new ArrayList<>();
    private boolean connecting;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchases)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }
    @Override
    protected void handleOnDestroy() { if (client != null) client.endConnection(); }

    private void ready(PluginCall call, Runnable then) {
        if (client.isReady()) { then.run(); return; }
        synchronized (waiting) { waiting.add(then); if (connecting) return; connecting = true; }
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                List<Runnable> run; synchronized (waiting) { connecting = false; run = new ArrayList<>(waiting); waiting.clear(); }
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) for (Runnable x : run) x.run();
                else call.reject("Google Play billing is not available: " + r.getDebugMessage(), "unavailable");
            }
            @Override public void onBillingServiceDisconnected() { synchronized (waiting) { connecting = false; } }
        });
    }

    private void details(String productId, PluginCall call, java.util.function.Consumer<ProductDetails> then) {
        QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(
            QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(BillingClient.ProductType.SUBS).build())).build();
        client.queryProductDetailsAsync(q, (r, result) -> {
            List<ProductDetails> list = result.getProductDetailsList();
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK || list == null || list.isEmpty()) { call.reject("The membership is not available in this store.", "unavailable"); return; }
            then.accept(list.get(0));
        });
    }

    /** Prices from Play, per base plan: [{plan: 'monthly', price: '$2.00', micros, currency, period}]. */
    @PluginMethod
    public void products(PluginCall call) {
        String productId = call.getString("productId", "ozymandosis_membership");
        ready(call, () -> details(productId, call, pd -> {
            JSArray plans = new JSArray();
            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
            if (offers != null) for (ProductDetails.SubscriptionOfferDetails o : offers) {
                if (o.getOfferId() != null) continue; // base plans only: no promotional offers
                List<ProductDetails.PricingPhase> phases = o.getPricingPhases().getPricingPhaseList();
                ProductDetails.PricingPhase p = phases.get(phases.size() - 1);
                plans.put(new JSObject().put("plan", o.getBasePlanId()).put("price", p.getFormattedPrice()).put("micros", p.getPriceAmountMicros())
                    .put("currency", p.getPriceCurrencyCode()).put("period", p.getBillingPeriod()));
            }
            call.resolve(new JSObject().put("plans", plans));
        }));
    }

    /** Open Play's purchase sheet. Resolves {purchaseToken} for the service to verify, or {cancelled}. */
    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId", "ozymandosis_membership"), plan = call.getString("plan", "monthly"), account = call.getString("obfuscatedAccountId");
        if (account == null || account.isEmpty()) { call.reject("Sign in first.", "signin"); return; }
        ready(call, () -> details(productId, call, pd -> {
            String offer = null;
            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
            if (offers != null) for (ProductDetails.SubscriptionOfferDetails o : offers) if (plan.equals(o.getBasePlanId()) && o.getOfferId() == null) offer = o.getOfferToken();
            if (offer == null) { call.reject("That plan is not offered in this store.", "unavailable"); return; }
            BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).setOfferToken(offer).build()))
                .setObfuscatedAccountId(account)
                .build();
            call.setKeepAlive(true);
            pending = call;
            BillingResult r = client.launchBillingFlow(getActivity(), params);
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) { pending = null; call.setKeepAlive(false); call.reject("Could not open Google Play: " + r.getDebugMessage(), "failed"); }
        }));
    }
    private void onPurchases(BillingResult r, List<Purchase> purchases) {
        PluginCall call = pending; pending = null;
        if (call == null) { if (purchases != null) notifyListeners("purchases", tokens(purchases)); return; } // e.g. a pending purchase completing later
        call.setKeepAlive(false);
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) { call.resolve(new JSObject().put("cancelled", true)); return; }
        if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) { call.resolve(new JSObject().put("owned", true)); return; }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) { call.reject("The purchase did not complete: " + r.getDebugMessage(), "failed"); return; }
        Purchase p = purchases.get(0);
        call.resolve(new JSObject().put("purchaseToken", p.getPurchaseToken()).put("pending", p.getPurchaseState() == Purchase.PurchaseState.PENDING));
    }

    /**
     * Proof that this copy was bought on Google Play (the $1 purchase, bound to the account):
     * a Play Integrity token for the service's nonce. The service decodes it with Google and
     * checks the app is Play-recognised and the Google account holds a licence.
     */
    @PluginMethod
    public void integrity(PluginCall call) {
        String nonce = call.getString("nonce");
        if (nonce == null || nonce.isEmpty()) { call.reject("No nonce", "failed"); return; }
        IntegrityTokenRequest.Builder b = IntegrityTokenRequest.builder().setNonce(nonce);
        Long project = call.getLong("cloudProjectNumber");
        if (project != null && project > 0) b.setCloudProjectNumber(project);
        IntegrityManagerFactory.create(getContext()).requestIntegrityToken(b.build())
            .addOnSuccessListener(r -> call.resolve(new JSObject().put("token", r.token())))
            .addOnFailureListener(e -> call.reject("Google Play could not check this copy: " + e.getMessage(), "failed"));
    }

    /** What Play says this Google account owns (after a reinstall): the service re-verifies each. */
    @PluginMethod
    public void restore(PluginCall call) {
        ready(call, () -> client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(), (r, purchases) -> {
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) { call.reject("Could not ask Google Play: " + r.getDebugMessage(), "failed"); return; }
            call.resolve(tokens(purchases));
        }));
    }
    private static JSObject tokens(List<Purchase> purchases) {
        JSArray out = new JSArray();
        for (Purchase p : purchases) if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) out.put(new JSObject().put("purchaseToken", p.getPurchaseToken()).put("acknowledged", p.isAcknowledged()));
        return new JSObject().put("purchases", out);
    }
}
