import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Source = {
  source_id: string;
  publication: string;
  title: string;
  tax_years: number[];
  revision: string;
  revision_date: string;
  hash: string;
  official_url: string;
  status: 'approved' | 'superseded';
};

export default function Sources() {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ sources: Source[]; note: string }>('/sources');
      setSources(r.sources); setNote(r.note);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="sources-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Source registry</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.noteCard}>
            <Ionicons name="book" size={18} color={THEME.brandPrimary} />
            <Text style={styles.noteText}>{note}</Text>
          </View>

          {sources.map(s => (
            <Pressable
              key={s.source_id}
              style={[styles.card, s.status === 'superseded' && styles.cardOld]}
              onPress={() => Linking.openURL(s.official_url)}
              testID={`source-${s.source_id}`}
            >
              <View style={styles.cardHead}>
                <Text style={styles.pub}>{s.publication}</Text>
                <View style={[styles.statusPill, { backgroundColor: (s.status === 'approved' ? THEME.success : THEME.onSurfaceTertiary) + '22' }]}>
                  <Text style={[styles.statusText, { color: s.status === 'approved' ? THEME.success : THEME.onSurfaceTertiary }]}>{s.status}</Text>
                </View>
              </View>
              <Text style={styles.pubTitle}>{s.title}</Text>
              <View style={styles.metaRow}>
                <MetaChip icon="calendar" label={`Revision ${s.revision}`} />
                <MetaChip icon="time" label={s.revision_date} />
              </View>
              <View style={styles.metaRow}>
                <MetaChip icon="folder" label={`Tax years: ${s.tax_years.join(', ')}`} />
              </View>
              <View style={styles.hashRow}>
                <Ionicons name="finger-print" size={11} color={THEME.onSurfaceTertiary} />
                <Text style={styles.hashText} numberOfLines={1}>{s.hash}</Text>
                <Ionicons name="open-outline" size={12} color={THEME.brandPrimary} />
              </View>
            </Pressable>
          ))}

          <Text style={styles.footerNote}>Superseded publications are preserved so prior-year returns use prior-year authority.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetaChip({ icon, label }: any) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={11} color={THEME.brandPrimary} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  content: { padding: SPACING.lg, paddingBottom: 40, gap: SPACING.md },
  noteCard: { flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md, backgroundColor: THEME.brandTertiary, borderRadius: RADIUS.md, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 12, color: THEME.onSurface, lineHeight: 17 },
  card: { padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, gap: SPACING.xs },
  cardOld: { opacity: 0.7 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pub: { fontSize: 14, fontWeight: '700', color: THEME.brandPrimary },
  statusPill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  pubTitle: { fontSize: 13, color: THEME.onSurface, marginBottom: SPACING.xs },
  metaRow: { flexDirection: 'row', gap: SPACING.xs, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: THEME.brandTertiary, paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.pill },
  chipText: { fontSize: 11, color: THEME.brandPrimary, fontWeight: '600' },
  hashRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 4 },
  hashText: { flex: 1, fontSize: 11, color: THEME.onSurfaceTertiary, fontFamily: 'System' },
  footerNote: { textAlign: 'center', fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: SPACING.lg },
});
