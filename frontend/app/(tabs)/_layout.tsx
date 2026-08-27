import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { THEME } from '@/src/theme';
import { View, ActivityIndicator } from 'react-native';
import { LockScreen } from '@/src/components/LockScreen';

export default function TabsLayout() {
  const { user, loading, locked } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={THEME.brandPrimary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/onboarding" />;
  if (locked) return <LockScreen />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: THEME.brandPrimary,
        tabBarInactiveTintColor: THEME.onSurfaceTertiary,
        tabBarStyle: {
          backgroundColor: THEME.surfaceSecondary,
          borderTopColor: THEME.border,
          height: 78,
          paddingTop: 8,
          paddingBottom: 20,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: 'Home',
        tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
      }} />
      <Tabs.Screen name="documents" options={{
        title: 'Vault',
        tabBarIcon: ({ color, size }) => <Ionicons name="folder-open" size={size} color={color} />,
      }} />
      <Tabs.Screen name="review" options={{
        title: 'Review',
        tabBarIcon: ({ color, size }) => <Ionicons name="alert-circle" size={size} color={color} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profile',
        tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
      }} />
    </Tabs>
  );
}
