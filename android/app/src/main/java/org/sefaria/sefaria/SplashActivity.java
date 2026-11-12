package org.sefaria.sefaria;

import android.content.Intent;
import android.os.Bundle;
import android.net.Uri;
import androidx.appcompat.app.AppCompatActivity;

public class SplashActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // see https://github.com/facebook/react-native/issues/15992
        // for deep linking
        Uri data = null;
        String action = null;
        Intent currentIntent = getIntent();
        if (currentIntent != null) {
            Uri intentData = currentIntent.getData();
            if (intentData != null) {
                data = intentData;
            }
            // Get action as well.
            action = currentIntent.getAction();
        }

        // Launched from the app's icon (no link): open on the Home page, not the last book/tab
        // (owner, 2026-11-12). Only a launch through here is marked - coming back from the
        // recent-apps list resumes MainActivity directly and keeps the screen. The JS side
        // (DeepLinkRouter, APP_HOME_URL) opens Home; a cold start would go Home anyway.
        if (data == null && Intent.ACTION_MAIN.equals(action)) {
            data = Uri.parse("soferbooks://home");
            action = Intent.ACTION_VIEW;
        }

        Intent intent = new Intent(this, MainActivity.class);
        // Pass data and action (if available).
        if (data != null) {
            intent.setData(data);
        }
        if (action != null) {
            intent.setAction(action);
        }
        startActivity(intent);
        finish();
    }
}
