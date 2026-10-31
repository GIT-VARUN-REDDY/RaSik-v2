import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ListenerCardT } from '@/lib/api';
import { C, R, STYLE_META } from '@/lib/theme';
import { StateDot } from './ui';

// Photo-first card: the picture does the talking.
export function ListenerCard({ l, width, onPress }: { l: ListenerCardT; width: number; onPress: () => void }) {
  const meta = STYLE_META[l.style];
  const h = width * 1.32;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width, height: h, opacity: pressed ? 0.92 : 1 }, st.card]} accessibilityRole="button" accessibilityLabel={`${l.name}, ${l.age}, ${l.state}`}>
      {l.avatar ? <Image source={{ uri: l.avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: C.card2 }]} />}
      <LinearGradient colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.85)']} style={StyleSheet.absoluteFill} />
      <View style={st.top}>
        <View style={st.badge}><StateDot state={l.state} /><Text style={st.badgeT}>{l.state === 'online' ? 'Online' : l.state === 'busy' ? 'On a call' : 'Offline'}</Text></View>
        <View style={[st.badge, { backgroundColor: meta.colors[0] }]}><Text style={st.badgeT}>{meta.emoji}</Text></View>
      </View>
      <View style={st.bottom}>
        <Text style={st.name} numberOfLines={1}>{l.name}, {l.age}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {l.rating ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Ionicons name="star" size={12} color={C.gold} /><Text style={st.sub}>{l.rating.toFixed(1)}</Text></View> : <Text style={st.sub}>New ✨</Text>}
          <Text style={st.sub}>·</Text>
          <Ionicons name="call" size={11} color="#fff" /><Text style={st.sub}>{l.voiceRate}/min</Text>
          <Ionicons name="videocam" size={12} color="#fff" /><Text style={st.sub}>{l.videoRate}/min</Text>
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.card },
  top: { flexDirection: 'row', justifyContent: 'space-between', padding: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: R.pill },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '700' },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 12, gap: 3 },
  name: { color: '#fff', fontSize: 18, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
});
