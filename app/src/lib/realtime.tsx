/**
 * Realtime provider: one WebSocket for presence + call signaling, and the WebRTC call engine.
 * The server owns billing; this file only shows what the server reports.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Permission, PermissionsAndroid, Platform, Vibration } from 'react-native';
import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api, getAccessToken, WS_URL } from './api';
import { useSession } from './session';

export type Peer = { id: string; name: string; avatar: string | null };
export type ChatMsg = { id: string; from: string; text: string; at: number };
export type CallState = {
  id: string; type: 'voice' | 'video'; role: 'caller' | 'callee'; peer: Peer | null;
  phase: 'ringing' | 'connecting' | 'active' | 'ended';
  startedAtLocal: number | null; minutes: number; rate: number; coins: number; balance: number | null; earnedPaise: number;
  micOn: boolean; camOn: boolean; speakerOn: boolean; peerMic: boolean; peerCam: boolean;
  local: MediaStream | null; remote: MediaStream | null;
  messages: ChatMsg[]; lowBalance: { secondsLeft: number } | null; notice: string | null;
  end?: { reason: string; seconds: number; coins: number; balance?: number; earnedPaise?: number };
};
export type Incoming = { callId: string; type: 'voice' | 'video'; from: Peer & { age?: number }; earnPerMinPaise: number; ringSeconds: number };
type Result = { ok: true } | { ok: false; code: string; message: string };

type Ctx = {
  connected: boolean; incoming: Incoming | null; call: CallState | null;
  requestCall: (listenerId: string, type: 'voice' | 'video') => Promise<Result>;
  accept: () => Promise<void>; reject: () => void; hangup: () => void; dismissCall: () => void;
  toggleMic: () => void; toggleCam: () => void; flipCamera: () => void; toggleSpeaker: () => void; sendChat: (t: string) => void;
  subscribePresence: (fn: (listenerId: string, state: string) => void) => () => void;
};
const RT = createContext<Ctx>(null as never);
export const useRealtime = () => useContext(RT);

const ICE_EXPLAIN: Record<string, string> = {
  insufficient_coins: 'Your coins ran out.', no_answer: 'No answer.', rejected: 'Call declined.', cancelled: 'Call cancelled.',
  peer_disconnected: 'Connection lost.', connect_failed: 'Could not connect. Check your internet.', caller_hangup: 'Call ended.', listener_hangup: 'Call ended.',
};
export const endReasonText = (r: string) => ICE_EXPLAIN[r] ?? 'Call ended.';

async function ensureMedia(video: boolean) {
  if (Platform.OS === 'android') {
    const permissions: Permission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (video) permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    const results = await PermissionsAndroid.requestMultiple(permissions);
    if (results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) return false;
    if (video && results[PermissionsAndroid.PERMISSIONS.CAMERA] !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  return true;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { me, setCoins } = useSession();
  const enabled = !!me?.onboarded && (me.gender === 'male' || me.listener?.approval === 'approved');

  const [connected, setConnected] = useState(false);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [call, _setCall] = useState<CallState | null>(null);
  const callRef = useRef<CallState | null>(null);
  const setCall = useCallback((u: CallState | null | ((c: CallState | null) => CallState | null)) => {
    const next = typeof u === 'function' ? u(callRef.current) : u;
    callRef.current = next; _setCall(next);
  }, []);

  const ws = useRef<WebSocket | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const iceQueue = useRef<unknown[]>([]);
  const sigQueue = useRef<Array<Record<string, any>>>([]);
  const reported = useRef(false);
  const pending = useRef(new Map<number, (r: Result) => void>());
  const refSeq = useRef(1);
  const presenceSubs = useRef(new Set<(id: string, s: string) => void>());
  const incomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meRef = useRef(me); meRef.current = me;

  const send = useCallback((m: object) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m)); }, []);

  // ---------------------------------------------------------------- media / peer connection
  const stopRing = () => { try { InCallManager.stopRingtone(); } catch {} Vibration.cancel(); if (incomingTimer.current) clearTimeout(incomingTimer.current); };

  const cleanupMedia = useCallback(() => {
    try { pc.current?.close(); } catch {}
    pc.current = null;
    stream.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    stream.current = null; iceQueue.current = []; sigQueue.current = []; reported.current = false;
    try { InCallManager.stop(); } catch {}
  }, []);

  const handleSignal = useCallback(async (data: any) => {
    const p = pc.current;
    if (!p) { sigQueue.current.push(data); return; }
    try {
      if (data.sdp) {
        await p.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of iceQueue.current) await p.addIceCandidate(new RTCIceCandidate(c as any));
        iceQueue.current = [];
        if (data.sdp.type === 'offer') {
          const answer = await p.createAnswer();
          await p.setLocalDescription(answer);
          send({ t: 'call:signal', callId: callRef.current?.id, data: { sdp: answer } });
        }
      } else if (data.candidate) {
        if (p.remoteDescription) await p.addIceCandidate(new RTCIceCandidate(data.candidate));
        else iceQueue.current.push(data.candidate);
      }
    } catch (e) { console.warn('[webrtc] signal error', e); }
  }, [send]);

  const startMedia = useCallback(async (m: { callId: string; role: 'caller' | 'callee'; type: 'voice' | 'video'; iceServers: any[] }) => {
    const video = m.type === 'video';
    if (!(await ensureMedia(video))) {
      send({ t: 'call:end', callId: m.callId });
      setCall((c) => (c ? { ...c, phase: 'ended', end: { reason: 'permission', seconds: 0, coins: 0 }, notice: 'Allow microphone' + (video ? ' and camera' : '') + ' access in Settings to make calls.' } : c));
      return;
    }
    try {
      InCallManager.start({ media: video ? 'video' : 'audio' });
      InCallManager.setForceSpeakerphoneOn(video);
      const s = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as any,
        video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } : false,
      });
      stream.current = s;
      const p = new RTCPeerConnection({ iceServers: m.iceServers, bundlePolicy: 'max-bundle' });
      pc.current = p;
      s.getTracks().forEach((t) => p.addTrack(t, s));
      (p as any).addEventListener('icecandidate', (e: any) => { if (e.candidate) send({ t: 'call:signal', callId: m.callId, data: { candidate: e.candidate } }); });
      (p as any).addEventListener('track', (e: any) => { const rs: MediaStream | undefined = e.streams?.[0]; if (rs) setCall((c) => (c ? { ...c, remote: rs } : c)); });
      (p as any).addEventListener('connectionstatechange', () => {
        const st = p.connectionState;
        if (st === 'connected' && !reported.current) { reported.current = true; send({ t: 'call:connected', callId: m.callId }); }
        if (st === 'disconnected' || st === 'failed') { try { (p as any).restartIce?.(); } catch {} }
      });
      setCall((c) => (c ? { ...c, local: s, camOn: video, micOn: true, speakerOn: video } : c));
      if (m.role === 'caller') {
        const offer = await p.createOffer({});
        await p.setLocalDescription(offer);
        send({ t: 'call:signal', callId: m.callId, data: { sdp: offer } });
      }
      const queued = sigQueue.current; sigQueue.current = [];
      for (const d of queued) await handleSignal(d);
    } catch (e) {
      console.warn('[webrtc] startMedia failed', e);
      send({ t: 'call:end', callId: m.callId });
    }
  }, [send, setCall, handleSignal]);

  // ---------------------------------------------------------------- socket message handling
  const onMessage = useCallback((m: any) => {
    switch (m.t) {
      case 'auth:ok': setConnected(true); setCoins(m.coins); break;
      case 'wallet': setCoins(m.coins); setCall((c) => (c && c.phase !== 'ended' ? { ...c, balance: m.coins, lowBalance: null } : c)); break;
      case 'presence': presenceSubs.current.forEach((f) => f(m.listenerId, m.state)); break;
      case 'error': {
        const r = m.ref != null ? pending.current.get(m.ref) : undefined;
        if (r) { pending.current.delete(m.ref); r({ ok: false, code: m.code, message: m.message }); }
        else setCall((c) => (c ? { ...c, notice: m.message } : c));
        break;
      }
      case 'call:ringing': {
        setCall({ id: m.callId, type: m.type, role: 'caller', peer: m.peer, phase: 'ringing', startedAtLocal: null, minutes: 0, rate: m.rate, coins: 0, balance: meRef.current?.coins ?? null, earnedPaise: 0, micOn: true, camOn: m.type === 'video', speakerOn: m.type === 'video', peerMic: true, peerCam: true, local: null, remote: null, messages: [], lowBalance: null, notice: null });
        const r = pending.current.get(m.ref); if (r) { pending.current.delete(m.ref); r({ ok: true }); }
        break;
      }
      case 'call:incoming': {
        if (callRef.current && callRef.current.phase !== 'ended') return;
        setIncoming(m);
        try { InCallManager.startRingtone('_DEFAULT_', 0, 'playback', 40); } catch {}
        Vibration.vibrate([0, 800, 600], true);
        if (incomingTimer.current) clearTimeout(incomingTimer.current);
        incomingTimer.current = setTimeout(() => { stopRing(); setIncoming(null); }, (m.ringSeconds + 2) * 1000);
        break;
      }
      case 'call:accepted':
        setCall((c) => (c ? { ...c, role: m.role, peer: m.peer, phase: 'connecting' } : c));
        startMedia(m);
        break;
      case 'call:signal': handleSignal(m.data); break;
      case 'call:started':
        setCall((c) => (c ? { ...c, phase: 'active', startedAtLocal: Date.now(), minutes: m.minutes, rate: m.rate, coins: m.coins ?? c.coins, balance: m.balance ?? c.balance, earnedPaise: m.earnedPaise ?? c.earnedPaise } : c));
        break;
      case 'call:resume':
        setCall((c) => (c ? { ...c, phase: 'active', startedAtLocal: Date.now() - m.elapsedMs, minutes: m.minutes } : c));
        break;
      case 'call:billed':
        setCall((c) => (c ? { ...c, minutes: m.minutes, coins: m.coins ?? c.coins, balance: m.balance ?? c.balance, earnedPaise: m.earnedPaise ?? c.earnedPaise, lowBalance: null } : c));
        if (m.balance != null) setCoins(m.balance);
        break;
      case 'call:low_balance': setCall((c) => (c ? { ...c, lowBalance: { secondsLeft: m.secondsLeft } } : c)); break;
      case 'call:peer_state': setCall((c) => (c ? { ...c, peerMic: m.mic, peerCam: m.cam } : c)); break;
      case 'call:chat': setCall((c) => (c ? { ...c, messages: [...c.messages.slice(-30), { id: `${m.at}${m.from}`, from: m.from, text: m.text, at: m.at }] } : c)); break;
      case 'call:ended': {
        stopRing(); setIncoming((i) => (i && i.callId === m.callId ? null : i));
        const had = callRef.current;
        if (!had || had.id !== m.callId) break;
        cleanupMedia();
        if (m.balance != null) setCoins(m.balance);
        setCall({ ...had, phase: 'ended', local: null, remote: null, end: { reason: m.reason, seconds: m.seconds, coins: m.coins, balance: m.balance, earnedPaise: m.earnedPaise } });
        break;
      }
    }
  }, [setCoins, setCall, startMedia, handleSignal, cleanupMedia]);

  // ---------------------------------------------------------------- connection lifecycle
  useEffect(() => {
    if (!enabled) return;
    let closed = false, attempt = 0, hb: ReturnType<typeof setInterval> | null = null, retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      if (closed) return;
      const token = getAccessToken();
      if (!token) { retry = setTimeout(open, 1500); return; }
      const sock = new WebSocket(WS_URL);
      ws.current = sock;
      sock.onopen = () => { attempt = 0; sock.send(JSON.stringify({ t: 'auth', token })); };
      sock.onmessage = (e) => { try { onMessage(JSON.parse(String(e.data))); } catch {} };
      sock.onclose = () => {
        setConnected(false);
        if (hb) clearInterval(hb);
        if (!closed) retry = setTimeout(open, Math.min(15000, 600 * 2 ** attempt++));
      };
      sock.onerror = () => {};
      hb = setInterval(() => { if (sock.readyState === 1) sock.send('{"t":"ping"}'); }, 20000);
    };
    open();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && ws.current?.readyState !== 1) { if (retry) clearTimeout(retry); attempt = 0; open(); } });
    return () => { closed = true; sub.remove(); if (hb) clearInterval(hb); if (retry) clearTimeout(retry); ws.current?.close(); ws.current = null; setConnected(false); };
  }, [enabled, onMessage]);

  // Push token (lets the server wake a listener who has the app in the background).
  useEffect(() => {
    if (!me?.onboarded) return;
    (async () => {
      try {
        if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('calls', { name: 'Calls', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 500, 300, 500] });
        const perm = await Notifications.requestPermissionsAsync();
        if (!perm.granted) return;
        const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
        const tok = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        await api.post('/me/push-token', { token: tok.data });
      } catch {}
    })();
  }, [me?.id, me?.onboarded]);

  // ---------------------------------------------------------------- actions
  const value = useMemo<Ctx>(() => ({
    connected, incoming, call,
    requestCall: (listenerId, type) => new Promise<Result>((resolve) => {
      if (ws.current?.readyState !== 1) return resolve({ ok: false, code: 'offline', message: 'Connecting… please try again in a moment.' });
      const ref = refSeq.current++;
      pending.current.set(ref, resolve);
      send({ t: 'call:request', listenerId, type, ref });
      setTimeout(() => { if (pending.current.delete(ref)) resolve({ ok: false, code: 'timeout', message: 'No response. Try again.' }); }, 8000);
    }),
    accept: async () => {
      const inc = incoming; if (!inc) return;
      stopRing(); setIncoming(null);
      setCall({ id: inc.callId, type: inc.type, role: 'callee', peer: inc.from, phase: 'connecting', startedAtLocal: null, minutes: 0, rate: 0, coins: 0, balance: null, earnedPaise: 0, micOn: true, camOn: inc.type === 'video', speakerOn: inc.type === 'video', peerMic: true, peerCam: true, local: null, remote: null, messages: [], lowBalance: null, notice: null });
      send({ t: 'call:accept', callId: inc.callId });
    },
    reject: () => { if (incoming) send({ t: 'call:reject', callId: incoming.callId }); stopRing(); setIncoming(null); },
    hangup: () => {
      const c = callRef.current; if (!c || c.phase === 'ended') return;
      send({ t: c.phase === 'ringing' ? 'call:cancel' : 'call:end', callId: c.id });
    },
    dismissCall: () => { cleanupMedia(); setCall(null); },
    toggleMic: () => {
      const c = callRef.current; if (!c) return; const on = !c.micOn;
      stream.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
      setCall({ ...c, micOn: on }); send({ t: 'call:mute_state', callId: c.id, mic: on, cam: c.camOn });
    },
    toggleCam: () => {
      const c = callRef.current; if (!c || c.type !== 'video') return; const on = !c.camOn;
      stream.current?.getVideoTracks().forEach((t) => { t.enabled = on; });
      setCall({ ...c, camOn: on }); send({ t: 'call:mute_state', callId: c.id, mic: c.micOn, cam: on });
    },
    flipCamera: () => { (stream.current?.getVideoTracks()[0] as any)?._switchCamera?.(); },
    toggleSpeaker: () => {
      const c = callRef.current; if (!c) return; const on = !c.speakerOn;
      try { InCallManager.setForceSpeakerphoneOn(on); } catch {}
      setCall({ ...c, speakerOn: on });
    },
    sendChat: (text) => { const c = callRef.current; if (c && c.phase === 'active' && text.trim()) send({ t: 'call:chat', callId: c.id, text: text.trim() }); },
    subscribePresence: (fn) => { presenceSubs.current.add(fn); return () => { presenceSubs.current.delete(fn); }; },
  }), [connected, incoming, call, send, setCall, cleanupMedia]);

  return <RT.Provider value={value}>{children}</RT.Provider>;
}
