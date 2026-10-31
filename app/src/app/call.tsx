import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useKeepAwake } from 'expo-keep-awake';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endReasonText, useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { C, inr, mmss } from '@/lib/theme';

function Ctl({ icon, onPress, active = true, danger, label, size = 58 }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean; danger?: boolean; label: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? C.bad : active ? 'rgba(255,255,255,0.22)' : '#fff' }}>
      <Ionicons name={icon} size={size * 0.44} color={danger || active ? '#fff' : '#111'} />
    </Pressable>
  );
}

export default function CallScreen() {
  useKeepAwake();
  const router = useRouter();
  const { me } = useSession();
  const rt = useRealtime();
  const c = rt.call;
  const [now, setNow] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!c) (router.canGoBack() ? router.back() : router.replace('/')); }, [c, router]);
  if (!c) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const male = me?.gender === 'male';
  const secs = c.startedAtLocal ? Math.max(0, Math.floor((now - c.startedAtLocal) / 1000)) : 0;
  const video = c.type === 'video';
  const showRemoteVideo = video && c.remote && c.peerCam && c.phase === 'active';

  if (c.phase === 'ended') return <Summary />;

  const status = c.phase === 'ringing' ? `Calling ${c.peer?.name ?? ''}…` : c.phase === 'connecting' ? 'Connecting…' : mmss(secs);
  const send = () => { if (text.trim()) { rt.sendChat(text); setText(''); } };
  const recent = c.messages.filter((m) => chatOpen || now - m.at < 9000).slice(-4);

  const addCoins = async () => {
    try { const o = await api.post<{ payUrl: string }>('/wallet/orders', { packId: 'p99' }); await WebBrowser.openBrowserAsync(o.payUrl); }
    catch (e) { Alert.alert('Payment', e instanceof ApiError ? e.message : 'Try again.'); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0610' }}>
      {/* Remote video, or a blurred portrait behind the avatar for voice calls */}
      {showRemoteVideo ? <RTCView streamURL={c.remote!.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
        : c.peer?.avatar ? <Image source={{ uri: c.peer.avatar }} style={StyleSheet.absoluteFill} blurRadius={40} /> : null}
      <LinearGradient colors={['rgba(10,6,16,0.55)', 'rgba(10,6,16,0.1)', 'rgba(10,6,16,0.7)']} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <SafeAreaView style={{ flex: 1, justifyContent: 'space-between' }}>
        {/* Top bar */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6 }}>
          <View style={{ gap: 4 }}>
            <T size={20} weight="800">{c.peer?.name}</T>
            <T size={15} weight="700" color={c.phase === 'active' ? '#fff' : C.mute}>{status}</T>
            {c.phase === 'active' && (
              <View style={st.pill}>
                {male ? <T size={12} weight="800">🪙 {c.balance ?? 0} left · {c.rate}/min</T> : <T size={12} weight="800" color={C.ok}>+ {inr(c.earnedPaise)} earned</T>}
              </View>
            )}
            {!c.peerMic && c.phase === 'active' && <View style={st.pill}><Ionicons name="mic-off" size={12} color="#fff" /><T size={12}>Muted</T></View>}
          </View>
          {video && c.local && c.camOn && (
            <View style={st.pip}><RTCView streamURL={c.local.toURL()} style={{ flex: 1 }} objectFit="cover" mirror zOrder={1} /></View>
          )}
        </View>

        {/* Voice-call avatar / video-off placeholder */}
        {!showRemoteVideo && (
          <View style={{ alignItems: 'center', gap: 14 }}>
            <View style={st.halo}><Avatar uri={c.peer?.avatar} name={c.peer?.name} size={150} /></View>
            {c.phase === 'active' && video && !c.peerCam && <T color={C.mute}>{c.peer?.name}'s camera is off</T>}
          </View>
        )}

        <View>
          {c.notice && <T size={12} color={C.gold} style={{ textAlign: 'center', marginBottom: 6 }}>{c.notice}</T>}
          {c.lowBalance && male && (
            <View style={st.low}>
              <T weight="700" style={{ flex: 1 }} size={13}>Low coins — call ends in {c.lowBalance.secondsLeft}s</T>
              <Pressable onPress={addCoins} style={{ backgroundColor: C.pink, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99 }}><T weight="800" size={13}>Add coins</T></Pressable>
            </View>
          )}

          {/* Chat: small, transparent, bottom-right */}
          {c.phase === 'active' && (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : undefined} style={st.chatWrap} pointerEvents="box-none">
              <View style={{ gap: 4, alignItems: 'flex-end' }} pointerEvents="none">
                {recent.map((m) => (
                  <View key={m.id} style={[st.bubble, m.from === me?.id && { backgroundColor: 'rgba(255,77,141,0.45)' }]}><T size={13}>{m.text}</T></View>
                ))}
              </View>
              {chatOpen ? (
                <View style={st.chatInput}>
                  <TextInput value={text} onChangeText={setText} onSubmitEditing={send} placeholder="Say something…" placeholderTextColor="rgba(255,255,255,0.6)" style={{ flex: 1, color: '#fff', fontSize: 13, paddingVertical: 6 }} maxLength={300} returnKeyType="send" autoFocus />
                  <Pressable onPress={send} hitSlop={8}><Ionicons name="send" size={18} color={C.pink} /></Pressable>
                  <Pressable onPress={() => setChatOpen(false)} hitSlop={8}><Ionicons name="close" size={18} color="#fff" /></Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setChatOpen(true)} style={st.chatBtn} accessibilityLabel="Open chat"><Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" /></Pressable>
              )}
            </KeyboardAvoidingView>
          )}

          {/* Controls */}
          <View style={st.controls}>
            <Ctl icon={c.micOn ? 'mic' : 'mic-off'} active={c.micOn} onPress={rt.toggleMic} label="Microphone" />
            {video && <Ctl icon={c.camOn ? 'videocam' : 'videocam-off'} active={c.camOn} onPress={rt.toggleCam} label="Camera" />}
            {video && <Ctl icon="camera-reverse" onPress={rt.flipCamera} label="Flip camera" />}
            <Ctl icon={c.speakerOn ? 'volume-high' : 'volume-low'} active={!c.speakerOn ? true : false} onPress={rt.toggleSpeaker} label="Speaker" />
            <Ctl icon="call" danger onPress={rt.hangup} label="End call" size={66} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Summary() {
  const router = useRouter();
  const { me } = useSession();
  const { call: c, dismissCall } = useRealtime();
  const [stars, setStars] = useState(0);
  if (!c?.end) return null;
  const e = c.end;
  const male = me?.gender === 'male';
  const done = () => { dismissCall(); };
  const rate = async (n: number) => { setStars(n); try { await api.post(`/calls/${c.id}/rate`, { rating: n }); } catch {} };
  const report = () => Alert.alert('Report', 'What went wrong?', ['Inappropriate behaviour', 'Asked for money/contact', 'Fake profile'].map((reason) => ({ text: reason, onPress: async () => { try { await api.post('/safety/report', { targetId: c.peer!.id, callId: c.id, reason }); Alert.alert('Thanks', 'Our team will review this.'); } catch {} } })).concat([{ text: 'Cancel', onPress: async () => {} }]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <Avatar uri={c.peer?.avatar} name={c.peer?.name} size={110} />
      <T size={26} weight="900">{e.seconds > 0 ? 'Call ended' : endReasonText(e.reason)}</T>
      {e.seconds > 0 && <T color={C.mute}>{endReasonText(e.reason) !== 'Call ended.' ? endReasonText(e.reason) + ' ' : ''}Duration {mmss(e.seconds)}</T>}
      {c.notice && e.seconds === 0 && <T color={C.gold} style={{ textAlign: 'center' }}>{c.notice}</T>}
      {e.seconds > 0 && (male
        ? <T size={20} weight="800">Spent 🪙 {e.coins} · Balance 🪙 {e.balance ?? me?.coins}</T>
        : <T size={22} weight="900" color={C.ok}>You earned {inr(e.earnedPaise ?? 0)}</T>)}
      {male && e.seconds > 0 && (
        <View style={{ alignItems: 'center', gap: 8, marginTop: 10 }}>
          <T color={C.mute}>How was your call?</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} onPress={() => !stars && rate(n)} hitSlop={6} accessibilityLabel={`${n} stars`}><Ionicons name={n <= stars ? 'star' : 'star-outline'} size={38} color={C.gold} /></Pressable>)}
          </View>
        </View>
      )}
      {male && e.reason === 'insufficient_coins' && <Button title="Add coins" onPress={() => { done(); router.push('/wallet'); }} style={{ alignSelf: 'stretch', marginTop: 12 }} />}
      <Button title="Done" variant={e.reason === 'insufficient_coins' && male ? 'ghost' : 'primary'} onPress={done} style={{ alignSelf: 'stretch', marginTop: 6 }} />
      {c.peer && <Pressable onPress={report}><T color={C.mute} size={13}>Report a problem</T></Pressable>}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  pip: { width: 108, height: 150, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: '#000' },
  halo: { padding: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.12)' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, paddingBottom: 18, paddingTop: 10 },
  low: { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,91,91,0.85)', padding: 10, borderRadius: 16 },
  chatWrap: { position: 'absolute', right: 12, bottom: 96, width: 230, alignItems: 'flex-end', gap: 6 },
  bubble: { maxWidth: 230, backgroundColor: 'rgba(0,0,0,0.38)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  chatBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' },
  chatInput: { width: 230, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 12 },
});
