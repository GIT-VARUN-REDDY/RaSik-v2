import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Button, Chip, Screen, T } from '@/components/ui';
import { api, ApiError, Me } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C, R } from '@/lib/theme';

const FALLBACK = ['Music', 'Movies', 'Travel', 'Gaming', 'Fitness', 'Foodie', 'Poetry', 'Fashion', 'Cricket', 'Tech', 'Art', 'Anime', 'Books', 'Late-night talks', 'Dance', 'Comedy'];

export default function Onboarding() {
  const { patch, signOut } = useSession();
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>(FALLBACK);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get<{ interests: string[] }>('/config').then((c) => setInterests(c.interests)).catch(() => {}); }, []);

  const ageN = parseInt(age, 10);
  const toggle = (i: string) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= 8 ? p : [...p, i]));

  const finish = async () => {
    setBusy(true);
    try { patch(await api.put<Me>('/me/onboarding', { gender, name: name.trim(), age: ageN, interests: picked })); }
    catch (e) { Alert.alert('Oops', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(false);
  };

  const dots = (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 18 }}>
      {[0, 1, 2].map((i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? C.pink : C.line }} />)}
    </View>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {dots}
        {step === 0 && (
          <View style={{ gap: 16, flex: 1 }}>
            <T size={30} weight="900">I am a…</T>
            <T color={C.mute}>This cannot be changed later, so choose carefully.</T>
            {([['male', 'Man', '😎', 'Talk to amazing people, live', ['#4b6cff', '#2a3fb5']], ['female', 'Woman', '💃', 'Get approved & earn money by talking', ['#ff4d8d', '#c2185b']]] as const).map(([g, label, emoji, sub, cols]) => (
              <Pressable key={g} onPress={() => setGender(g)} accessibilityRole="radio" accessibilityState={{ selected: gender === g }}>
                <LinearGradient colors={cols as unknown as [string, string]} style={[st.gcard, gender === g && { borderColor: '#fff' }]}>
                  <T size={54}>{emoji}</T>
                  <View style={{ flex: 1 }}><T size={24} weight="800">{label}</T><T color="rgba(255,255,255,0.85)">{sub}</T></View>
                  {gender === g && <T size={26}>✅</T>}
                </LinearGradient>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Button title="Continue" onPress={() => setStep(1)} disabled={!gender} />
            <Pressable onPress={signOut}><T color={C.mute} style={{ textAlign: 'center' }}>Use a different number</T></Pressable>
          </View>
        )}
        {step === 1 && (
          <View style={{ gap: 14, flex: 1 }}>
            <T size={30} weight="900">About you</T>
            <T color={C.mute}>{gender === 'female' ? 'Use the name and age shown on your photo ID.' : 'This is what listeners will see.'}</T>
            <TextInput value={name} onChangeText={setName} placeholder="Your first name" placeholderTextColor="#6f6280" maxLength={30} style={st.input} autoCapitalize="words" accessibilityLabel="Name" />
            <TextInput value={age} onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 2))} placeholder="Your age (18+)" placeholderTextColor="#6f6280" keyboardType="number-pad" style={st.input} accessibilityLabel="Age" />
            {age.length === 2 && ageN < 18 && <T color={C.bad}>You must be 18 or older to use RaSik.</T>}
            <View style={{ flex: 1 }} />
            <Button title="Continue" onPress={() => setStep(2)} disabled={name.trim().length < 2 || !(ageN >= 18)} />
            <Pressable onPress={() => setStep(0)}><T color={C.mute} style={{ textAlign: 'center' }}>Back</T></Pressable>
          </View>
        )}
        {step === 2 && (
          <View style={{ gap: 14, flex: 1 }}>
            <T size={30} weight="900">What are you into?</T>
            <T color={C.mute}>Pick at least 3 — it helps match great conversations. ({picked.length}/8)</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {interests.map((i) => <Chip key={i} label={i} selected={picked.includes(i)} onPress={() => toggle(i)} />)}
            </View>
            <View style={{ flex: 1, minHeight: 20 }} />
            <Button title={gender === 'female' ? 'Next: verify & start earning' : 'Start exploring'} onPress={finish} loading={busy} disabled={picked.length < 3} />
            <Pressable onPress={() => setStep(1)}><T color={C.mute} style={{ textAlign: 'center' }}>Back</T></Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
const st = StyleSheet.create({
  gcard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: R.lg, borderWidth: 2, borderColor: 'transparent' },
  input: { backgroundColor: C.card, borderRadius: R.md, height: 58, paddingHorizontal: 16, color: '#fff', fontSize: 18, borderWidth: 1, borderColor: C.line },
});
