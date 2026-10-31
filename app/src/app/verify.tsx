import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen, T } from '@/components/ui';
import { api, ApiError, ListenerSelf, Me } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C, STYLE_META, StyleKey } from '@/lib/theme';

type V = ListenerSelf & { challenge: string; hasAvatar: boolean; name: string };

export default function Verify() {
  const { me, patch, reload, signOut } = useSession();
  const router = useRouter();
  const [v, setV] = useState<V | null>(null);
  const [mode, setMode] = useState<'video' | 'voice' | null>(null);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<StyleKey>('friend');

  const load = useCallback(async () => {
    try {
      const r = await api.get<V>('/listener/verification');
      setV(r);
      setStyle(r.style);
      if (r.approval === 'approved') {
        router.replace('/(women)');
      }
      return r;
    } catch {
      return null;
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // While waiting for review, quietly check for approval.
  useEffect(() => {
    if (v?.approval !== 'pending') return;
    const t = setInterval(async () => {
      const m = await reload();
      if (m?.listener?.approval === 'approved') {
        router.replace('/(women)');
      }
    }, 5000);
    return () => clearInterval(t);
  }, [v?.approval, reload, router]);


  const photo = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Please allow access in Settings.');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 0.8, cameraType: ImagePicker.CameraType.front };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    setBusy(true);
    try { patch(await api.upload<Me>('/me/avatar', r.assets[0].uri, 'photo.jpg', 'image/jpeg')); await load(); }
    catch (e) { Alert.alert('Upload failed', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(false);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await api.put('/listener/settings', { style });
      await api.post('/listener/verification/submit');
      await reload(); await load();
    } catch (e) { Alert.alert('Cannot submit', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(false);
  };

  if (!v) return <Screen><View /></Screen>;

  if (v.approval === 'pending') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
          <T size={64}>⏳</T>
          <T size={26} weight="900" style={{ textAlign: 'center' }}>We're reviewing your profile</T>
          <Button title="Check status" variant="ghost" onPress={async () => {
            const m = await reload();
            if (m?.listener?.approval === 'approved') {
              router.replace('/(women)');
            } else {
              await load();
            }
          }} style={{ alignSelf: 'stretch', marginTop: 12 }} />

          <Pressable onPress={signOut}><T color={C.mute}>Sign out</T></Pressable>
        </View>
      </Screen>
    );
  }

  const done = v.hasAvatar && v.hasVideo && v.hasVoice;
  const Step = ({ n, title, sub, ok, children }: { n: number; title: string; sub: string; ok: boolean; children: React.ReactNode }) => (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: ok ? C.ok : C.card2, alignItems: 'center', justifyContent: 'center' }}>
          {ok ? <Ionicons name="checkmark" size={20} color="#fff" /> : <T weight="800">{n}</T>}
        </View>
        <View style={{ flex: 1 }}><T weight="800" size={17}>{title}</T><T color={C.mute} size={13}>{sub}</T></View>
      </View>
      {children}
    </Card>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <T size={28} weight="900">Get verified, start earning 💰</T>
        <T color={C.mute}>Verified profiles get more calls. It takes 2 minutes.</T>
        {v.approval === 'rejected' && (
          <Card style={{ borderColor: C.bad }}><T weight="800" color={C.bad}>Not approved yet</T><T color={C.mute}>{v.rejectReason || 'Please retake your photo, video and voice and submit again.'}</T></Card>
        )}

        <Step n={1} title="Your photo" sub="Clear face, good light, no filters or sunglasses" ok={v.hasAvatar}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {me?.avatar ? <Image source={{ uri: me.avatar }} style={{ width: 72, height: 96, borderRadius: 12 }} /> : null}
            <View style={{ flex: 1, gap: 8 }}>
              <Button title="Take selfie" icon="camera" variant="dark" onPress={() => photo(true)} disabled={busy} />
              <Button title="Choose from gallery" variant="ghost" onPress={() => photo(false)} disabled={busy} />
            </View>
          </View>
        </Step>

        <Step n={2} title="Verification video" sub="10 seconds. Face the camera and read the code aloud" ok={v.hasVideo}>
          <Button title={v.hasVideo ? 'Record again' : 'Record video'} icon="videocam" variant="dark" onPress={() => setMode('video')} />
        </Step>

        <Step n={3} title="Voice intro" sub="Callers can preview this. Say hi in your own style!" ok={v.hasVoice}>
          <Button title={v.hasVoice ? 'Record again' : 'Record voice intro'} icon="mic" variant="dark" onPress={() => setMode('voice')} />
        </Step>

        <Step n={4} title="Your vibe" sub="How should callers see you?" ok={true}>
          <View style={{ gap: 8 }}>
            {(Object.keys(STYLE_META) as StyleKey[]).map((k) => (
              <Pressable key={k} onPress={() => setStyle(k)} style={[st.vibe, style === k && { borderColor: C.pink, backgroundColor: 'rgba(255,77,141,0.12)' }]}>
                <T size={26}>{STYLE_META[k].emoji}</T>
                <View style={{ flex: 1 }}><T weight="800">{STYLE_META[k].label}</T><T size={12} color={C.mute}>{STYLE_META[k].tagline}</T></View>
                {style === k && <Ionicons name="checkmark-circle" size={22} color={C.pink} />}
              </Pressable>
            ))}
          </View>
        </Step>

        <Button title="Submit for approval" onPress={submit} loading={busy} disabled={!done} />
        <T size={12} color={C.mute} style={{ textAlign: 'center' }}>Your verification video is private. Only our review team can see it.</T>
        <Pressable onPress={signOut}><T color={C.mute} style={{ textAlign: 'center' }}>Sign out</T></Pressable>
      </ScrollView>

      <Modal visible={mode === 'video'} animationType="slide" onRequestClose={() => setMode(null)}>
        <VideoRecorder code={v.challenge} onClose={() => setMode(null)} onDone={async () => { setMode(null); await load(); }} />
      </Modal>
      <Modal visible={mode === 'voice'} animationType="slide" onRequestClose={() => setMode(null)}>
        <VoiceRecorder name={v.name} onClose={() => setMode(null)} onDone={async () => { setMode(null); await load(); }} />
      </Modal>
    </Screen>
  );
}

function VideoRecorder({ code, onClose, onDone }: { code: string; onClose: () => void; onDone: () => void }) {
  const [cam, askCam] = useCameraPermissions();
  const [mic, askMic] = useMicrophonePermissions();
  const ref = useRef<CameraView>(null);
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [up, setUp] = useState(false);

  useEffect(() => { if (!cam?.granted) askCam(); if (!mic?.granted) askMic(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!rec) return; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [rec]);

  if (!cam?.granted || !mic?.granted) return (
    <Screen><View style={{ flex: 1, justifyContent: 'center', padding: 30, gap: 14 }}>
      <T size={20} weight="800" style={{ textAlign: 'center' }}>Camera & microphone access needed</T>
      <Button title="Allow access" onPress={() => { askCam(); askMic(); }} /><Button title="Close" variant="ghost" onPress={onClose} />
    </View></Screen>
  );

  const start = async () => {
    if (!ref.current) return;
    setRec(true);
    try {
      const r = await ref.current.recordAsync({ maxDuration: 15 });
      setRec(false);
      if (!r?.uri) return;
      setUp(true);
      await api.upload('/listener/verification/video', r.uri, 'verify.mp4', 'video/mp4');
      onDone();
    } catch (e) { setRec(false); setUp(false); Alert.alert('Upload failed', e instanceof ApiError ? e.message : 'Try again.'); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={ref} style={StyleSheet.absoluteFill} facing="front" mode="video" mute={false} />
      <Screen style={{ backgroundColor: 'transparent', justifyContent: 'space-between' }} edges={['top', 'bottom']}>
        <View style={{ padding: 20, alignItems: 'center', gap: 8 }}>
          <View style={st.codeBox}><T color="#fff" weight="700">Look at the camera and say aloud:</T>
            <T size={22} weight="800" style={{ textAlign: 'center' }}>"My code is <T size={40} weight="900" color={C.pink}>{code}</T>"</T></View>
        </View>
        <View style={{ alignItems: 'center', paddingBottom: 30, gap: 14 }}>
          {rec && <T weight="800">● {secs}s</T>}
          {up ? <T weight="700">Uploading…</T> : (
            <Pressable onPress={rec ? () => ref.current?.stopRecording() : start} style={st.recBtn} accessibilityLabel={rec ? 'Stop recording' : 'Start recording'}>
              <View style={rec ? { width: 30, height: 30, borderRadius: 6, backgroundColor: C.bad } : { width: 56, height: 56, borderRadius: 28, backgroundColor: C.bad }} />
            </Pressable>
          )}
          {!rec && !up && <Pressable onPress={onClose}><T color="#fff">Cancel</T></Pressable>}
        </View>
      </Screen>
    </View>
  );
}

function VoiceRecorder({ name, onClose, onDone }: { name: string; onClose: () => void; onDone: () => void }) {
  const rec = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const [up, setUp] = useState(false);
  useEffect(() => { if (!on) return; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [on]);
  useEffect(() => { if (on && secs >= 20) stop(); }); // eslint-disable-line

  const begin = async () => {
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) return Alert.alert('Permission needed', 'Allow microphone access in Settings.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await rec.prepareToRecordAsync(); rec.record(); setOn(true);
  };
  const stop = async () => {
    if (!on) return;
    setOn(false);
    await rec.stop();
    if (secs < 4) return Alert.alert('Too short', 'Please speak for at least 5 seconds.');
    setUp(true);
    try { await api.upload('/listener/verification/voice', rec.uri!, 'voice.m4a', 'audio/mp4'); onDone(); }
    catch (e) { setUp(false); Alert.alert('Upload failed', e instanceof ApiError ? e.message : 'Try again.'); }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 18, alignItems: 'center' }}>
        <T size={26} weight="900" style={{ textAlign: 'center' }}>Say hi to your future callers</T>
        <Card><T color={C.mute}>Try something like:</T><T size={17} weight="600" style={{ marginTop: 6 }}>"Hi, I'm {name}! I love music and late-night talks. Call me and let's chat — I'd love to hear about your day."</T></Card>
        <T size={42} weight="900" color={on ? C.pink : C.mute}>{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</T>
        {up ? <T>Uploading…</T> : (
          <Pressable onPress={on ? stop : begin} style={[st.recBtn, { borderColor: C.pink }]} accessibilityLabel={on ? 'Stop' : 'Record'}>
            <Ionicons name={on ? 'stop' : 'mic'} size={36} color={C.pink} />
          </Pressable>
        )}
        {!on && !up && <Button title="Cancel" variant="ghost" onPress={onClose} style={{ alignSelf: 'stretch' }} />}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  vibe: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: C.line },
  codeBox: { backgroundColor: 'rgba(0,0,0,0.55)', padding: 16, borderRadius: 18, alignItems: 'center', gap: 4 },
  recBtn: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
