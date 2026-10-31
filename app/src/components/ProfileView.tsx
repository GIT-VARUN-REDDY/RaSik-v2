import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Avatar, Button, Card, Chip, Screen, T, Header } from '@/components/ui';
import { api, ApiError, Me } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';

export default function ProfileView() {
  const { me, patch, signOut } = useSession();
  const [bio, setBio] = useState(me?.bio ?? '');
  const [name, setName] = useState(me?.name ?? '');
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const female = me.gender === 'female';

  const photo = async () => {
    if (female && me.listener?.approval === 'approved') {
      const ok = await new Promise<boolean>((res) => Alert.alert('Change photo?', 'A new photo goes back to review, and you will be offline until it is approved.', [{ text: 'Cancel', onPress: () => res(false) }, { text: 'Continue', onPress: () => res(true) }]));
      if (!ok) return;
    }
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return Alert.alert('Permission needed', 'Allow photo access in Settings.');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 0.8 });
    if (r.canceled) return;
    setBusy(true);
    try { patch(await api.upload<Me>('/me/avatar', r.assets[0].uri, 'photo.jpg', 'image/jpeg')); } catch (e) { Alert.alert('Upload failed', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try { patch(await api.put<Me>('/me/profile', { name: name.trim(), bio: bio.trim() })); Alert.alert('Saved ✓'); } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(false);
  };
  const del = () => Alert.alert('Delete account?', 'This permanently removes your profile. Unused coins are lost.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.del('/me'); await signOut(); } catch (e) { Alert.alert('Cannot delete', e instanceof ApiError ? e.message : 'Try again.'); } } },
  ]);

  return (
    <Screen>
      <Header title="Me" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Pressable onPress={photo} accessibilityLabel="Change photo"><Avatar uri={me.avatar} name={me.name} size={110} /></Pressable>
          <Pressable onPress={photo}><T color={C.pink} weight="700">{busy ? 'Uploading…' : 'Change photo'}</T></Pressable>
          <T color={C.mute}>{me.phone}</T>
        </View>
        <Card style={{ gap: 10 }}>
          <T weight="800">Name</T>
          <TextInput value={name} onChangeText={setName} maxLength={30} style={{ backgroundColor: C.card2, color: '#fff', borderRadius: 12, height: 48, paddingHorizontal: 14, fontSize: 16 }} />
          <T weight="800">About me</T>
          <TextInput value={bio} onChangeText={setBio} maxLength={200} multiline placeholder={female ? 'Tell callers what makes you fun to talk to…' : 'A line about you'} placeholderTextColor="#6f6280" style={{ backgroundColor: C.card2, color: '#fff', borderRadius: 12, minHeight: 90, padding: 14, fontSize: 16, textAlignVertical: 'top' }} />
          <Button title="Save" onPress={save} loading={busy} />
        </Card>
        <Card style={{ gap: 8 }}><T weight="800">Interests</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{me.interests.map((i) => <Chip key={i} label={i} />)}</View></Card>
        <Button title="Sign out" variant="ghost" onPress={signOut} />
        <Pressable onPress={del}><T color={C.bad} style={{ textAlign: 'center' }}>Delete my account</T></Pressable>
        <T size={11} color={C.mute} style={{ textAlign: 'center' }}>RaSik v2.0 · 18+ only · Never share personal contact details or money outside the app.</T>
      </ScrollView>
    </Screen>
  );
}
