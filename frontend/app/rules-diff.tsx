import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Change = { rule_id: string; topic: string; authority: string; from_value: string | null; to_value: string | null; change: 'changed' | 'unchanged' | 'added' | 'removed' };

const YEARS = [2025, 2024, 2023];

export default function RulesDiff() {
  const router = useRouter();
  const [fromYear, setFromYear] = useState(2025);
  const [toYear, setToYear] = useState(2024);
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);

  useEffect(() => {
    api<{ tax_year: number }>('/preferences').then(p => setFromYear(p.tax_year || 2025)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ changes: Change[] }>(`/rules/diff?from_year=${fromYear}&to_year=${toYear}`);
      setChanges(r.changes);
    } catch {}
    setLoading(false);
  }, [fromYear, toYear]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changed = changes.filter(c => c.change !== 'unchanged');
  const unchanged = changes.filter(c => c.change === 'unchanged');

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="rules-diff-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Prior-year diff</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.compareRow}>
        <Pressable style={styles.yearBox} onPress={() => setPicker('from')} testID="from-year-btn">
          <Text style={styles.yearBoxLabel}>From</Text>
          <Text style={styles.yearBoxVal}>{fromYear}</Text>
        </Pressable>
        <Ionicons name="arrow-forward" size={20} color={THEME.onSurfaceTertiary} />
        <Pressable style={styles.yearBox} onPress={() => setPicker('to')} testID="to-year-btn">
          <Text style={styles.yearBoxLabel}>To</Text>
          <Text style={styles.yearBoxVal}>{toYear}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statsRow}>
            <Stat label="Changed" value={changed.length} color={THEME.warning} />
            <Stat label="Unchanged" value={unchanged.length} color={THEME.success} />
            <Stat label="Total" value={changes.length} color={THEME.brandPrimary} />
          </View>

          {changed.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Changed</Text>
              {changed.map(c => <ChangeCard key={c.rule_id} c={c} />)}
            </>
          )}

          {unchanged.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Unchanged</Text>
              {unchanged.map(c => <ChangeCard key={c.rule_id} c={c} muted />)}
            </>
          )}

          <Text style={styles.footNote}>Rule values shown are illustrative for TaxPilot's rule engine. Verify against the cited IRS authority before use.</Text>
        </ScrollView>
      )}

      <Modal transparent visible={picker !== null} animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPicker(null)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Pick {picker === 'from' ? 'from' : 'to'} year</Text>
            {YEARS.map(y => (
              <Pressable
                key={y}
                style={styles.yearRow}
                onPress={() => { picker === 'from' ? setFromYear(y) : setToYear(y); setPicker(null); }}
                testID={`year-${picker}-${y}`}
              >
                <Text style={styles.yearRowText}>{y}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: any) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statVal, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ChangeCard({ c, muted }: { c: Change; muted?: boolean }) {
  const badgeColor = c.change === 'changed' ? THEME.warning : c.change === 'added' ? THEME.success : c.change === 'removed' ? THEME.error : THEME.onSurfaceTertiary;
  return (
    <View style={[styles.card, muted && { opacity: 0.6 }]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTopic}>{c.topic}</Text>
        <View style={[styles.badge, { backgroundColor: badgeColor + '22' }]}>
          <Text style={[styles.badgeText, { color: badgeColor }]}>{c.change}</Text>
        </View>
      </View>
      <Text style={styles.cardAuth}>{c.authority}</Text>
      <View style={styles.valuesRow}>
        <View style={styles.valBox}>
          <Text style={styles.valLabel}>From</Text>
          <Text style={styles.valText}>{c.from_value ?? '—'}</Text>
        </View>
        <Ionicons name="arrow-forward" size={14} color={THEME.onSurfaceTertiary} />
        <View style={styles.valBox}>
          <Text style={styles.valLabel}>To</Text>
          <Text style={[styles.valText, c.change === 'changed' && { color: THEME.brandPrimary, fontWeight: '700' }]}>{c.to_value ?? '—'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  compareRow: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.lg, alignItems: 'center', justifyContent: 'center' },
  yearBox: { flex: 1, backgroundColor: THEME.surfaceSecondary, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, alignItems: 'center' },
  yearBoxLabel: { fontSize: 11, color: THEME.onSurfaceTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  yearBoxVal: { fontSize: 24, fontWeight: '700', color: THEME.onSurface, marginTop: 4 },
  content: { padding: SPACING.lg, paddingBottom: 40, gap: SPACING.sm },
  statsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  statCard: { flex: 1, backgroundColor: THEME.surfaceSecondary, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  card: { padding: SPACING.md, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, gap: SPACING.xs },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTopic: { fontSize: 14, fontWeight: '700', color: THEME.onSurface, flex: 1 },
  badge: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  cardAuth: { fontSize: 11, color: THEME.brandPrimary },
  valuesRow: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  valBox: { flex: 1, backgroundColor: THEME.surface, padding: SPACING.sm, borderRadius: RADIUS.sm },
  valLabel: { fontSize: 10, color: THEME.onSurfaceTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },
  valText: { fontSize: 15, color: THEME.onSurface, marginTop: 2 },
  footNote: { fontSize: 11, color: THEME.onSurfaceTertiary, textAlign: 'center', marginTop: SPACING.lg },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.lg },
  modalTitle: { fontSize: 16, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.md },
  yearRow: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md },
  yearRowText: { fontSize: 16, color: THEME.onSurface },
});
