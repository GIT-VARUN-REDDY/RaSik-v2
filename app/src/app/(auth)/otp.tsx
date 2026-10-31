import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Screen, T } from '@/components/ui';
import { api, ApiError, Me } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C, R } from '@/lib/theme';

export default function Otp() {
  const { phone, dev } = useLocalSearchParams<{ phone: string; dev?: string }>();
  const router = useRouter();
  const { signIn } = useSession();
  const [code, setCode] = useState(dev || '');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(30);
  const ref = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => { const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000); return () => clearInterval(t); }, []);

  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true);
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string; user: Me }>('/auth/otp/verify', { phone, code: c });
      await signIn(r, r.user);
      if (!r.user.onboarded) {
        router.replace('/onboarding');
      } else if (r.user.gender === 'female') {
        router.replace(r.user.listener?.approval === 'approved' ? '/(women)' : '/verify');
      } else {
        router.replace('/(men)');
      }
    } catch (e) { setCode(''); Alert.alert('Verification failed', e instanceof ApiError ? e.message : 'Try again.'); ref.current?.focus(); }
    setBusy(false);
  };
  const resend = async () => {
    try { const r = await api.post<{ devOtp?: string }>('/auth/otp/send', { phone }); setWait(30); if (r.devOtp) setCode(r.devOtp); }
    catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : 'Try again.'); }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ padding: 24, gap: 18, flex: 1 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back"><Ionicons name="chevron-back" size={28} color="#fff" /></Pressable>
        <T size={30} weight="900">Enter the code</T>
        <T color={C.mute} size={16}>We sent a 6-digit OTP to {phone}</T>
        <Pressable onPress={() => ref.current?.focus()} style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginTop: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={[st.box, code.length === i && { borderColor: C.pink }]}><T size={26} weight="800">{code[i] ?? ''}</T></View>
          ))}
        </Pressable>
        <TextInput ref={ref} value={code} autoFocus onChangeText={(t) => { const v = t.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) verify(v); }} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }} />
        <Button title="Verify & continue" onPress={() => verify()} loading={busy} disabled={code.length !== 6} />
        <Pressable onPress={wait ? undefined : resend}><T color={wait ? C.mute : C.pink} weight="700" style={{ textAlign: 'center' }}>{wait ? `Resend OTP in ${wait}s` : 'Resend OTP'}</T></Pressable>
      </View>
    </Screen>
  );
}
const st = StyleSheet.create({ box: { flex: 1, height: 60, borderRadius: R.md, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' } });
