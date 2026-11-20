package house.fmwax.tv;

import android.util.Log;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// THE ROOM'S RECEIVER FOR TALK (2026-11-19, the owner: "I'm okay with the plan
// for automatic"). Talk's voice is the TV's sound, and the receiver (a Denon,
// by its own commands on port 23; Marantz receivers take the same, untried)
// plays one input at a time. While a Talk line is open it is put on its TV input; when the line
// closes it goes back to the input it was on, but only if it is still on TV
// (Codex: never undo a choice made during the call). A receiver already on TV
// is left alone and not switched back.
final class Denon {
    private static final Pattern INPUT = Pattern.compile("(?:^|\\r)SI([A-Z0-9/]+)\\r");
    final String host;
    private final ExecutorService line = Executors.newSingleThreadExecutor();
    private String before; // the input to go back to; null when the switch is not ours

    Denon(String host) { this.host = host; }

    // No more work for this receiver: what is queued (a back()) still runs,
    // then its line's thread ends.
    void close() { line.shutdown(); }

    void toTv() {
        line.execute(new Runnable() { public void run() {
            if (before != null) return; // already ours
            String now = input();
            Log.i("fmwaxTV", "receiver on " + now + " at the start of Talk");
            if (now == null || now.equals("TV")) return;
            if (send("SITV")) before = now;
        } });
    }

    void back() {
        line.execute(new Runnable() { public void run() {
            if (before == null) return;
            String to = before;
            // Codex: never give up the input to go back to on a reading that
            // failed. Three tries; still unknown, the switch back is sent
            // anyway (a quiet room is the worse mistake), and kept for the
            // next try if even that did not go.
            String now = null;
            for (int i = 0; i < 3 && now == null; i++) {
                now = input();
                if (now == null) try { Thread.sleep(700); } catch (InterruptedException e) { return; }
            }
            Log.i("fmwaxTV", "receiver on " + now + " at the end of Talk: " + (now == null ? "not read, sending " + to
                : now.equals("TV") ? "back to " + to : "left there, changed during the call"));
            if (now == null) { if (send("SI" + to)) before = null; return; }
            before = null;
            if (now.equals("TV")) send("SI" + to);
        } });
    }

    // The input now, from "SI?": the receiver also sends unasked status
    // lines, so its answer is looked for among them for a second.
    private String input() {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, 23), 1500);
            s.setSoTimeout(250);
            OutputStream out = s.getOutputStream();
            out.write("SI?\r".getBytes(StandardCharsets.US_ASCII));
            out.flush();
            InputStream in = s.getInputStream();
            StringBuilder got = new StringBuilder("\r");
            byte[] buf = new byte[512];
            long end = System.currentTimeMillis() + 1000;
            while (System.currentTimeMillis() < end) {
                int n;
                try { n = in.read(buf); } catch (java.net.SocketTimeoutException t) { continue; }
                if (n < 0) break;
                got.append(new String(buf, 0, n, StandardCharsets.US_ASCII));
                Matcher m = INPUT.matcher(got);
                if (m.find()) return m.group(1);
            }
        } catch (Exception e) {
            Log.i("fmwaxTV", "receiver not reached: " + e);
        }
        return null;
    }

    private boolean send(String cmd) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, 23), 1500);
            OutputStream out = s.getOutputStream();
            out.write((cmd + "\r").getBytes(StandardCharsets.US_ASCII));
            out.flush();
            Thread.sleep(300);
            return true;
        } catch (Exception e) {
            Log.i("fmwaxTV", "receiver not switched (" + cmd + "): " + e);
            return false;
        }
    }

    // A private IPv4 address on the home network, nothing else.
    static boolean ok(String a) {
        if (a == null || !a.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        String[] p = a.split("\\.");
        for (String x : p) if (Integer.parseInt(x) > 255) return false;
        int b0 = Integer.parseInt(p[0]), b1 = Integer.parseInt(p[1]);
        return b0 == 10 || (b0 == 192 && b1 == 168) || (b0 == 172 && b1 >= 16 && b1 <= 31);
    }
}
