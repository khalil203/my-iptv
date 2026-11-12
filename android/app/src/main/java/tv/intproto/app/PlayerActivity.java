package tv.intproto.app;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.content.SharedPreferences;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;

/** Native full-screen player (phones, tablets, Android TV). Plays http streams directly from the IPTV server. */
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private TextView msg;
    private PlayerView view;
    private Button muteBtn;
    private SeekBar volBar;
    private SharedPreferences prefs;
    private int zoom = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        String url = getIntent().getStringExtra("url");
        String ua = getIntent().getStringExtra("ua");
        String title = getIntent().getStringExtra("title");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        view.setShowSubtitleButton(true);          // CC: subtitles; settings gear: audio language, quality, speed
        view.setShowNextButton(false); view.setShowPreviousButton(false);
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        msg = new TextView(this);
        msg.setTextColor(Color.WHITE); msg.setTextSize(18); msg.setGravity(Gravity.CENTER); msg.setPadding(40, 40, 40, 40);
        msg.setText(title == null ? "" : title);
        root.addView(msg, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        setContentView(root);

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(ua == null || ua.isEmpty() ? "IPTVSmartersPro" : ua)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000).setReadTimeoutMs(30000);
        MediaItem item = MediaItem.fromUri(Uri.parse(url));
        MediaSource source = url != null && url.contains(".m3u8")
            ? new HlsMediaSource.Factory(http).createMediaSource(item)
            : new DefaultMediaSourceFactory(http).createMediaSource(item);

        // faster start: begin playing after ~1s of video
        DefaultLoadControl load = new DefaultLoadControl.Builder().setBufferDurationsMs(15000, 50000, 1000, 2000).build();
        player = new ExoPlayer.Builder(this).setLoadControl(load).build();
        prefs = getSharedPreferences("player", MODE_PRIVATE);
        player.setVolume(prefs.getFloat("vol", 1f));

        // top-right controls: mute, volume, fit/zoom (shown together with the player controls)
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(16, 16, 16, 16); bar.setBackgroundColor(0x66000000);
        muteBtn = new Button(this); muteBtn.setTextColor(Color.WHITE); muteBtn.setBackgroundColor(0x00000000); muteBtn.setTextSize(18);
        muteBtn.setOnClickListener(x -> { player.setVolume(player.getVolume() > 0 ? 0f : Math.max(0.3f, prefs.getFloat("lastVol", 1f))); syncVol(); });
        volBar = new SeekBar(this); volBar.setMax(100);
        volBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean user) { if (user) { player.setVolume(p / 100f); syncVol(); } }
            public void onStartTrackingTouch(SeekBar s) {}
            public void onStopTrackingTouch(SeekBar s) {}
        });
        Button fit = new Button(this); fit.setText("⤢ Fit"); fit.setTextColor(Color.WHITE); fit.setBackgroundColor(0x00000000);
        fit.setOnClickListener(x -> {
            zoom = (zoom + 1) % 3;
            view.setResizeMode(zoom == 0 ? AspectRatioFrameLayout.RESIZE_MODE_FIT : zoom == 1 ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FILL);
            fit.setText(zoom == 0 ? "⤢ Fit" : zoom == 1 ? "⤢ Zoom" : "⤢ Stretch");
        });
        bar.addView(muteBtn); bar.addView(volBar, new LinearLayout.LayoutParams(360, ViewGroup.LayoutParams.WRAP_CONTENT)); bar.addView(fit);
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END));
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> bar.setVisibility(visibility));
        syncVol();
        view.setPlayer(player);
        view.setKeepScreenOn(true);
        player.setMediaSource(source);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) { if (state == Player.STATE_READY) msg.setText(""); }
            @Override public void onPlayerError(PlaybackException e) {
                msg.setText("⚠️ This stream could not be played.\n" + e.getErrorCodeName() + "\n\nPress Back to choose another channel.");
            }
        });
        player.prepare();
        player.setPlayWhenReady(true);
        view.requestFocus();
    }

    private void syncVol() {
        float v = player.getVolume();
        if (v > 0) prefs.edit().putFloat("lastVol", v).apply();
        prefs.edit().putFloat("vol", v).apply();
        muteBtn.setText(v == 0 ? "🔇" : v < 0.5f ? "🔉" : "🔊");
        volBar.setProgress(Math.round(v * 100));
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_MUTE && player != null) { player.setVolume(player.getVolume() > 0 ? 0f : 1f); syncVol(); return true; }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && player != null) { player.setPlayWhenReady(!player.getPlayWhenReady()); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onStop() { super.onStop(); if (player != null) { player.release(); player = null; } finish(); }
}
