import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

const STEPS = [
  { key: 'upload', title: 'Upload your documents', desc: 'Drop in W-2s, 1099s, K-1s, receipts. Any format.' },
  { key: 'classify', title: 'Classify', desc: 'Documents are auto-classified and indexed by taxpayer + year.' },
  { key: 'extract', title: 'Extract', desc: 'Every figure gets a confidence score. Low-confidence fields are flagged.' },
  { key: 'review', title: 'Review', desc: 'Risky or ambiguous items route to a human reviewer with full context.' },
];

export default function Demo() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [seeding, setSeeding] = useState(false);

  async function finish() {
    setSeeding(true);
    try { await api('/demo/seed', { method: 'POST' }); router.replace('/(tabs)'); } catch {}
    setSeeding(false);
  }

  const s = STEPS[step];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="close" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Interactive demo</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.progressBar}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.progressSeg, { backgroundColor: i <= step ? THEME.brandPrimary : THEME.border }]} />
        ))}
      </View>

      <View style={styles.content}>
        <Text style={styles.stepNum}>Step {step + 1} of {STEPS.length}</Text>
        <Text style={styles.stepTitle}>{s.title}</Text>
        <Text style={styles.stepDesc}>{s.desc}</Text>

        <View style={styles.demoCard} testID={`demo-card-${step}`}>
          {step === 0 && (
            <View style={styles.sampleList}>
              <SampleRow icon="document-text" title="W-2 · Acme Corp" status="queued" />
              <SampleRow icon="document-text" title="1099-NEC · Freelance" status="queued" />
              <SampleRow icon="receipt" title="Receipts · Q2" status="queued" />
              <SampleRow icon="document" title="K-1 · Partnership" status="queued" />
            </View>
          )}
          {step === 1 && (
            <View style={styles.sampleList}>
              <SampleRow icon="document-text" title="W-2 · Acme Corp" status="classified" />
              <SampleRow icon="document-text" title="1099-NEC · Freelance" status="classified" />
              <SampleRow icon="receipt" title="Receipts · Q2" status="review" />
              <SampleRow icon="document" title="K-1 · Partnership" status="missing" />
            </View>
          )}
          {step === 2 && (
            <View style={{ gap: SPACING.md }}>
              <ExtractRow label="Wages, tips & other comp" value="$128,500" pct={99} />
              <ExtractRow label="Federal income tax withheld" value="$24,110" pct={98} />
              <ExtractRow label="1099-NEC nonemployee comp" value="$12,400" pct={96} />
              <ExtractRow label="Receipt total (Q2)" value="$3,280" pct={82} />
            </View>
          )}
          {step === 3 && (
            <View style={styles.reviewCard}>
              <View style={styles.reviewIcon}><Ionicons name="warning" size={22} color={THEME.warning} /></View>
              <Text style={styles.reviewTitle}>Route to human reviewer</Text>
              <Text style={styles.reviewText}>Low-confidence field ("Category" on Q2 receipts) and an expected but missing K-1 are queued for review — nothing filed until a human confirms.</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {step > 0 && (
            <Pressable style={styles.backBtn} onPress={() => setStep(step - 1)} testID="demo-back">
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          )}
          {step < STEPS.length - 1 ? (
            <Pressable style={styles.nextBtn} onPress={() => setStep(step + 1)} testID="demo-next">
              <Text style={styles.nextBtnText}>Next</Text>
              <Ionicons name="arrow-forward" size={16} color={THEME.onBrandPrimary} />
            </Pressable>
          ) : (
            <Pressable style={styles.nextBtn} onPress={finish} disabled={seeding} testID="demo-finish">
              {seeding ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                <>
                  <Text style={styles.nextBtnText}>Load into my app</Text>
                  <Ionicons name="sparkles" size={16} color={THEME.onBrandPrimary} />
                </>
              )}
            </Pressable>
          )}
        </View>
        <Text style={styles.disclaimer}>Sample data only. Nothing is extracted or e-filed.</Text>
      </View>
    </SafeAreaView>
  );
}

function SampleRow({ icon, title, status }: any) {
  const map: Record<string, { color: string; label: string }> = {
    queued: { color: THEME.onSurfaceTertiary, label: 'Queued' },
    classified: { color: THEME.success, label: 'Classified' },
    review: { color: THEME.warning, label: 'Needs review' },
    missing: { color: THEME.error, label: 'Expected · missing' },
  };
  const s = map[status];
  return (
    <View style={styles.sampleRow}>
      <View style={styles.sampleIcon}><Ionicons name={icon} size={16} color={THEME.brandPrimary} /></View>
      <Text style={styles.sampleTitle}>{title}</Text>
      <View style={[styles.samplePill, { backgroundColor: s.color + '22' }]}>
        <Text style={[styles.samplePillText, { color: s.color }]}>{s.label}</Text>
      </View>
    </View>
  );
}

function ExtractRow({ label, value, pct }: any) {
  const low = pct < 85;
  return (
    <View style={[styles.extractRow, low && { backgroundColor: THEME.warning + '18' }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.extractLabel}>{label}</Text>
        <Text style={styles.extractValue}>{value}</Text>
      </View>
      <View style={[styles.confPill, { backgroundColor: low ? THEME.warning + '22' : THEME.brandTertiary }]}>
        <Text style={[styles.confText, { color: low ? THEME.warning : THEME.brandPrimary }]}>{pct}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: THEME.onSurface },
  progressBar: { flexDirection: 'row', gap: 6, paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  content: { flex: 1, padding: SPACING.lg },
  stepNum: { fontSize: 12, fontWeight: '700', color: THEME.brandPrimary, letterSpacing: 1 },
  stepTitle: { fontSize: 26, fontWeight: '700', color: THEME.onSurface, marginTop: 4, marginBottom: SPACING.sm },
  stepDesc: { fontSize: 14, color: THEME.onSurfaceTertiary, lineHeight: 20, marginBottom: SPACING.xl },
  demoCard: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: THEME.border, flex: 1 },
  sampleList: { gap: SPACING.sm },
  sampleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, backgroundColor: THEME.surface, borderRadius: RADIUS.md },
  sampleIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  sampleTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: THEME.onSurface },
  samplePill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  samplePillText: { fontSize: 11, fontWeight: '700' },
  extractRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, backgroundColor: THEME.surface, borderRadius: RADIUS.md },
  extractLabel: { fontSize: 12, color: THEME.onSurfaceTertiary },
  extractValue: { fontSize: 15, fontWeight: '700', color: THEME.onSurface, marginTop: 2 },
  confPill: { paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill },
  confText: { fontSize: 12, fontWeight: '700' },
  reviewCard: { alignItems: 'center', padding: SPACING.lg },
  reviewIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: THEME.warning + '22', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  reviewTitle: { fontSize: 16, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.sm },
  reviewText: { fontSize: 13, color: THEME.onSurfaceTertiary, textAlign: 'center', lineHeight: 20 },
  footer: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  backBtn: { flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border },
  backBtnText: { color: THEME.onSurface, fontSize: 15, fontWeight: '600' },
  nextBtn: { flex: 1, flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.md, borderRadius: RADIUS.md, backgroundColor: THEME.brandPrimary },
  nextBtnText: { color: THEME.onBrandPrimary, fontSize: 15, fontWeight: '600' },
  disclaimer: { textAlign: 'center', color: THEME.onSurfaceTertiary, fontSize: 11, marginTop: SPACING.md },
});
