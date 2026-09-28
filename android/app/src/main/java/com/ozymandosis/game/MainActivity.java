package com.ozymandosis.game;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // the score starts with the game, before the first touch
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
  }
}
