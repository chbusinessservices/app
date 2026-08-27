import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Extraction = {
  document_id: string;
  doc_type: string;
  fields: { label: string; value: string; confidence: number }[];
  summary: string;
  needs_review: boolean;
};

type Doc = { document_id: string; filename: string; doc_type: string; status: string; uploaded_at: string; extraction?: Extraction };

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [loading, setLoading] = useState(true);
  const [reExtracting, setReExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { load(); }, [id]);

  async function load() {
    if (!id) return;
    try {
      const d = await api<Doc>(`/documents/${id}`);
      setDoc(d);
      if (d.extraction) setExtraction(d.extraction as Extraction);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  }

  async function runExtract(model: 'claude-sonnet-5' | 'gpt-5.4') {
    setReExtracting(true);
    setErr(null);
    try {
      const r = await api<Extraction>(`/documents/${id}/extract?model=${model}`, { method: 'POST' });
      setExtraction(r);
    } catch (e: any) { setErr(e.message); }
    finally { setReExtracting(false); }
  }

  if (loading) return <View style={styles.loading}><ActivityIndicator color={THEME.brandPrimary} /></View>;
  if (!doc) return <View style={styles.loading}><Text>Not found</Text></View>;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{doc.doc_type}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.previewCard}>
          <Ionicons name="document-text" size={44} color={THEME.brandPrimary} />
          <Text style={styles.filename} numberOfLines={2}>{doc.filename}</Text>
          <Text style={styles.metaText}>Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}</Text>
        </View>

        <View style={styles.modelRow}>
          <Text style={styles.label}>AI model</Text>
          <View style={styles.modelChips}>
            <Pressable style={styles.modelChip} onPress={() => runExtract('claude-sonnet-5')} disabled={reExtracting} testID="model-claude-btn">
              <Text style={styles.modelChipText}>Claude Sonnet 5</Text>
            </Pressable>
            <Pressable style={styles.modelChip} onPress={() => runExtract('gpt-5.4')} disabled={reExtracting} testID="model-gpt-btn">
              <Text style={styles.modelChipText}>GPT 5.4</Text>
            </Pressable>
          </View>
        </View>

        {reExtracting && (
          <View style={styles.busy}>
            <ActivityIndicator color={THEME.brandPrimary} />
            <Text style={styles.busyText}>Re-extracting with AI…</Text>
          </View>
        )}
        {err && <Text style={styles.err}>{err}</Text>}

        {extraction ? (
          <>
            <View style={[styles.summaryCard, extraction.needs_review && styles.summaryCardWarn]}>
              <View style={styles.summaryHeader}>
                <Ionicons
                  name={extraction.needs_review ? 'warning' : 'checkmark-circle'}
                  size={20}
                  color={extraction.needs_review ? THEME.warning : THEME.success}
                />
                <Text style={[styles.summaryLabel, { color: extraction.needs_review ? THEME.warning : THEME.success }]}>
                  {extraction.needs_review ? 'Needs review' : 'AI extraction complete'}
                </Text>
              </View>
              <Text style={styles.summaryText}>{extraction.summary}</Text>
            </View>

            <Text style={styles.sectionTitle}>Extracted fields</Text>
            <View style={styles.fieldsCard}>
              {extraction.fields.map((f, i) => {
                const pct = Math.round(f.confidence * 100);
                const low = f.confidence < 0.80;
                return (
                  <View key={i} style={[styles.fieldRow, i > 0 && styles.fieldRowSep, low && styles.fieldRowLow]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{f.label}</Text>
                      <Text style={styles.fieldValue}>{f.value}</Text>
                    </View>
                    <View style={[styles.confPill, {
                      backgroundColor: low ? THEME.warning + '22' : THEME.brandTertiary,
                    }]}>
                      <Text style={[styles.confText, { color: low ? THEME.warning : THEME.brandPrimary }]}>{pct}%</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.emptyExtract}>
            <Text style={styles.emptyExtractText}>Extraction pending. Choose a model above to run AI extraction.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  previewCard: { alignItems: 'center', backgroundColor: THEME.surfaceSecondary, padding: SPACING.xl, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: THEME.border, marginBottom: SPACING.lg },
  filename: { fontSize: 15, fontWeight: '600', color: THEME.onSurface, marginTop: SPACING.md, textAlign: 'center' },
  metaText: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 4 },
  modelRow: { marginBottom: SPACING.lg },
  label: { fontSize: 12, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.sm },
  modelChips: { flexDirection: 'row', gap: SPACING.sm },
  modelChip: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: THEME.brandTertiary },
  modelChipText: { color: THEME.brandPrimary, fontSize: 13, fontWeight: '600' },
  busy: { flexDirection: 'row', gap: SPACING.md, padding: SPACING.md, backgroundColor: THEME.brandTertiary, borderRadius: RADIUS.md, marginBottom: SPACING.md, alignItems: 'center' },
  busyText: { color: THEME.brandPrimary, fontWeight: '600' },
  err: { color: THEME.error, fontSize: 13, marginBottom: SPACING.md },
  summaryCard: { backgroundColor: THEME.brandTertiary, padding: SPACING.lg, borderRadius: RADIUS.md, marginBottom: SPACING.lg },
  summaryCardWarn: { backgroundColor: THEME.warning + '18' },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs },
  summaryLabel: { fontSize: 13, fontWeight: '700' },
  summaryText: { fontSize: 13, color: THEME.onSurface, lineHeight: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.md },
  fieldsCard: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: THEME.border, overflow: 'hidden' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg },
  fieldRowSep: { borderTopWidth: 1, borderTopColor: THEME.border },
  fieldRowLow: { backgroundColor: THEME.warning + '0F' },
  fieldLabel: { fontSize: 12, color: THEME.onSurfaceTertiary },
  fieldValue: { fontSize: 16, fontWeight: '600', color: THEME.onSurface, marginTop: 2 },
  confPill: { paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill },
  confText: { fontSize: 12, fontWeight: '700' },
  emptyExtract: { padding: SPACING.xl, alignItems: 'center' },
  emptyExtractText: { color: THEME.onSurfaceTertiary, textAlign: 'center' },
});
