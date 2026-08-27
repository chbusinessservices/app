import { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { THEME, SPACING, RADIUS } from '@/src/theme';

export function LockScreen() {
  const { user, unlock, signOut } = useAuth();

  useEffect(() => {
    // Auto-prompt on mount
    unlock();
  }, [unlock]);

  return (
    <View style={styles.root} testID="lock-screen">
      <View style={styles.icon}><Ionicons name="finger-print" size={56} color={THEME.brandPrimary} /></View>
      <Text style={styles.title}>TaxPilot is locked</Text>
      <Text style={styles.sub}>Unlock with Face ID or Touch ID to continue.{user?.email ? `\nSigned in as ${user.email}` : ''}</Text>
      <Pressable style={styles.btn} onPress={unlock} testID="unlock-btn">
        <Ionicons name="lock-open" size={18} color={THEME.onBrandPrimary} />
        <Text style={styles.btnText}>Unlock</Text>
      </Pressable>
      <Pressable style={styles.signOut} onPress={signOut} testID="lock-signout">
        <Text style={styles.signOutText}>Sign out instead</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  icon: { width: 96, height: 96, borderRadius: 48, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  title: { fontSize: 22, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.sm },
  sub: { fontSize: 14, color: THEME.onSurfaceTertiary, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xl },
  btn: { flexDirection: 'row', gap: SPACING.sm, backgroundColor: THEME.brandPrimary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center' },
  btnText: { color: THEME.onBrandPrimary, fontSize: 15, fontWeight: '600' },
  signOut: { marginTop: SPACING.xl },
  signOutText: { color: THEME.onSurfaceTertiary, fontSize: 13, fontWeight: '500' },
});
