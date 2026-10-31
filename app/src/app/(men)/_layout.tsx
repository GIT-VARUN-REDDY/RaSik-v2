import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/lib/theme';

export default function MenTabs() {
  const icon = (n: keyof typeof Ionicons.glyphMap, f: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: any; focused: boolean }) => <Ionicons name={focused ? f : n} size={25} color={color} />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: C.pink, tabBarInactiveTintColor: C.mute, tabBarStyle: { backgroundColor: C.card, borderTopColor: C.line, height: 62, paddingBottom: 8, paddingTop: 6 }, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarIcon: icon('heart-outline', 'heart') }} />
      <Tabs.Screen name="wallet" options={{ title: 'Coins', tabBarIcon: icon('wallet-outline', 'wallet') }} />
      <Tabs.Screen name="history" options={{ title: 'Recent', tabBarIcon: icon('time-outline', 'time') }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
