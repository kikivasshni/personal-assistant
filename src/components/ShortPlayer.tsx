import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import type { FeedItem } from '@/lib/db';
import { fonts } from '@/theme';

// One full-screen clip, Shorts-style. YouTube clips use the IFrame Player API
// with YouTube's own controls hidden, so the app drives them: autoplay when
// the clip is on screen, pause when it isn't, loop, tap to pause, double-tap
// to like. Neighbouring clips stay mounted (paused) so swiping is instant.

// Must match the baseUrl the page is served from, or YouTube refuses to play
// the embed (error 152/153).
const ORIGIN = 'https://oracle.kirthi.app';

export const youtubeId = (item: FeedItem) => item.embed_url?.match(/\/embed\/([\w-]{11})/)?.[1] ?? null;

function youtubeHtml(id: string, autoplay: boolean, cover: boolean) {
  // Shorts are 9:16. "cover" scales the player to fill the screen like the
  // Shorts app (a sliver is cropped on tall phones); wide videos are fitted.
  const size = cover
    ? 'width:max(100vw,calc(100vh*9/16));height:max(100vh,calc(100vw*16/9));'
    : 'width:100vw;height:100vh;';
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border:0;${size}}</style>
</head><body><div id="p"></div>
<script>
var player, want=${autoplay ? 'true' : 'false'}, ready=false, triedMute=false;
function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
window.cmd=function(c){
  if(c==='play') want=true; if(c==='pause') want=false;
  if(!ready) return;
  if(c==='play') player.playVideo();
  else if(c==='pause') player.pauseVideo();
  else if(c==='restart'){ player.seekTo(0,true); player.playVideo(); }
  else if(c==='unmute'){ player.unMute(); player.setVolume(100); post({t:'sound'}); }
};
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{videoId:'${id}',host:'https://www.youtube.com',
    playerVars:{autoplay:want?1:0,playsinline:1,controls:0,rel:0,modestbranding:1,loop:1,playlist:'${id}',fs:0,iv_load_policy:3,disablekb:1,origin:'${ORIGIN}'},
    events:{
      onReady:function(){
        ready=true; post({t:'ready'});
        if(want) player.playVideo();
        // Some phones block autoplay with sound: fall back to muted, like Shorts.
        setTimeout(function(){ if(want && player.getPlayerState()!==1 && !triedMute){ triedMute=true; player.mute(); player.playVideo(); post({t:'muted'}); } },1200);
        setInterval(function(){ try{ if(player.getPlayerState()===1){ var d=player.getDuration(); if(d) post({t:'time',c:player.getCurrentTime(),d:d}); } }catch(e){} },250);
      },
      onStateChange:function(e){
        if(e.data===0){ player.seekTo(0,true); if(want) player.playVideo(); }
        if(e.data===1 && !want) player.pauseVideo();
        post({t:'state',s:e.data});
      },
      onError:function(e){ post({t:'error',code:e.data}); }
    }});
}
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
}

// TikTok / Instagram embeds: best effort. Find their <video> and drive it.
const EMBED_CMD = (c: 'play' | 'pause') => `(function(){
  var v=document.querySelector('video');
  if(v){ ${c === 'play' ? "v.loop=true; v.play().catch(function(){ v.muted=true; v.play(); });" : 'v.pause();'} }
  else if(${c === 'play' ? 'true' : 'false'}){ var el=document.elementFromPoint(innerWidth/2,innerHeight/2); if(el) el.click(); }
})(); true;`;

type Props = {
  item: FeedItem;
  active: boolean; // the clip on screen
  suspended: boolean; // on screen but shouldn't play (other tab, app in background)
  mounted: boolean; // near the screen: keep a player loaded
  onLike: () => void;
};

