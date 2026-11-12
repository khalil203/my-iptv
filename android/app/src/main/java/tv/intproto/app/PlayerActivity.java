package tv.intproto.app;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
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

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        String url = getIntent().getStringExtra("url");
        String ua = getIntent().getStringExtra("ua");
        String title = getIntent().getStringExtra("title");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        PlayerView view = new PlayerView(this);
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

        player = new ExoPlayer.Builder(this).build();
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

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && player != null) { player.setPlayWhenReady(!player.getPlayWhenReady()); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onStop() { super.onStop(); if (player != null) { player.release(); player = null; } finish(); }
}
