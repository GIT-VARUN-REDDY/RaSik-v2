import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';
import { C } from '@/lib/theme';

export default function Index() {
  const { ready, me } = useSession();

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.pink} size="large" />
      </View>
    );
  }

  if (!me) {
    return <Redirect href="/(auth)/phone" />;
  }

  if (!me.onboarded) {
    return <Redirect href="/onboarding" />;
  }

  if (me.gender === 'female') {
    if (me.listener?.approval !== 'approved') {
      return <Redirect href="/verify" />;
    }
    return <Redirect href="/(women)" />;
  }

  return <Redirect href="/(men)" />;
}
