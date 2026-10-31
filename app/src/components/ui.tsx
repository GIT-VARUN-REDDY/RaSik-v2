import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, GRAD, R } from '@/lib/theme';

export const Screen = ({ children, style, edges = ['top'] }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom')[] }) => (
  <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: C.bg }, style]}>{children}</SafeAreaView>
);

export const T = ({ children, style, size = 15, weight = '400', color = C.ink, numberOfLines }: { children: React.ReactNode; style?: StyleProp<TextStyle>; size?: number; weight?: TextStyle['fontWeight']; color?: string; numberOfLines?: number }) => (
  <Text numberOfLines={numberOfLines} style={[{ fontSize: size, fontWeight: weight, color }, style]}>{children}</Text>
);

export function Button({ title, onPress, loading, disabled, variant = 'primary', icon, style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost' | 'danger' | 'dark'; icon?: keyof typeof Ionicons.glyphMap; style?: StyleProp<ViewStyle> }) {
  const off = disabled || loading;
  const inner = (
    <View style={s.btnInner}>
      {loading ? <ActivityIndicator color="#fff" /> : (<>
        {icon && <Ionicons name={icon} size={20} color="#fff" style={{ marginRight: 8 }} />}
        <Text style={s.btnText}>{title}</Text>
      </>)}
    </View>
  );
  return (
    <Pressable onPress={off ? undefined : onPress} style={({ pressed }) => [{ opacity: off ? 0.5 : pressed ? 0.85 : 1 }, style]} accessibilityRole="button" accessibilityLabel={title}>
      {variant === 'primary' ? <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>{inner}</LinearGradient>
        : <View style={[s.btn, variant === 'danger' ? { backgroundColor: C.bad } : variant === 'dark' ? { backgroundColor: C.card2 } : { borderWidth: 1, borderColor: C.line }]}>{inner}</View>}
    </Pressable>
  );
}

export const Chip = ({ label, selected, onPress, emoji }: { label: string; selected?: boolean; onPress?: () => void; emoji?: string }) => (
  <Pressable onPress={onPress} style={[s.chip, selected && { backgroundColor: C.pink, borderColor: C.pink }]} accessibilityRole="button" accessibilityState={{ selected: !!selected }}>
    <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>{emoji ? `${emoji} ` : ''}{label}</Text>
  </Pressable>
);

export function Avatar({ uri, name, size = 48 }: { uri?: string | null; name?: string | null; size?: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.card2 }} />;
  return (
    <LinearGradient colors={GRAD} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>{(name || '?').trim().charAt(0).toUpperCase()}</Text>
    </LinearGradient>
  );
}

export const StateDot = ({ state }: { state: 'online' | 'busy' | 'offline' }) => (
  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: state === 'online' ? C.ok : state === 'busy' ? C.gold : '#777', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.4)' }} />
);

export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[{ backgroundColor: C.card, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.line }, style]}>{children}</View>;

export const Empty = ({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string }) => (
  <View style={{ alignItems: 'center', padding: 40, gap: 8 }}>
    <Ionicons name={icon} size={48} color={C.mute} />
    <T size={17} weight="700">{title}</T>
    {sub ? <T color={C.mute} style={{ textAlign: 'center' }}>{sub}</T> : null}
  </View>
);

export const Stars = ({ value, size = 14 }: { value: number | null; size?: number }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
    <Ionicons name="star" size={size} color={C.gold} />
    <Text style={{ color: '#fff', fontWeight: '700', fontSize: size }}>{value ? value.toFixed(1) : 'New'}</Text>
  </View>
);

export const Header = ({ title, right, onBack }: { title: string; right?: React.ReactNode; onBack?: () => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
    {onBack && <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back"><Ionicons name="chevron-back" size={26} color="#fff" /></Pressable>}
    <T size={24} weight="800" style={{ flex: 1 }}>{title}</T>
    {right}
  </View>
);

const s = StyleSheet.create({
  btn: { height: 54, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
});
