import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Screen, T } from '@/components/ui';
import { api, ApiError, ListenerSelf } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { C, inr, STYLE_META } from '@/lib/theme';

type Earn = { balancePaise: number; todayPaise: number; todayMinutes: number; todayCalls: number; weekPaise: number };

export default function WomenHome() {
  const { me, patch, reload } = useSession();
  const { connected } = useRealtime();
  const [earn, setEarn] = useState<Earn | null>(null);
  const l = me?.listener;
  useFocusEffect(useCallback(() => { reload(); api.get<Earn>('/listener/earnings').then(setEarn).catch(() => {}); }, [reload]));
  if (!me || !l) return null;

  const update = async (b: Partial<{ isAvailable: boolean; voiceRate: number; videoRate: number }>) => {
    try { const r = await api.put<ListenerSelf>('/listener/settings', b); patch({ ...me, listener: r }); }
    catch (e) { Alert.alert('Cannot update', e instanceof ApiError ? e.message : 'Try again.'); }
  };
  const Stepper = ({ label, icon, value, max, k }: { label: string; icon: keyof typeof Ionicons.glyphMap; value: number; max: number; k: 'voiceRate' | 'videoRate' }) => (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Ionicons name={icon} size={16} color={C.mute} /><T color={C.mute} size={13}>{label}</T></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => value > 1 && update({ [k]: value - 1 })} hitSlop={8} accessibilityLabel={`Lower ${label} rate`}><Ionicons name="remove-circle" size={30} color={C.pink} /></Pressable>
        <T size={22} weight="900">{value}</T>
        <Pressable onPress={() => value < max && update({ [k]: value + 1 })} hitSlop={8} accessibilityLabel={`Raise ${label} rate`}><Ionicons name="add-circle" size={30} color={value < max ? C.pink : C.line} /></Pressable>
      </View>
      <T size={11} color={C.mute}>🪙/min · max {max}</T>
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <T color={C.mute} size={13}>Hi {me.name} 👋</T>
        <LinearGradient colors={l.isAvailable ? ['#1fa971', '#0f7a52'] : ['#3b2d4a', '#251a31']} style={{ borderRadius: 28, padding: 22, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <T size={26} weight="900">{l.isAvailable ? "You're online" : "You're offline"}</T>
              <T color="rgba(255,255,255,0.8)">{l.isAvailable ? (connected ? 'Callers can see you and call now.' : 'Reconnecting… check your internet.') : 'Go online to start receiving calls.'}</T>
            </View>
            <Switch value={l.isAvailable} onValueChange={(v) => update({ isAvailable: v })} trackColor={{ true: '#fff', false: '#555' }} thumbColor={l.isAvailable ? '#1fa971' : '#bbb'} accessibilityLabel="Go online" />
          </View>
          {l.isAvailable && !connected && <T size={12} color="#ffd">Keep the app open to receive calls.</T>}
        </LinearGradient>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[['Today', inr(earn?.todayPaise ?? 0)], ['This week', inr(earn?.weekPaise ?? 0)], ['Wallet', inr(l.balancePaise)]].map(([a, b]) => (
            <Card key={a} style={{ flex: 1, padding: 12, alignItems: 'center' }}><T size={19} weight="900" color={C.ok}>{b}</T><T size={12} color={C.mute}>{a}</T></Card>
          ))}
        </View>
        <T color={C.mute} size={13} style={{ marginTop: -4 }}>Today: {earn?.todayCalls ?? 0} calls · {earn?.todayMinutes ?? 0} min</T>

        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T weight="800" size={17}>Your rates</T>
            <View style={{ backgroundColor: C.card2, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 }}><T size={12} weight="800" color={C.gold}>⭐ {l.tier.name}</T></View>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Stepper label="Voice" icon="call" value={l.voiceRate} max={l.tier.maxVoice} k="voiceRate" />
            <Stepper label="Video" icon="videocam" value={l.videoRate} max={l.tier.maxVideo} k="videoRate" />
          </View>
          <T size={12} color={C.mute}>Talk more and keep a good rating to unlock higher rates. You've talked {l.totalMinutes} min so far.</T>
        </Card>

        <Card style={{ gap: 8 }}>
          <T weight="800" size={17}>Earn more ✨</T>
          {['Be online in the evening, 7–11 PM is the busiest.', 'Smile and greet warmly. Great first 10 seconds = longer calls.', `Your vibe: ${STYLE_META[l.style].emoji} ${STYLE_META[l.style].label}. Keep your bio and voice intro fresh.`, 'Never share phone numbers or ask for money. Accounts that do are banned.'].map((t) => (
            <View key={t} style={{ flexDirection: 'row', gap: 8 }}><T color={C.pink}>•</T><T color="#e9def5" style={{ flex: 1 }} size={14}>{t}</T></View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}