export function ShortPlayer({ item, active, suspended, mounted, onLike }: Props) {
  const web = useRef<WebView<object>>(null);
  const [started, setStarted] = useState(false); // first frame is playing
  const [paused, setPaused] = useState(false); // paused by a tap
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [heart] = useState(() => new Animated.Value(0));
  const [heartScale] = useState(() => heart.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.15] }));
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ytId = item.source === 'youtube' ? youtubeId(item) : null;
  const embeddable = !!item.embed_url && !failed;
  const cover = /\/shorts\//.test(item.url);

  // The page is built once per clip. Whether it starts playing is fixed at
  // load; after that play/pause go through window.cmd, so swiping never
  // reloads a player.
  const [startActive] = useState(active && !suspended);
  const source = useMemo<{ html: string; baseUrl: string } | { uri: string } | null>(
    () => (ytId ? { html: youtubeHtml(ytId, startActive, cover), baseUrl: ORIGIN } : item.embed_url ? { uri: item.embed_url } : null),
    [ytId, startActive, cover, item.embed_url],
  );

  const send = useCallback(
    (c: 'play' | 'pause' | 'restart') => {
      if (ytId) web.current?.injectJavaScript(`window.cmd && window.cmd('${c}'); true;`);
      else if (item.embed_url) web.current?.injectJavaScript(EMBED_CMD(c === 'pause' ? 'pause' : 'play'));
    },
    [ytId, item.embed_url],
  );

  // Swiping onto a clip starts it from the top; swiping away pauses it.
  useEffect(() => {
    if (!mounted) {
      // The player unloads far from the screen; show the thumbnail when it's back.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStarted(false);
      return;
    }
    if (active && !suspended) send('restart');
    else if (!active) send('pause');
    // A swipe clears any tap-pause, like Shorts.
    setPaused(false);
    // Only on swipes; suspend/resume is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mounted, send]);

  // Leaving the tab or the app pauses; coming back resumes where it was.
  useEffect(() => {
    if (!mounted || !active) return;
    if (suspended) send('pause');
    else if (!paused) send('play');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspended]);

  // Unmount clears timers.
  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { t: string; s?: number; c?: number; d?: number; code?: number };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.t === 'state' && m.s === 1) setStarted(true);
    else if (m.t === 'time' && m.d) setProgress(Math.min(1, (m.c ?? 0) / m.d));
    else if (m.t === 'muted') setMuted(true);
    else if (m.t === 'sound') setMuted(false);
    else if (m.t === 'error') setFailed(true);
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    send(next ? 'pause' : 'play');
  };

  const like = () => {
    if (!item.saved) onLike();
    heart.setValue(0);
    Animated.sequence([
      Animated.spring(heart, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 12 }),
      Animated.timing(heart, { toValue: 0, duration: 350, delay: 350, useNativeDriver: true }),
    ]).start();
  };

  // Single tap pauses/plays; a second tap within 250 ms is a double-tap like.
  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 250) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = 0;
      like();
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (embeddable) togglePause();
      else Linking.openURL(item.url);
    }, 250);
  };

  return (
    <View style={styles.fill}>
      {embeddable && mounted && source && (
        <WebView
          ref={web}
          source={source}
          style={styles.web}
          onMessage={onMessage}
          onLoadEnd={() => {
            if (!ytId && active && !suspended) setTimeout(() => web.current?.injectJavaScript(EMBED_CMD('play')), 800);
            if (!ytId) setStarted(true);
          }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
        />
      )}

      {/* Thumbnail until the first frame plays, and for clips that can't embed. */}
      {(!embeddable || !started) && item.thumb ? (
        <Image source={{ uri: item.thumb }} style={[StyleSheet.absoluteFill, styles.thumb]} resizeMode={embeddable ? 'cover' : 'contain'} />
      ) : null}

      {/* Transparent layer on top: takes taps (pause / like) and lets the
          list's vertical swipe through, so the WebView never steals it. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} />

      {paused && (
        <View pointerEvents="none" style={styles.center}>
          <View style={styles.bigIcon}>
            <Ionicons name="play" size={44} color="#fff" />
          </View>
        </View>
      )}

      {failed && (
        <View style={styles.center}>
          <Text style={styles.failText}>This one can’t play in the app.</Text>
          <Pressable style={styles.failBtn} onPress={() => Linking.openURL(item.url)}>
            <Ionicons name="open-outline" size={16} color="#000" />
            <Text style={styles.failBtnText}>Open in {item.source === 'youtube' ? 'YouTube' : item.source}</Text>
          </Pressable>
        </View>
      )}

      {muted && active && (
        <Pressable
          style={styles.sound}
          onPress={() => {
            web.current?.injectJavaScript(`window.cmd('unmute'); true;`);
            setMuted(false);
          }}
        >
          <Ionicons name="volume-mute" size={16} color="#fff" />
          <Text style={styles.soundText}>Tap for sound</Text>
        </Pressable>
      )}

      <Animated.View
        pointerEvents="none"
        style={[styles.center, { opacity: heart, transform: [{ scale: heartScale }] }]}
      >
        <Ionicons name="heart" size={110} color="#FF4D79" />
      </Animated.View>

      {ytId && embeddable && (
        <View pointerEvents="none" style={styles.track}>
          <View style={[styles.bar, { width: `${progress * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
  thumb: { backgroundColor: '#000' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12 },
  bigIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 6 },
  failText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 15 },
  failBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  failBtnText: { color: '#000', fontFamily: fonts.bodyHeavy, fontSize: 14 },
  sound: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  soundText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 13 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, backgroundColor: 'rgba(255,255,255,0.25)' },
  bar: { height: '100%', backgroundColor: '#fff' },
});
