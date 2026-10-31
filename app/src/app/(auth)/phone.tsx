import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Button, Screen, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { C, R } from '@/lib/theme';

export default function Phone() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[6-9]\d{9}$/.test(phone);

  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ phone: string; devOtp?: string }>('/auth/otp/send', { phone });
      router.push({ pathname: '/otp', params: { phone: r.phone, dev: r.devOtp ?? '' } });
    } catch (e) { Alert.alert('Could not send OTP', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(false);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: 24, justifyContent: 'space-between' }}>
        <View style={{ marginTop: 40, gap: 14 }}>
          <LinearGradient colors={['#ff4d8d', '#ff7a59']} style={st.logo}><T size={34}>🌸</T></LinearGradient>
          <T size={38} weight="900" style={{ lineHeight: 44 }}>Talk to someone{'\n'}who gets you.</T>
          <T color={C.mute} size={17}>Real voices. Real faces. Live, one-to-one.</T>
        </View>
        <View style={{ gap: 14 }}>
          <T weight="700" color={C.mute}>Your mobile number</T>
          <View style={st.inputRow}>
            <T size={18} weight="700">🇮🇳 +91</T>
            <TextInput value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="98765 43210" placeholderTextColor="#6f6280" style={st.input} maxLength={10} autoFocus accessibilityLabel="Mobile number" />
          </View>
          <Button title="Get OTP" onPress={go} loading={busy} disabled={!valid} />
          <T size={12} color={C.mute} style={{ textAlign: 'center' }}>By continuing you confirm you are 18+ and accept our Terms & Privacy Policy.</T>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
const st = StyleSheet.create({
  logo: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 16, height: 60, borderWidth: 1, borderColor: C.line },
  input: { flex: 1, color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: 1 },
});
