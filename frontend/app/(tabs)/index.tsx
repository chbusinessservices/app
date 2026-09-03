import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground, RefreshControl, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { api } from '@/src/api';

type Step = { key: string; name: string; description: string; completed: boolean };
type Status = { steps: Step[]; counts: { documents: number; classified: number; open_review: number }; estimated_savings_usd: number; estimated_time_saved_min: number };
type Refund = { status: 'estimated' | 'blocked' | 'insufficient_data'; amount: number | null; confidence_tier: string; blockers: { code: string; message: string }[]; disclaimer: string };
type Prefs = { tax_year: number; cpa_email: string | null; consent_7216: boolean; consent_7216_at: string | null; consent_7216_revoked_at: string | null; active_taxpayer_id: string | null };
type Taxpayer = { taxpayer_id: string; name: string; relationship: string };

const TAX_YEARS = [2025, 2024, 2023];

export default function Dashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [refund, setRefund] = useState<Refund | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [taxpayers, setTaxpayers] = useState<Taxpayer[]>([]);
  const [yearPicker, setYearPicker] = useState(false);
  const [tpPicker, setTpPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r, p, tps] = await Promise.all([
        api<Status>('/return/status'),
        api<Refund>('/refund/estimate'),
        api<Prefs>('/preferences'),
        api<Taxpayer[]>('/taxpayers'),
      ]);
      setStatus(s); setRefund(r); setPrefs(p); setTaxpayers(tps);
    } catch {}
    setLoading(false); setRefreshing(false);
  }, []);

  async function setTaxYear(year: number) {
    setYearPicker(false);
    try {
      const p = await api<Prefs>('/preferences', { method: 'POST', body: JSON.stringify({ tax_year: year }) });
      setPrefs(p);
    } catch {}
  }

  async function switchTaxpayer(id: string) {
    setTpPicker(false);
    try {
      await api(`/taxpayers/${id}/activate`, { method: 'POST' });
      await load();
    } catch {}
  }

  const activeTaxpayer = taxpayers.find(t => t.taxpayer_id === prefs?.active_taxpayer_id) || taxpayers[0];

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function seedDemo() {
    setSeeding(true);
    try { await api('/demo/seed', { method: 'POST' }); await load(); } catch {}
    setSeeding(false);
  }

  const activeIdx = status ? Math.max(0, status.steps.findIndex(s => !s.completed)) : 0;

  return (
    <View style={styles.root} testID="dashboard-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: THEME.surface }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => setTpPicker(true)} style={styles.tpPill} testID="taxpayer-pill">
              <Ionicons name="people-circle" size={14} color={THEME.brandPrimary} />
              <Text style={styles.tpName}>{activeTaxpayer?.name || 'Myself'}</Text>
              <Ionicons name="swap-horizontal" size={12} color={THEME.brandPrimary} />
            </Pressable>
            <Text style={styles.hi}>Hi, {user?.name || 'there'} 👋</Text>
            <Pressable onPress={() => setYearPicker(true)} style={styles.yearBtn} testID="tax-year-pill">
              <Ionicons name="calendar" size={12} color={THEME.brandPrimary} />
              <Text style={styles.brandTag}>Tax Year {prefs?.tax_year || 2025}</Text>
              <Ionicons name="chevron-down" size={12} color={THEME.brandPrimary} />
            </Pressable>
          </View>
          <Pressable style={styles.avatarBtn} onPress={() => router.push('/(tabs)/profile')} testID="header-avatar-btn">
            <Text style={styles.avatarText}>{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={THEME.brandPrimary} />}
      >
        {loading ? (
          <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
        ) : (
          <>
            <ImageBackground
              source={{ uri: 'https://images.unsplash.com/photo-1675251171768-5d49233cc410?crop=entropy&cs=srgb&fm=jpg&w=1200&q=80' }}
              imageStyle={{ borderRadius: RADIUS.lg, opacity: 0.9 }}
              style={styles.heroCard}
            >
              <LinearGradient colors={['rgba(44,66,51,0.85)', 'rgba(61,90,70,0.75)']} style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.lg }]} />
              <Text style={styles.heroKicker}>Return Draft Progress</Text>
              <Text style={styles.heroTitle}>Step {activeIdx + 1} of 7 · {status?.steps[activeIdx]?.name}</Text>
              <Text style={styles.heroSub}>{status?.steps[activeIdx]?.description}</Text>

              <View style={styles.progressRow}>
                {status?.steps.map((s, i) => (
                  <View key={s.key} style={[styles.progressDot, { backgroundColor: s.completed ? '#EAEFEA' : i === activeIdx ? '#FFFFFF' : 'rgba(255,255,255,0.35)' }]} />
                ))}
              </View>

              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>${status?.estimated_savings_usd}</Text>
                  <Text style={styles.heroStatLabel}>Est. savings</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>~{Math.round((status?.estimated_time_saved_min || 0) / 60)}h</Text>
                  <Text style={styles.heroStatLabel}>Time saved</Text>
                </View>
              </View>
            </ImageBackground>

            <View style={styles.quickRow}>
              <QuickCard testID="quick-upload" icon="cloud-upload" label="Upload doc" onPress={() => router.push('/upload')} />
              <QuickCard testID="quick-review" icon="alert-circle" label="Review queue" badge={status?.counts.open_review || 0} onPress={() => router.push('/(tabs)/review')} />
            </View>
            <View style={styles.quickRow}>
              <QuickCard testID="quick-chat" icon="chatbubbles" label="Tax assistant" onPress={() => router.push('/chat')} />
              <QuickCard testID="quick-deductions" icon="sparkles" label="Potential items" onPress={() => router.push('/deductions')} />
            </View>
            <View style={styles.quickRow}>
              <QuickCard testID="quick-demo" icon="play-circle" label="Try demo" onPress={() => router.push('/demo')} />
              <QuickCard testID="quick-vault" icon="folder-open" label={`Vault · ${status?.counts.documents || 0}`} onPress={() => router.push('/(tabs)/documents')} />
            </View>
            <View style={styles.quickRow}>
              <QuickCard testID="quick-validation" icon="shield-checkmark" label="Tax validator" onPress={() => router.push('/validation')} />
              <QuickCard testID="quick-sources" icon="book" label="Sources" onPress={() => router.push('/sources')} />
            </View>

            <Text style={styles.sectionTitle}>Refund estimate</Text>
            <View style={styles.refundCard} testID="refund-card">
              {refund?.status === 'estimated' ? (
                <>
                  <View style={styles.refundHead}>
                    <Ionicons name="cash" size={18} color={THEME.success} />
                    <Text style={styles.refundLabel}>Preliminary estimate</Text>
                    <View style={styles.tierPill}><Text style={styles.tierText}>{refund.confidence_tier} confidence</Text></View>
                  </View>
                  <Text style={styles.refundAmount}>${refund.amount?.toLocaleString()}</Text>
                  <Text style={styles.refundDisclaimer}>{refund.disclaimer}</Text>
                </>
              ) : (
                <>
                  <View style={styles.refundHead}>
                    <Ionicons name={refund?.status === 'blocked' ? 'lock-closed' : 'hourglass'} size={18} color={THEME.warning} />
                    <Text style={styles.refundLabel}>{refund?.status === 'blocked' ? 'Estimate blocked' : 'Not enough data yet'}</Text>
                  </View>
                  <Text style={styles.refundAmountBlocked}>—</Text>
                  {refund?.blockers.map((b, i) => (
                    <View key={i} style={styles.blockerRow}>
                      <View style={styles.blockerDot} />
                      <Text style={styles.blockerText}>{b.message}</Text>
                    </View>
                  ))}
                  <Text style={styles.refundDisclaimer}>Refund estimates are blocked until low-confidence fields and open review items are resolved.</Text>
                </>
              )}
            </View>

            <Text style={styles.sectionTitle}>The workflow</Text>
            <View style={styles.pipelineCard}>
              {status?.steps.map((s, i) => (
                <View key={s.key} style={styles.stepRow}>
                  <View style={[styles.stepIdx, { backgroundColor: s.completed ? THEME.brandPrimary : THEME.brandTertiary }]}>
                    {s.completed
                      ? <Ionicons name="checkmark" size={14} color="#FFF" />
                      : <Text style={[styles.stepIdxText, { color: THEME.brandPrimary }]}>{i + 1}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepName}>{s.name}</Text>
                    <Text style={styles.stepDesc}>{s.description}</Text>
                  </View>
                </View>
              ))}
            </View>

            {(status?.counts.documents || 0) === 0 && (
              <Pressable style={styles.seedBtn} onPress={seedDemo} disabled={seeding} testID="seed-demo-btn">
                {seeding ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                  <>
                    <Ionicons name="sparkles" size={16} color={THEME.onBrandPrimary} />
                    <Text style={styles.seedBtnText}>Load sample data</Text>
                  </>
                )}
              </Pressable>
            )}
            <View style={{ height: 100 }} />
          </>
        )}
      </ScrollView>

      <Modal transparent visible={yearPicker} animationType="fade" onRequestClose={() => setYearPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setYearPicker(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Select tax year</Text>
            <Text style={styles.modalSub}>Prior-year returns use prior-year IRS authority.</Text>
            {TAX_YEARS.map(y => (
              <Pressable key={y} style={[styles.yearRow, prefs?.tax_year === y && styles.yearRowActive]} onPress={() => setTaxYear(y)} testID={`year-${y}`}>
                <Text style={[styles.yearRowText, prefs?.tax_year === y && { color: THEME.brandPrimary, fontWeight: '700' }]}>{y}</Text>
                {prefs?.tax_year === y && <Ionicons name="checkmark" size={18} color={THEME.brandPrimary} />}
              </Pressable>
            ))}
            <Pressable onPress={() => { setYearPicker(false); router.push('/rules-diff'); }} style={styles.diffLink} testID="open-diff-btn">
              <Ionicons name="git-compare" size={14} color={THEME.brandPrimary} />
              <Text style={styles.diffLinkText}>Compare rules across years</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal transparent visible={tpPicker} animationType="fade" onRequestClose={() => setTpPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTpPicker(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Switch taxpayer</Text>
            <Text style={styles.modalSub}>Each taxpayer has isolated documents, review, and consent.</Text>
            {taxpayers.map(t => (
              <Pressable key={t.taxpayer_id} style={[styles.yearRow, prefs?.active_taxpayer_id === t.taxpayer_id && styles.yearRowActive]} onPress={() => switchTaxpayer(t.taxpayer_id)} testID={`switch-tp-${t.taxpayer_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.yearRowText, prefs?.active_taxpayer_id === t.taxpayer_id && { color: THEME.brandPrimary, fontWeight: '700' }]}>{t.name}</Text>
                  <Text style={styles.tpSub}>{t.relationship}</Text>
                </View>
                {prefs?.active_taxpayer_id === t.taxpayer_id && <Ionicons name="checkmark" size={18} color={THEME.brandPrimary} />}
              </Pressable>
            ))}
            <Pressable onPress={() => { setTpPicker(false); router.push('/taxpayers'); }} style={styles.diffLink} testID="manage-tp-btn">
              <Ionicons name="settings" size={14} color={THEME.brandPrimary} />
              <Text style={styles.diffLinkText}>Manage taxpayers</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function QuickCard({ icon, label, onPress, badge, testID }: any) {
  return (
    <Pressable style={styles.quickCard} onPress={onPress} testID={testID}>
      <View style={styles.quickIconBox}>
        <Ionicons name={icon} size={22} color={THEME.brandPrimary} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
      {badge ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  hi: { fontSize: 20, fontWeight: '700', color: THEME.onSurface },
  brandTag: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2, letterSpacing: 0.5 },
  avatarBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: THEME.onBrandPrimary, fontWeight: '700', fontSize: 16 },
  content: { padding: SPACING.lg },
  heroCard: { borderRadius: RADIUS.lg, padding: SPACING.xl, overflow: 'hidden', minHeight: 220, justifyContent: 'space-between' },
  heroKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, letterSpacing: 1.5, fontWeight: '600' },
  heroTitle: { color: '#FFF', fontSize: 24, fontWeight: '700', marginTop: SPACING.sm },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: SPACING.xs, lineHeight: 20 },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: SPACING.lg },
  progressDot: { flex: 1, height: 4, borderRadius: 2 },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.lg, gap: SPACING.lg },
  heroStat: {},
  heroStatVal: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  heroStatLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  heroDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.3)' },
  quickRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  quickCard: {
    flex: 1, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, padding: SPACING.lg,
    borderWidth: 1, borderColor: THEME.border, position: 'relative',
  },
  quickIconBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  quickLabel: { fontSize: 14, fontWeight: '600', color: THEME.onSurface },
  badge: { position: 'absolute', top: SPACING.md, right: SPACING.md, backgroundColor: THEME.error, borderRadius: RADIUS.pill, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: THEME.onSurface, marginTop: SPACING.xl, marginBottom: SPACING.md },
  pipelineCard: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: THEME.border, padding: SPACING.md },
  stepRow: { flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.md, alignItems: 'flex-start' },
  stepIdx: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepIdxText: { fontWeight: '700', fontSize: 12 },
  stepName: { fontSize: 14, fontWeight: '600', color: THEME.onSurface },
  stepDesc: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  seedBtn: { flexDirection: 'row', gap: SPACING.sm, backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xl },
  seedBtnText: { color: THEME.onBrandPrimary, fontWeight: '600', fontSize: 15 },
  refundCard: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: THEME.border },
  refundHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  refundLabel: { fontSize: 13, fontWeight: '600', color: THEME.onSurface, flex: 1 },
  tierPill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill, backgroundColor: THEME.brandTertiary },
  tierText: { fontSize: 10, fontWeight: '700', color: THEME.brandPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  refundAmount: { fontSize: 32, fontWeight: '700', color: THEME.success, marginBottom: SPACING.sm },
  refundAmountBlocked: { fontSize: 32, fontWeight: '700', color: THEME.onSurfaceTertiary, marginBottom: SPACING.sm },
  refundDisclaimer: { fontSize: 11, color: THEME.onSurfaceTertiary, lineHeight: 16, marginTop: SPACING.sm },
  blockerRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 4 },
  blockerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: THEME.warning, marginTop: 7 },
  blockerText: { flex: 1, fontSize: 12, color: THEME.onSurface, lineHeight: 17 },
  yearBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: THEME.brandTertiary, paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.pill, alignSelf: 'flex-start', marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  modalCard: { width: '100%', maxWidth: 340, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.lg },
  modalTitle: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  modalSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 4, marginBottom: SPACING.md },
  yearRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.md, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md, marginTop: 2 },
  yearRowActive: { backgroundColor: THEME.brandTertiary },
  yearRowText: { fontSize: 16, color: THEME.onSurface },
  tpPill: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: THEME.brandTertiary, paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill, alignSelf: 'flex-start', marginBottom: 6 },
  tpName: { fontSize: 12, fontWeight: '700', color: THEME.brandPrimary, letterSpacing: 0.3 },
  tpSub: { fontSize: 11, color: THEME.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  diffLink: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.md, marginTop: SPACING.sm, borderTopWidth: 1, borderTopColor: THEME.border },
  diffLinkText: { color: THEME.brandPrimary, fontSize: 13, fontWeight: '600' },
});
