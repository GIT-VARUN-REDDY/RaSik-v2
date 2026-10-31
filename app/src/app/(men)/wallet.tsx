import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { Button, Card, Header, Screen, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';

type Pack = { id: string; priceInr: number; coins: number; tag: string };
type Tx = { id: string; kind: string; coins: number; amountPaise: number; createdAt: number };
const KIND: Record<string, string> = { recharge: 'Coins purchased', call: 'Call', welcome: 'Welcome bonus', admin_credit: 'Credit from support' };

export default function Wallet() {
  const { me, setCoins } = useSession();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [history, setHistory] = useState<Tx[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const w = await api.get<{ coins: number; packs: Pack[]; history: Tx[] }>('/wallet'); setPacks(w.packs); setHistory(w.history); setCoins(w.coins); } catch {}
  }, [setCoins]);
  useEffect(() => { load(); }, [load]);

  const buy = async (p: Pack) => {
    setBusy(p.id);
    try {
      const o = await api.post<{ orderId: string; payUrl: string }>('/wallet/orders', { packId: p.id });
      await WebBrowser.openBrowserAsync(o.payUrl);
      // Payment is confirmed server-side (webhook); poll briefly for the credit.
      for (let i = 0; i < 6; i++) {
        const s = await api.get<{ status: string }>(`/wallet/orders/${o.orderId}`);
        if (s.status === 'paid') { await load(); Alert.alert('Coins added 🎉', `${p.coins} coins are in your wallet.`); break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
      await load();
    } catch (e) { Alert.alert('Payment', e instanceof ApiError ? e.message : 'Try again.'); }
    setBusy(null);
  };

  return (
    <Screen>
      <Header title="Coins" />
      <FlatList data={history} keyExtractor={(t) => t.id} contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={<View style={{ gap: 16, marginBottom: 6 }}>
          <LinearGradient colors={['#ff4d8d', '#ff7a59']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 22 }}>
            <T color="rgba(255,255,255,0.85)">Your balance</T><T size={44} weight="900">🪙 {me?.coins ?? 0}</T>
          </LinearGradient>
          <T size={18} weight="800">Get more coins</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {packs.map((p) => (
              <Pressable key={p.id} onPress={busy ? undefined : () => buy(p)} style={{ width: '48%', opacity: busy && busy !== p.id ? 0.5 : 1 }} accessibilityLabel={`Buy ${p.coins} coins for ${p.priceInr} rupees`}>
                <Card style={{ alignItems: 'center', gap: 4, paddingVertical: 18, borderColor: p.tag ? C.pink : C.line }}>
                  {p.tag ? <View style={{ position: 'absolute', top: -10, backgroundColor: C.pink, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 99 }}><T size={11} weight="800">{p.tag}</T></View> : null}
                  <T size={26} weight="900">🪙 {p.coins}</T>
                  <T color={C.mute} size={13}>{Math.floor(p.coins / 5)}+ min voice</T>
                  <View style={{ marginTop: 6, backgroundColor: C.card2, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 99 }}><T weight="800">{busy === p.id ? '…' : `₹${p.priceInr}`}</T></View>
                </Card>
              </Pressable>
            ))}
          </View>
          <T size={12} color={C.mute}>Payments are processed securely by Razorpay (UPI, cards, netbanking, wallets). Coins are non-refundable once purchased.</T>
          {history.length > 0 && <T size={18} weight="800" style={{ marginTop: 6 }}>History</T>}
        </View>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View><T weight="600">{KIND[item.kind] ?? item.kind}</T><T size={12} color={C.mute}>{new Date(item.createdAt).toLocaleString()}</T></View>
            <T weight="800" color={item.coins > 0 ? C.ok : '#fff'}>{item.coins > 0 ? '+' : ''}{item.coins}</T>
          </View>
        )} />
    </Screen>
  );
}
