import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '@/src/auth';
import { THEME } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.loading} testID="root-loading">
        <ActivityIndicator size="large" color={THEME.brandPrimary} />
      </View>
    );
  }
  return user ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/onboarding" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: THEME.surface, alignItems: 'center', justifyContent: 'center' },
});
