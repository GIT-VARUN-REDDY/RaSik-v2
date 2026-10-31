import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, Screen, StateDot, Stars, T } from '@/components/ui';
import { api, ApiError, ListenerCardT } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { C, STYLE_META } from '@/lib/theme';

function VoiceIntro({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return (
    <Pressable onPress={() => { if (status.playing) player.pause(); else { if (status.didJustFinish || status.currentTime >= status.duration - 0.2) player.seekTo(0); player.play(); } }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }} accessibilityLabel="Play voice intro">
      <LinearGradient colors={['#ff4d8d', '#ff7a59']} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color="#fff" />
      </LinearGradient>
      <View style={{ flex: 1 }}><T weight="800">Hear her voice</T><T color={C.mute} size={12}>{status.playing ? 'Playing…' : 'Tap to listen to her intro'}</T></View>
      <Ionicons name="musical-notes" size={22} color={C.pink} />
    </Pressable>
  );
}

export default function ListenerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { me } = useSession();
  const { requestCall, subscribePresence } = useRealtime();
  const { width } = useWindowDimensions();
  const [l, setL] = useState<ListenerCardT | null>(null);
  const [busy, setBusy] = useState<'voice' | 'video' | null>(null);

  const load = useCallback(async () => { try { setL(await api.get<ListenerCardT>(`/listeners/${id}`)); } catch { Alert.alert('Not available', 'This profile is no longer available.', [{ text: 'OK', onPress: () => router.back() }]); } }, [id, router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribePresence((lid, state) => { if (lid === id) setL((x) => (x ? { ...x, state: state as ListenerCardT['state'] } : x)); }), [id, subscribePresence]);

  if (!l) return <Screen><View /></Screen>;
  const meta = STYLE_META[l.style];
  const call = async (type: 'voice' | 'video') => {
    setBusy(type);
    const r = await requestCall(l.id, type);
    setBusy(null);
    if (r.ok) return;
    if (r.code === 'insufficient_coins') Alert.alert('Add coins to call', r.message, [{ text: 'Not now' }, { text: 'Add coins', onPress: () => router.push('/wallet') }]);
    else Alert.alert('Cannot call right now', r.message);
  };
  const fav = async () => { const on = !l.isFavorite; setL({ ...l, isFavorite: on }); try { await api.post(`/listeners/${l.id}/favorite`, { on }); } catch { setL({ ...l, isFavorite: !on }); } };
  const more = () => Alert.alert(l.name, undefined, [
    { text: 'Report', onPress: () => Alert.alert('Report', 'Why are you reporting?', ['Inappropriate photo', 'Fake profile', 'Harassment'].map((reason) => ({ text: reason, onPress: async () => { try { await api.post('/safety/report', { targetId: l.id, reason }); Alert.alert('Thanks', 'We will review this.'); } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : 'Try again.'); } } }))) },
    { text: 'Block', style: 'destructive', onPress: async () => { await api.post('/safety/block', { userId: l.id }); router.back(); } },
    { text: 'Cancel', style: 'cancel' },
  ]);
  const can = l.state === 'online' && (me?.coins ?? 0) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        <View style={{ width, height: width * 1.25 }}>
          {l.avatar ? <Image source={{ uri: l.avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <LinearGradient colors={['rgba(0,0,0,0.5)', 'transparent', 'rgba(15,10,20,1)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
          <Screen style={{ backgroundColor: 'transparent', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
            <Pressable onPress={() => router.back()} style={st.circle} accessibilityLabel="Back"><Ionicons name="chevron-back" size={24} color="#fff" /></Pressable>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={fav} style={st.circle} accessibilityLabel="Favourite"><Ionicons name={l.isFavorite ? 'heart' : 'heart-outline'} size={22} color={l.isFavorite ? C.pink : '#fff'} /></Pressable>
              <Pressable onPress={more} style={st.circle} accessibilityLabel="More"><Ionicons name="ellipsis-horizontal" size={22} color="#fff" /></Pressable>
            </View>
          </Screen>
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: -60, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T size={32} weight="900">{l.name}, {l.age}</T>
            <StateDot state={l.state} />
            <T color={l.state === 'online' ? C.ok : C.mute} weight="700">{l.state === 'online' ? 'Online' : l.state === 'busy' ? 'On a call' : 'Offline'}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Stars value={l.rating} size={16} /><T color={C.mute}>{l.ratingCount ? `${l.ratingCount} reviews` : 'New listener'}</T>
            <View style={{ backgroundColor: meta.colors[0], paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}><T size={12} weight="800">{meta.emoji} {meta.label}</T></View>
          </View>
          {l.voiceIntro ? <VoiceIntro uri={l.voiceIntro} /> : null}
          {l.bio ? <T size={16} color="#e9def5">{l.bio}</T> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{l.interests.map((i) => <Chip key={i} label={i} />)}</View>
          <T color={C.mute} size={13}>Speaks {l.languages.join(', ')}</T>
        </View>
      </ScrollView>
      <View style={st.bar}>
        <View style={{ flex: 1 }}><Button title={`Voice · ${l.voiceRate}🪙/min`} icon="call" variant="dark" onPress={() => call('voice')} loading={busy === 'voice'} disabled={!can || !!busy} /></View>
        <View style={{ flex: 1 }}><Button title={`Video · ${l.videoRate}🪙/min`} icon="videocam" onPress={() => call('video')} loading={busy === 'video'} disabled={!can || !!busy} /></View>
      </View>
      {l.state !== 'online' && <View style={st.note}><T size={12} color={C.mute}>{l.state === 'busy' ? 'She is on another call. Check back in a few minutes.' : 'She is offline right now. Add her to favourites to find her later.'}</T></View>}
    </View>
  );
}
const st = StyleSheet.create({
  circle: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 28, backgroundColor: 'rgba(15,10,20,0.96)', borderTopWidth: 1, borderTopColor: C.line },
  note: { position: 'absolute', left: 0, right: 0, bottom: 100, alignItems: 'center' },
});
