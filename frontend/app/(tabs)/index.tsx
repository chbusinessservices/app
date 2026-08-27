import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { api } from '@/src/api';

type Step = { key: string; name: string; description: string; completed: boolean };
type Status = { steps: Step[]; counts: { documents: number; classified: number; open_review: number }; estimated_savings_usd: number; estimated_time_saved_min: number };

export default function Dashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try { const s = await api<Status>('/return/status'); setStatus(s); } catch {}
    setLoading(false); setRefreshing(false);
  }, []);

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
          <View>
            <Text style={styles.hi}>Hi, {user?.name || 'there'} 👋</Text>
            <Text style={styles.brandTag}>TaxPilot AI · Tax Year 2025</Text>
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
              <QuickCard testID="quick-demo" icon="play-circle" label="Try demo" onPress={() => router.push('/demo')} />
              <QuickCard testID="quick-vault" icon="folder-open" label={`Vault · ${status?.counts.documents || 0}`} onPress={() => router.push('/(tabs)/documents')} />
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
});
