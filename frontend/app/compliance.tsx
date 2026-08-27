import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';

const PRINCIPLES = [
  { icon: 'shield-checkmark', title: 'AI proposes, humans approve', body: 'TaxPilot never autonomously files or approves material tax positions. Every high-risk item routes to a human reviewer.' },
  { icon: 'book', title: 'Source-grounded answers', body: 'Answers cite authoritative IRS publications and form instructions. When no current authority is available, TaxPilot refuses instead of guessing.' },
  { icon: 'lock-closed', title: 'No hallucinated eligibility', body: 'Detecting a document does not confirm eligibility. Potential items must be reviewed against required facts and limitations before entering any return workflow.' },
  { icon: 'git-network', title: 'Versioned tax rules', body: 'IRS publications are treated as versioned data. Old rules are preserved, superseded rules are marked, and prior-year returns use prior-year authority.' },
  { icon: 'warning', title: 'Confidence gating', body: 'Low-confidence OCR fields and unresolved conflicts block downstream calculations (refund estimate, deductions, filing) until a human resolves them.' },
  { icon: 'finger-print', title: 'Biometrics as an inherence factor', body: 'Face ID / Touch ID unlock a device-stored session key. TaxPilot never receives, stores, or reconstructs biometric templates.' },
];

const BOUNDARY = {
  can: [
    'Classify and organize tax documents',
    'Extract fields with confidence scores',
    'Detect missing documents',
    'Draft preliminary calculations',
    'Surface potential deductions for review',
    'Route risky items to a human reviewer',
    'Maintain an immutable audit trail',
  ],
  cant: [
    'Guarantee a refund or "maximize" a return',
    'Decide a complex tax position without required facts',
    'File, e-file, or sign a return autonomously',
    'Treat a card tap as legal approval',
    'Train shared models on your tax data',
    'Answer when no current authority is available',
  ],
};

export default function Compliance() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="compliance-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Compliance & Guardrails</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>How TaxPilot AI stays safe: our operating principles, product boundary, and audit posture.</Text>

        <Text style={styles.sectionTitle}>Operating principles</Text>
        {PRINCIPLES.map((p, i) => (
          <View key={p.title} style={styles.card} testID={`principle-${i}`}>
            <View style={styles.cardIcon}><Ionicons name={p.icon as any} size={20} color={THEME.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{p.title}</Text>
              <Text style={styles.cardBody}>{p.body}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Product boundary</Text>
        <View style={styles.boundaryCard}>
          <View style={styles.boundaryCol}>
            <View style={styles.boundaryHeader}>
              <Ionicons name="checkmark-circle" size={16} color={THEME.success} />
              <Text style={[styles.boundaryLabel, { color: THEME.success }]}>TaxPilot CAN</Text>
            </View>
            {BOUNDARY.can.map((c, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bulletDot, { backgroundColor: THEME.success }]} />
                <Text style={styles.bulletText}>{c}</Text>
              </View>
            ))}
          </View>
          <View style={styles.boundaryDivider} />
          <View style={styles.boundaryCol}>
            <View style={styles.boundaryHeader}>
              <Ionicons name="close-circle" size={16} color={THEME.error} />
              <Text style={[styles.boundaryLabel, { color: THEME.error }]}>TaxPilot WON'T</Text>
            </View>
            {BOUNDARY.cant.map((c, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bulletDot, { backgroundColor: THEME.error }]} />
                <Text style={styles.bulletText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Audit posture</Text>
        <View style={styles.list}>
          <Row icon="git-commit" title="Immutable append-only log" sub="Every material AI answer, user edit, and reviewer decision is recorded" />
          <Row icon="document" title="Source-span citations" sub="Every rule cites a specific IRS publication section" />
          <Row icon="calendar" title="Tax-year versioning" sub="Prior-year returns use prior-year authority" />
          <Row icon="alert-circle" title="High-risk escalation" sub="Foreign income, amended returns, business use, phaseouts → human review" />
        </View>

        <Text style={styles.disclaimer}>
          TaxPilot AI is a product vision in preview. Nothing here files a return or transmits data to the IRS. Sample data only until deployed with production credentials.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, title, sub }: any) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={16} color={THEME.brandPrimary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  intro: { fontSize: 14, color: THEME.onSurfaceTertiary, lineHeight: 20, marginBottom: SPACING.lg },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACING.xl, marginBottom: SPACING.md },
  card: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, marginBottom: SPACING.sm },
  cardIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: THEME.onSurface, marginBottom: 2 },
  cardBody: { fontSize: 13, color: THEME.onSurfaceTertiary, lineHeight: 19 },
  boundaryCard: { flexDirection: 'row', backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, padding: SPACING.md },
  boundaryCol: { flex: 1, gap: SPACING.sm, padding: SPACING.sm },
  boundaryDivider: { width: 1, backgroundColor: THEME.border },
  boundaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACING.sm },
  boundaryLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletText: { flex: 1, fontSize: 12, color: THEME.onSurface, lineHeight: 17 },
  list: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: THEME.border, alignItems: 'center' },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '600', color: THEME.onSurface },
  rowSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  disclaimer: { fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: SPACING.xl, textAlign: 'center', lineHeight: 16 },
});
