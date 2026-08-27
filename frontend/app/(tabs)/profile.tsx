import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { authenticate, isBiometricEnabled, isBiometricSupported, setBiometricEnabled } from '@/src/biometric';

export default function Profile() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabledState] = useState(false);

  useEffect(() => {
    (async () => {
      setBioSupported(await isBiometricSupported());
      setBioEnabledState(await isBiometricEnabled());
    })();
  }, []);

  async function toggleBio(next: boolean) {
    if (next) {
      const ok = await authenticate('Enable biometric unlock for TaxPilot');
      if (!ok) return;
    }
    await setBiometricEnabled(next);
    setBioEnabledState(next);
  }

  async function onSignOut() {
    await signOut();
    router.replace('/(auth)/onboarding');
  }

  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <View style={styles.root} testID="profile-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: THEME.surface }}>
        <View style={styles.header}><Text style={styles.title}>Profile</Text></View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
          <Text style={styles.name}>{user?.name || 'TaxPilot user'}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.rolePill}>
            <Ionicons name="shield-checkmark" size={12} color={THEME.brandPrimary} />
            <Text style={styles.roleText}>{(user?.role || 'preparer').toUpperCase()} · RBAC</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Security & Compliance</Text>
        <View style={styles.list}>
          {bioSupported && (
            <View style={styles.row}>
              <View style={styles.rowIcon}><Ionicons name="finger-print" size={18} color={THEME.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Biometric unlock</Text>
                <Text style={styles.rowSub}>Face ID / Touch ID unlocks a device-stored session. No templates leave your device.</Text>
              </View>
              <Switch value={bioEnabled} onValueChange={toggleBio} trackColor={{ true: THEME.brandPrimary, false: THEME.border }} thumbColor="#FFF" testID="bio-toggle" />
            </View>
          )}
          <Row icon="shield-checkmark" title="Compliance & Guardrails" sub="How TaxPilot stays safe: principles, boundary, audit" onPress={() => router.push('/compliance')} />
          <Row icon="lock-closed" title="WISP · Written Information Security Plan" sub="IRS Pub. 4557 aligned" />
          <Row icon="document-text" title="§7216 Consent" sub="Explicit consent captured per client" />
          <Row icon="git-network" title="Immutable audit log" sub="Every figure traces back to a source document" />
          <Row icon="cloud-done" title="Encryption at rest & in transit" sub="TLS 1.3 + AES-256" />
          <Row icon="time" title="Retention policy" sub="7-year default with defined deletion" />
          <Row icon="alert" title="Incident response plan" sub="24-hr client & FTC notification" />
        </View>

        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.list}>
          <Row icon="chatbubbles" title="Tax Assistant" sub="Source-grounded answers · refuses without authority" onPress={() => router.push('/chat')} />
          <Row icon="sparkles" title="Potential items" sub="Detected deductions & credits for your review" onPress={() => router.push('/deductions')} />
          <Row icon="play-circle" title="Interactive demo" sub="Walk through with sample data" onPress={() => router.push('/demo')} />
          <Row icon="cloud-upload" title="Upload document" sub="Camera, photos, or files" onPress={() => router.push('/upload')} />
        </View>

        <Pressable style={styles.signOutBtn} onPress={onSignOut} testID="signout-btn">
          <Ionicons name="log-out-outline" size={18} color={THEME.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        <Text style={styles.footer}>TaxPilot AI · Interactive demo · Sample data · No e-filing</Text>
      </ScrollView>
    </View>
  );
}

function Row({ icon, title, sub, onPress }: any) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={THEME.brandPrimary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={18} color={THEME.onSurfaceTertiary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: 24, fontWeight: '700', color: THEME.onSurface },
  content: { padding: SPACING.lg, paddingBottom: 120 },
  card: { alignItems: 'center', backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.xl, borderWidth: 1, borderColor: THEME.border },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: THEME.brandPrimary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  avatarText: { color: THEME.onBrandPrimary, fontSize: 28, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  email: { fontSize: 13, color: THEME.onSurfaceTertiary, marginTop: 2 },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: THEME.brandTertiary, paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill, marginTop: SPACING.md },
  roleText: { fontSize: 11, fontWeight: '700', color: THEME.brandPrimary, letterSpacing: 0.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, marginTop: SPACING.xl, marginBottom: SPACING.md, textTransform: 'uppercase' },
  list: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: THEME.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: THEME.border },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14, fontWeight: '600', color: THEME.onSurface },
  rowSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  signOutBtn: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.error + '55', marginTop: SPACING.xl, backgroundColor: THEME.surfaceSecondary },
  signOutText: { color: THEME.error, fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', color: THEME.onSurfaceTertiary, fontSize: 11, marginTop: SPACING.xl },
});
