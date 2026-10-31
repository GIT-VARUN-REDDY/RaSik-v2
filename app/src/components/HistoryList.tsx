import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Empty, Header, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { C, inr, mmss } from '@/lib/theme';

type Row = { id: string; type: 'voice' | 'video'; status: string; seconds: number; coins: number; earnedPaise: number; createdAt: number; peerName: string; peerAvatar: string | null; outgoing: boolean };

export default function HistoryList({ earner }: { earner: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ref, setRef] = useState(false);
  const load = useCallback(async () => { try { setRows((await api.get<{ calls: Row[] }>('/calls')).calls); } catch { setRows((r) => r ?? []); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return (
    <Screen>
      <Header title={earner ? 'Your calls' : 'Recent'} />
      <FlatList data={rows ?? []} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={ref} tintColor={C.pink} onRefresh={async () => { setRef(true); await load(); setRef(false); }} />}
        ListEmptyComponent={rows === null ? undefined : <Empty icon="call-outline" title="No calls yet" sub={earner ? 'Go online from Home to receive calls.' : 'Your calls will show up here.'} />}
        renderItem={({ item: r }) => {
          const ok = r.status === 'completed';
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 12, borderRadius: 16 }}>
              <Avatar uri={r.peerAvatar} name={r.peerName} size={46} />
              <View style={{ flex: 1 }}>
                <T weight="800">{r.peerName}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Ionicons name={r.type === 'video' ? 'videocam' : 'call'} size={12} color={ok ? C.ok : C.bad} />
                  <T size={12} color={C.mute}>{ok ? mmss(r.seconds) : r.status === 'missed' ? 'Missed' : r.status === 'rejected' ? 'Declined' : 'Cancelled'} · {new Date(r.createdAt).toLocaleDateString()}</T>
                </View>
              </View>
              {ok ? <T weight="800" color={earner ? C.ok : '#fff'}>{earner ? `+${inr(r.earnedPaise)}` : `-${r.coins}🪙`}</T> : null}
            </View>
          );
        }} />
    </Screen>
  );
}
