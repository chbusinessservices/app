import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Prefs = {
  tax_year: number;
  cpa_email: string | null;
  consent_7216: boolean;
  consent_7216_at: string | null;
  consent_7216_revoked_at: string | null;
};

export default function Consent() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [signedName, setSignedName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPrefs(await api<Prefs>('/preferences')); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function sign() {
    setErr(null);
    if (!signedName.trim()) { setErr('Enter your full legal name to sign.'); return; }
    if (!accepted) { setErr('You must accept the consent terms to sign.'); return; }
    setBusy(true);
    try {
      const p = await api<Prefs>('/consent/7216', { method: 'POST', body: JSON.stringify({ signed_name: signedName.trim(), accept: true }) });
      setPrefs(p); setSignedName(''); setAccepted(false);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function revoke() {
    setBusy(true);
    try { setPrefs(await api<Prefs>('/consent/7216/revoke', { method: 'POST' })); } catch {}
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="consent-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>§7216 Consent</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={[styles.statusCard, prefs?.consent_7216 && styles.statusCardOk]}>
              <Ionicons
                name={prefs?.consent_7216 ? 'checkmark-circle' : 'time'}
                size={22}
                color={prefs?.consent_7216 ? THEME.success : THEME.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>{prefs?.consent_7216 ? 'Consent on file' : 'No consent captured yet'}</Text>
                <Text style={styles.statusSub}>
                  {prefs?.consent_7216
                    ? `Signed ${prefs.consent_7216_at?.slice(0, 10)}`
                    : 'TaxPilot cannot share your tax data with third parties without your explicit consent.'}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>What is §7216?</Text>
            <View style={styles.card}>
              <Text style={styles.cardText}>
                IRC §7216 restricts a tax preparer from using or disclosing a taxpayer's return information without written consent for anything other than preparing the return. TaxPilot AI treats itself as bound by this rule.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>What you're consenting to</Text>
            <View style={styles.card}>
              <Bullet text="TaxPilot may process your tax documents (W-2, 1099, K-1, receipts) to classify, extract fields, and draft a return." />
              <Bullet text="TaxPilot may route flagged items to a human reviewer within TaxPilot for verification." />
              <Bullet text="TaxPilot will NOT sell, share, or use your data for advertising, credit decisions, or model training." />
              <Bullet text="You may revoke consent at any time. Revocation stops new processing; existing audit records are retained per policy." />
            </View>

            {prefs?.consent_7216 ? (
              <>
                <View style={styles.signedCard}>
                  <Ionicons name="pencil" size={16} color={THEME.brandPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.signedLabel}>Signed on file</Text>
                    <Text style={styles.signedTime}>{prefs.consent_7216_at}</Text>
                  </View>
                </View>
                <Pressable style={styles.revokeBtn} onPress={revoke} disabled={busy} testID="revoke-btn">
                  {busy ? <ActivityIndicator color={THEME.error} /> : (
                    <>
                      <Ionicons name="close-circle" size={16} color={THEME.error} />
                      <Text style={styles.revokeText}>Revoke consent</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Sign consent</Text>
                <Text style={styles.label}>Your full legal name</Text>
                <TextInput
                  style={styles.input}
                  value={signedName}
                  onChangeText={setSignedName}
                  placeholder="e.g. Jane A. Doe"
                  placeholderTextColor={THEME.onSurfaceTertiary}
                  autoCapitalize="words"
                  testID="signed-name-input"
                />
                <Pressable style={styles.checkboxRow} onPress={() => setAccepted(!accepted)} testID="accept-checkbox">
                  <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
                    {accepted && <Ionicons name="checkmark" size={14} color={THEME.onBrandPrimary} />}
                  </View>
                  <Text style={styles.checkboxText}>I read the terms above and consent to TaxPilot processing my tax information as described.</Text>
                </Pressable>
                {err && <Text style={styles.err}>{err}</Text>}
                <Pressable style={[styles.signBtn, (!accepted || !signedName.trim()) && { opacity: 0.5 }]} onPress={sign} disabled={busy || !accepted || !signedName.trim()} testID="sign-consent-btn">
                  {busy ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                    <>
                      <Ionicons name="checkmark-done" size={16} color={THEME.onBrandPrimary} />
                      <Text style={styles.signBtnText}>Sign consent</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  content: { padding: SPACING.lg, paddingBottom: 40, gap: SPACING.md },
  statusCard: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.lg, backgroundColor: THEME.warning + '18', borderRadius: RADIUS.md, alignItems: 'center' },
  statusCardOk: { backgroundColor: THEME.brandTertiary },
  statusTitle: { fontSize: 15, fontWeight: '700', color: THEME.onSurface },
  statusSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2, lineHeight: 17 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACING.md },
  card: { padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, gap: SPACING.sm },
  cardText: { fontSize: 13, color: THEME.onSurface, lineHeight: 19 },
  bulletRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: THEME.brandPrimary, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, color: THEME.onSurface, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACING.sm },
  input: { backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, fontSize: 15, color: THEME.onSurface },
  checkboxRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', marginTop: SPACING.md },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: THEME.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: THEME.brandPrimary, borderColor: THEME.brandPrimary },
  checkboxText: { flex: 1, fontSize: 13, color: THEME.onSurface, lineHeight: 19 },
  err: { color: THEME.error, fontSize: 12, marginTop: SPACING.sm },
  signBtn: { flexDirection: 'row', gap: SPACING.sm, backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.lg },
  signBtnText: { color: THEME.onBrandPrimary, fontSize: 15, fontWeight: '600' },
  signedCard: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.md, backgroundColor: THEME.brandTertiary, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.sm },
  signedLabel: { fontSize: 13, fontWeight: '700', color: THEME.brandPrimary },
  signedTime: { fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: 2 },
  revokeBtn: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: THEME.error + '55', marginTop: SPACING.md, backgroundColor: THEME.surfaceSecondary },
  revokeText: { color: THEME.error, fontSize: 14, fontWeight: '600' },
});
