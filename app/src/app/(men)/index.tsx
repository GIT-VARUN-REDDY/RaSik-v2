import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Empty, Screen, T } from '@/components/ui';
import { ListenerCard } from '@/components/ListenerCard';
import { api, ListenerCardT } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRealtime } from '@/lib/realtime';
import { C, STYLE_META, StyleKey } from '@/lib/theme';

type Tab = 'all' | StyleKey | 'favs';

export default function Discover() {
  const { me } = useSession();
  const { subscribePresence, connected } = useRealtime();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('all');
  const [offline, setOffline] = useState(false);
  const [list, setList] = useState<ListenerCardT[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cw = (width - 16 * 2 - 12) / 2;
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (tab === 'favs') q.set('favorites', '1'); else if (tab !== 'all') q.set('style', tab);
    q.set('online', offline ? '0' : '1');
    try { setList((await api.get<{ listeners: ListenerCardT[] }>(`/listeners?${q}`)).listeners); } catch { setList((l) => l ?? []); }
  }, [tab, offline]);

  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]));
  useEffect(() => subscribePresence(() => { if (debounce.current) clearTimeout(debounce.current); debounce.current = setTimeout(load, 600); }), [subscribePresence, load]);
  useEffect(() => { if (connected) load(); }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { k: Tab; label: string; emoji: string; colors: readonly [string, string] }[] = [
    { k: 'all', label: 'All', emoji: '✨', colors: ['#6a5acd', '#4b3bd6'] },
    ...(Object.keys(STYLE_META) as StyleKey[]).map((k) => ({ k, label: STYLE_META[k].label, emoji: STYLE_META[k].emoji, colors: STYLE_META[k].colors })),
    { k: 'favs', label: 'Favourites', emoji: '❤️', colors: ['#444', '#222'] },
  ];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 10 }}>
        <View style={{ flex: 1 }}><T color={C.mute} size={13}>Hi {me?.name} 👋</T><T size={24} weight="900">Who do you want to talk to?</T></View>
        <Pressable onPress={() => router.push('/wallet')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: C.line }} accessibilityLabel={`${me?.coins} coins`}>
          <T>🪙</T><T weight="800">{me?.coins ?? 0}</T>
        </Pressable>
      </View>
      <View style={{ height: 96, marginTop: 12 }}>
        <FlatList horizontal data={tabs} keyExtractor={(t) => t.k} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => setTab(item.k)} style={{ opacity: tab === item.k ? 1 : 0.6 }}>
              <LinearGradient colors={item.colors as unknown as [string, string]} style={{ width: 112, height: 84, borderRadius: 20, padding: 10, justifyContent: 'space-between', borderWidth: 2, borderColor: tab === item.k ? '#fff' : 'transparent' }}>
                <T size={26}>{item.emoji}</T><T weight="800" size={13}>{item.label}</T>
              </LinearGradient>
            </Pressable>
          )} />
      </View>
      <FlatList
        data={list ?? []} numColumns={2} keyExtractor={(l) => l.id}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }} contentContainerStyle={{ gap: 12, paddingBottom: 24, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.pink} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={<Pressable onPress={() => setOffline((o) => !o)} style={{ paddingHorizontal: 18, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={offline ? 'checkbox' : 'square-outline'} size={18} color={C.mute} /><T color={C.mute} size={13}>Show offline too</T>
        </Pressable>}
        ListEmptyComponent={list === null ? undefined : <Empty icon="moon-outline" title={tab === 'favs' ? 'No favourites yet' : 'Nobody online right now'} sub={tab === 'favs' ? 'Tap the heart on a profile to save her here.' : 'Pull down to refresh, or tick "Show offline too".'} />}
        renderItem={({ item }) => <ListenerCard l={item} width={cw} onPress={() => router.push({ pathname: '/listener/[id]', params: { id: item.id } })} />}
      />
    </Screen>
  );
}
