import React, { useEffect } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SessionProvider, useSession } from '@/lib/session';
import { RealtimeProvider, useRealtime } from '@/lib/realtime';
import { Avatar, T } from '@/components/ui';
import { C, inr } from '@/lib/theme';

function IncomingOverlay() {
  const { incoming, accept, reject } = useRealtime();
  const path = usePathname();
  if (!incoming || path === '/call') return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
      {incoming.from.avatar ? <Image source={{ uri: incoming.from.avatar }} style={StyleSheet.absoluteFill} blurRadius={30} /> : null}
      <LinearGradient colors={['rgba(15,10,20,0.75)', 'rgba(15,10,20,0.97)']} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'space-between', paddingVertical: 90 }]}>
        <View style={{ alignItems: 'center', gap: 12 }}>
          <T color={C.mute} size={16}>Incoming {incoming.type} call</T>
          <Avatar uri={incoming.from.avatar} name={incoming.from.name} size={140} />
          <T size={30} weight="800">{incoming.from.name}{incoming.from.age ? `, ${incoming.from.age}` : ''}</T>
          <View style={{ backgroundColor: 'rgba(53,208,127,0.18)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99 }}>
            <T color={C.ok} weight="700">You earn {inr(incoming.earnPerMinPaise)}/min</T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 70 }}>
          <Pressable onPress={reject} style={[st.round, { backgroundColor: C.bad }]} accessibilityLabel="Decline call"><Ionicons name="close" size={34} color="#fff" /></Pressable>
          <Pressable onPress={accept} style={[st.round, { backgroundColor: C.ok }]} accessibilityLabel="Accept call"><Ionicons name={incoming.type === 'video' ? 'videocam' : 'call'} size={32} color="#fff" /></Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

function Shell() {
  const { ready, me } = useSession();
  const { call } = useRealtime();
  const router = useRouter();
  const path = usePathname();
  const callId = call?.id;
  useEffect(() => { if (callId && path !== '/call') router.push('/call'); }, [callId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.pink} size="large" /></View>;
  const onboarded = !!me?.onboarded;
  const female = onboarded && me?.gender === 'female';
  const approved = female && me?.listener?.approval === 'approved';
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!me}><Stack.Screen name="(auth)" /></Stack.Protected>
        <Stack.Protected guard={!!me && !onboarded}><Stack.Screen name="onboarding" /></Stack.Protected>
        <Stack.Protected guard={!!female && !approved}><Stack.Screen name="verify" /></Stack.Protected>
        <Stack.Protected guard={onboarded && me?.gender === 'male'}>
          <Stack.Screen name="(men)" />
          <Stack.Screen name="listener/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
        <Stack.Protected guard={!!approved}><Stack.Screen name="(women)" /></Stack.Protected>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
        </Stack.Protected>
      </Stack>
      <IncomingOverlay />
    </>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider><RealtimeProvider><Shell /></RealtimeProvider></SessionProvider>
    </SafeAreaProvider>
  );
}
const st = StyleSheet.create({ round: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' } });
