package house.fmwax.tv;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import android.util.Log;
import android.widget.FrameLayout;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.URLEncoder;
import java.util.ArrayList;

// THE FMWAX TV APP: the house's TV page in a full-screen WebView.
//
// The page's address (with the house's key in it) is never in this app's
// code: the first start asks for it once (pasted with the Google TV phone
// app's keyboard) and keeps it in the app's own settings, which never leave
// the TV (no backup, no copy to a new TV: the manifest). To ask again: hold
// Back (Guide until MC-48, when Guide held became Talk's hold). (Until 2026-11-19 it could also come by an intent; Codex: any app on
// the TV could then point it at another site, so no longer.)
//
// A DOWNLOAD SINCE v1.6 (2026-11-19): the author's build is attached to the
// public repository's releases; README.md here says how to build your own.
//
// THE RECEIVER (Denon.java) is the one thing an intent may set, a private
// address only:
//   adb shell am start -n house.fmwax.tv/.Main -e denon 192.168.x.y
// and "-e denon none" forgets it.
//
// VOICE: Guide listens through the TV's own speech recognition (Google's),
// and the words go to the page's …/tv/say?q=<words>, the same door TV Bro's
// voice search used (mcp/tvsay.js), so the house does the rest.
public class Main extends Activity {
    private static final int VOICE = 1, TALK_MIC = 2;
    private SharedPreferences prefs;
    private WebView web;
    private String page;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("fmwax", MODE_PRIVATE);
        takeDenon(getIntent());
        page = prefs.getString("page", null);
        if (page == null) askForPage(); else openPage(saved);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeDenon(intent);
    }

    private Denon denon;
    private void takeDenon(Intent intent) {
        String d = intent == null ? null : intent.getStringExtra("denon");
        if ("none".equals(d)) prefs.edit().remove("denon").apply();
        else if (d != null && Denon.ok(d.trim())) prefs.edit().putString("denon", d.trim()).apply();
        String h = prefs.getString("denon", null);
        // Every start of the app comes here (the fmwax button's too): the same
        // receiver keeps its one line (Codex: a new one each time was a thread
        // never ended); a changed one is put back and its line ended.
        if (denon != null && denon.host.equals(h)) return;
        if (denon != null) { denon.back(); denon.close(); }
        denon = h == null ? null : new Denon(h);
    }

    // The house's own origin (scheme, host and port) and nothing else.
    private boolean ours(Uri u) {
        if (u == null || page == null) return false;
        Uri p = Uri.parse(page);
        return "https".equals(u.getScheme()) && "https".equals(p.getScheme())
            && p.getHost() != null && p.getHost().equalsIgnoreCase(u.getHost())
            && port(p) == port(u);
    }
    private static int port(Uri u) { return u.getPort() == -1 ? 443 : u.getPort(); }

    // What the house's Talk page tells the app (programs.js soundTo): a line
    // opened or closed. Read only on the house's own page.
    private final class Bridge {
        @JavascriptInterface
        public boolean sound() { return denon != null; }
        @JavascriptInterface
        public void talk(final boolean on) {
            runOnUiThread(new Runnable() { public void run() {
                if (web == null || denon == null || !ours(Uri.parse(String.valueOf(web.getUrl())))) return;
                if (on) denon.toTv(); else denon.back();
            } });
        }
        // GUIDE HELD TO TALK (MC-48): the house's Talk page on the TV says it
        // takes Guide; until the next page starts, Guide down and up go to it.
        @JavascriptInterface
        public void talkKeys(final boolean on) {
            runOnUiThread(new Runnable() { public void run() {
                // Codex: only the TV's Talk screen itself (…/tv/talk), not any page of the house.
                Uri u = web == null ? null : Uri.parse(String.valueOf(web.getUrl()));
                guideTalks = on && ours(u) && u.getPath() != null && u.getPath().endsWith("/tv/talk");
            } });
        }
    }
    private boolean guideTalks, backHeld, guideDown;
    private TextView waiting;
    private String failed;
    private int tries;
    private void showWaiting(boolean on) { if (waiting != null) waiting.setVisibility(on ? View.VISIBLE : View.GONE); }

    // The TV's Talk screen, in the room the page shows (a house without Talk
    // sends it back to the TV page).
    private void openTalk() {
        Uri now = Uri.parse(String.valueOf(web.getUrl()));
        String room = ours(now) ? now.getQueryParameter("room") : null;
        web.loadUrl(page + "/talk" + (room != null && room.matches("[a-z0-9-]{1,60}") ? "?room=" + room : ""));
    }

    // Codex: a key-up that never comes (the app off the screen, the window's
    // focus lost, a page starting) must not leave Talk's microphone open.
    private void letGoOfGuide() {
        if (!guideDown) return;
        guideDown = false;
        if (web != null) web.evaluateJavascript("window.fmwaxGuide && window.fmwaxGuide(false)", null);
    }
    @Override
    protected void onPause() {
        letGoOfGuide();
        super.onPause();
    }
    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (!has) letGoOfGuide();
    }

    // The app off the screen (Back out, Home, standby): a line can't still be
    // heard, so the receiver goes back (Codex: a page's own end may never come).
    // Codex, before the download (2026-11-19): nothing may listen off the
    // screen. Guide's listening is cancelled, and the WebView is told it is
    // hidden, so the page sees itself hidden and Talk hangs up as it does on a
    // phone put away (talkScript's visibilitychange; once the desk has
    // finished, if it was busy). Back on the screen with the line still open,
    // the page itself asks for TV again; the app keeps no "talking" of its
    // own across the gap (Codex: a stale one switched the receiver for no call).
    @Override
    protected void onStop() {
        super.onStop();
        if (ear != null) ear.cancel();
        if (band != null) band.setVisibility(View.GONE);
        if (web != null) web.onPause();
        if (denon != null) denon.back();
    }
    @Override
    protected void onStart() {
        super.onStart();
        if (web != null) web.onResume();
    }

    // Any address of the house's TV page, or of its voice door, made the
    // page's own: https://host/buttons/<key>/tv
    static String tvPage(String s) {
        if (s == null) return null;
        s = s.trim();
        int i = s.indexOf("/tv");
        if (!s.startsWith("https://") || !s.contains("/buttons/") || i < 0) return null;
        return s.substring(0, i + 3);
    }

    private void openPage(Bundle saved) {
        CookieManager.getInstance().setAcceptCookie(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#131417"));
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        // The house's pages need neither the TV's files nor other apps' (the
        // download, 2026-11-19: off, not left to the defaults).
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        String v = "1";
        try { v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { }
        ws.setUserAgentString(ws.getUserAgentString() + " fmwaxTV/" + v); // About fmwax names it
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                // The house's own pages only (Codex: the bridge and the
                // microphone are for them); anything else is not opened.
                return !ours(Uri.parse(url));
            }
            // NOT REACHED (2026-11-19, the owner: the fmwax button showed an
            // Android icon and nothing else): woken from standby, the TV's
            // Wi-Fi was not back yet (net::ERR_NAME_NOT_RESOLVED), and the
            // WebView's own error page stayed, the house's address on it. Now
            // a plain screen says so and the page is asked again, sooner at
            // first: 2, 4, 6 ... seconds, at most 30.
            @Override
            public void onReceivedError(WebView v, android.webkit.WebResourceRequest req, android.webkit.WebResourceError err) {
                if (!req.isForMainFrame()) return;
                failed = req.getUrl().toString();
                tries++;
                Log.i("fmwaxTV", "page not reached (" + err.getDescription() + "), try " + tries);
                showWaiting(true);
                retryLater.postDelayed(new Runnable() { public void run() {
                    if (failed != null && web != null) { String u = failed; failed = null; web.loadUrl(u); }
                } }, Math.min(30000, 2000L * tries));
            }
            @Override
            public void onPageFinished(WebView v, String url) {
                if (failed == null) { tries = 0; showWaiting(false); }
            }
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                letGoOfGuide();
                guideTalks = false; // a page takes Guide only by saying so again
            }
        });
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        band = new TextView(this);
        band.setTextColor(Color.parseColor("#131417"));
        band.setBackgroundColor(Color.parseColor("#F2B63A"));
        band.setTextSize(26);
        band.setPadding(48, 20, 48, 20);
        band.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = 60;
        root.addView(band, lp);
        waiting = new TextView(this);
        waiting.setText("fmwax\n\nCan't reach the house yet. Trying again…");
        waiting.setTextColor(Color.parseColor("#E9E8E3"));
        waiting.setTextSize(28);
        waiting.setGravity(Gravity.CENTER);
        waiting.setBackgroundColor(Color.parseColor("#131417"));
        waiting.setVisibility(View.GONE);
        root.addView(waiting, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // THE MICROPHONE FOR A PAGE (2026-11-19, Talk on the TV): the house's
        // own origin may have the TV's microphone, nothing else and no other
        // site. (The TV's own microphone switch must be on, and the TV
        // restarted once after: measured, the driver read nothing before.)
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                boolean audio = java.util.Arrays.asList(req.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                if (!audio || !ours(req.getOrigin())) { req.deny(); return; }
                // A TV that never pressed Guide (a new install opening Talk
                // first) has not given the app the microphone yet: Android
                // asks, then the page has it or not.
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { grantMic(req); return; }
                if (micAsked != null) micAsked.deny();
                micAsked = req;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, TALK_MIC);
            }
            @Override
            public void onPermissionRequestCanceled(PermissionRequest req) {
                if (req == micAsked) micAsked = null;
            }
        });
        web.addJavascriptInterface(new Bridge(), "fmwaxTV");
        setContentView(root);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(page);
        web.requestFocus();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        // GUIDE (MC-48): on the Talk page, held = the hold (measured
        // 2026-11-19: the remote sends one down and one up, Android repeats
        // between them, dropped here); anywhere else a short press is the
        // quick command (listen), and a long one does nothing.
        if (k == KeyEvent.KEYCODE_GUIDE) {
            if (web != null && guideTalks) {
                if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                    guideDown = true;
                    web.evaluateJavascript("window.fmwaxGuide && window.fmwaxGuide(true)", null);
                } else if (e.getAction() == KeyEvent.ACTION_UP) letGoOfGuide();
                return true;
            }
            // HELD about a second anywhere else: the Talk screen (the owner,
            // 2026-11-19: "Yes build that"); hold Guide again there to speak.
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 10 && web != null) { openTalk(); return true; }
            if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled() && web != null && e.getEventTime() - e.getDownTime() < 800) listen();
            return true;
        }
        // BACK: a page back, or out of the app on the first page; held ~1 s it
        // asks for the address again (Guide held did until MC-48).
        // A short Back asks the page first (window.fmwaxBack: the TV page
        // closes an open view, the owner 2026-11-19), then the page before,
        // then out of the app as Android does.
        if (k == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 20) { backHeld = true; askForPage(); return true; }
            if (backHeld) { if (e.getAction() == KeyEvent.ACTION_UP) backHeld = false; return true; }
            if (web != null) {
                if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled()) {
                    web.evaluateJavascript("(function(){try{return !!(window.fmwaxBack&&window.fmwaxBack());}catch(x){return false;}})()",
                        new android.webkit.ValueCallback<String>() { public void onReceiveValue(String v) {
                            if ("true".equals(v)) return;
                            if (web != null && web.canGoBack()) web.goBack(); else onBackPressed();
                        } });
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(e);
    }

    // VOICE IN THE APP (2026-11-18): Google's voice screen (RecognizerIntent)
    // heard the words on this TV but never handed them back and stayed on
    // top, so the app listens itself through the TV's recognition service,
    // as TV Bro's voice search does, and shows what it hears at the foot.
    private SpeechRecognizer ear;
    private TextView band;
    private final Handler later = new Handler(Looper.getMainLooper());
    private final Handler retryLater = new Handler(Looper.getMainLooper()); // its own: say() clears `later`

    private void say(String words, long hideAfter) {
        if (band == null) return;
        later.removeCallbacksAndMessages(null);
        band.setText(words);
        band.setVisibility(View.VISIBLE);
        if (hideAfter > 0) later.postDelayed(new Runnable() { public void run() { band.setVisibility(View.GONE); } }, hideAfter);
    }

    private void listen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, VOICE);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { say("This TV has no voice input", 3000); return; }
        if (ear != null) ear.destroy();
        ear = SpeechRecognizer.createSpeechRecognizer(this);
        ear.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle b) { say("Listening…", 0); }
            public void onBeginningOfSpeech() { }
            public void onRmsChanged(float db) { }
            public void onBufferReceived(byte[] buf) { }
            public void onEndOfSpeech() { }
            public void onError(int code) {
                Log.i("fmwaxTV", "voice error " + code);
                say(code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    ? "Didn't catch that. Press Guide and try again." : "Voice didn't work (" + code + ")", 3500);
            }
            public void onPartialResults(Bundle b) {
                ArrayList<String> p = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (p != null && !p.isEmpty() && !p.get(0).trim().isEmpty()) say(p.get(0), 0);
            }
            public void onEvent(int t, Bundle b) { }
            public void onResults(Bundle b) {
                ArrayList<String> heard = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                Log.i("fmwaxTV", "heard " + (heard == null ? 0 : heard.size()) + " reading(s)"); // never the words
                if (heard == null || heard.isEmpty() || heard.get(0).trim().isEmpty()) { say("Didn't catch that. Press Guide and try again.", 3500); return; }
                say("“" + heard.get(0).trim() + "”", 2500);
                try {
                    String q = URLEncoder.encode(heard.get(0).trim(), "UTF-8").replace("+", "%20");
                    if (web != null) web.loadUrl(page + "/say?q=" + q);
                } catch (Exception ignored) { }
            }
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        say("Listening…", 0);
        ear.startListening(i);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] got) {
        boolean yes = got.length > 0 && got[0] == PackageManager.PERMISSION_GRANTED;
        if (req == VOICE && yes) listen();
        if (req == TALK_MIC && micAsked != null) {
            PermissionRequest r = micAsked;
            micAsked = null;
            if (yes) grantMic(r); else r.deny();
        }
    }

    // The page's microphone, asked for by the house's own page (checked
    // before) once the app has the TV's.
    private PermissionRequest micAsked;
    private void grantMic(PermissionRequest req) {
        req.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
    }

    @Override
    protected void onDestroy() {
        if (ear != null) ear.destroy();
        super.onDestroy();
    }

    // The one setup screen: paste the TV page's address (the phone's
    // Voice on the TV card has it), then Save.
    private void askForPage() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(160, 80, 160, 80);
        box.setBackgroundColor(Color.parseColor("#131417"));
        TextView t = new TextView(this);
        t.setText("fmwax on the TV\n\nPaste the address of your house's TV page "
            + "(on the phone: Speakers tab → Voice on the TV → The TV page, Copy). The Google TV app's keyboard "
            + "on the phone can paste it here.");
        t.setTextColor(Color.parseColor("#E9E8E3"));
        t.setTextSize(22);
        EditText f = new EditText(this);
        f.setSingleLine(true);
        f.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        f.setImeOptions(EditorInfo.IME_ACTION_DONE);
        f.setTextColor(Color.parseColor("#E9E8E3"));
        f.setHint("https://…/buttons/…/tv");
        f.setHintTextColor(Color.parseColor("#9A9CA4"));
        if (page != null) f.setText(page);
        Button b = new Button(this);
        b.setText("Save");
        TextView err = new TextView(this);
        err.setTextColor(Color.parseColor("#F2B63A"));
        b.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String p = tvPage(f.getText().toString());
                if (p == null) { err.setText("That is not a TV page address (it ends in /tv)."); return; }
                page = p;
                prefs.edit().putString("page", page).apply();
                // Close the TV's keyboard, or it stays over the page.
                ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
                    .hideSoftInputFromWindow(f.getWindowToken(), 0);
                web = null;
                openPage(null);
            }
        });
        // The keyboard's ✓ saves too, so there is no need to reach the button.
        f.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int action, KeyEvent ev) {
                b.performClick();
                return true;
            }
        });
        box.addView(t);
        box.addView(f);
        box.addView(b);
        box.addView(err);
        // Codex: a retry still waiting for the old address must not load it
        // into the next page.
        retryLater.removeCallbacksAndMessages(null);
        failed = null;
        tries = 0;
        if (web != null) { web.destroy(); web = null; }
        setContentView(box);
        f.requestFocus();
    }
}
