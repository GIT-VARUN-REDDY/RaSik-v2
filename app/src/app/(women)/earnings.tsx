import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Button, Card, Header, Screen, T } from '@/components/ui';
import { api, ApiError, ListenerSelf } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C, inr } from '@/lib/theme';

type E = { balancePaise: number; lifetimePaise: number; minPayoutPaise: number; upiId: string | null; payouts: { id: string; amountPaise: number; upiId: string; status: string; note: string | null; createdAt: number }[] };
const STATUS: Record<string, [string, string]> = { requested: ['Processing', C.gold], paid: ['Paid', C.ok], rejected: ['Rejected (refunded)', C.bad] };

export default function Earnings() {
  const { me, patch } = useSession();
  const [e, setE] = useState<E | null>(null);
  const [upi, setUpi] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const r = await api.get<E>('/listener/earnings'); setE(r); setUpi((u) => u || r.upiId || ''); } catch {} }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!e || !me) return <Screen><View /></Screen>;

  const can = e.balancePaise >= e.minPayoutPaise;
  const saveUpi = async () => {
    try { const r = await api.put<ListenerSelf>('/listener/settings', { upiId: upi.trim() }); patch({ ...me, listener: r }); await load(); Alert.alert('UPI ID saved ✓'); }
    catch (x) { Alert.alert('Invalid UPI ID', x instanceof ApiError ? x.message : 'Try again.'); }
  };
  const withdraw = async () => {
    setBusy(true);
    try { await api.post('/listener/payouts', { amountPaise: e.balancePaise }); await load(); Alert.alert('Withdrawal requested 🎉', 'Money reaches your UPI within 24 hours.'); }
    catch (x) { Alert.alert('Cannot withdraw', x instanceof ApiError ? x.message : 'Try again.'); }
    setBusy(false);
  };

  return (
    <Screen>
      <Header title="Earnings" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={['#1fa971', '#0f7a52']} style={{ borderRadius: 24, padding: 22 }}>
          <T color="rgba(255,255,255,0.85)">Available to withdraw</T>
          <T size={44} weight="900">{inr(e.balancePaise)}</T>
          <T color="rgba(255,255,255,0.8)" size={13}>Lifetime earnings {inr(e.lifetimePaise)}</T>
        </LinearGradient>
        <Card style={{ gap: 10 }}>
          <T weight="800">UPI ID for payouts</T>
          <TextInput value={upi} onChangeText={setUpi} autoCapitalize="none" placeholder="yourname@okaxis" placeholderTextColor="#6f6280" style={{ backgroundColor: C.card2, color: '#fff', borderRadius: 12, height: 48, paddingHorizontal: 14, fontSize: 16 }} />
          {upi.trim() !== (e.upiId ?? '') && <Button title="Save UPI ID" variant="dark" onPress={saveUpi} />}
        </Card>
        <Button title={can ? `Withdraw ${inr(e.balancePaise)}` : `Minimum withdrawal ${inr(e.minPayoutPaise)}`} onPress={withdraw} disabled={!can || !e.upiId} loading={busy} />
        {!e.upiId && <T color={C.mute} size={12} style={{ textAlign: 'center' }}>Save your UPI ID to withdraw.</T>}
        {e.payouts.length > 0 && <T size={18} weight="800">Withdrawals</T>}
        {e.payouts.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View><T weight="700">{inr(p.amountPaise)}</T><T size={12} color={C.mute}>{new Date(p.createdAt).toLocaleDateString()} · {p.upiId}</T></View>
            <T weight="800" color={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0] ?? p.status}</T>
          </View>
        ))}
        <T size={11} color={C.mute}>Payouts are subject to applicable taxes (TDS) as required by Indian law.</T>
      </ScrollView>
    </Screen>
  );
}
