package com.ozymandosis.game;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(LanPlugin.class);   // local-network hosting and discovery (js/net/lan.js)
    registerPlugin(PlayBillingPlugin.class); // the Android subscription (js/net/online.js)
    super.onCreate(savedInstanceState);
    // the score starts with the game, before the first touch
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
  }
}
