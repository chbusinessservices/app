import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Doc = { document_id: string; filename: string; doc_type: string; status: string; uploaded_at: string };

const FILTERS = ['All', 'W-2', '1099-NEC', '1099-INT', 'K-1', 'Receipt', 'Prior-Year Return', 'Other'];

export default function Documents() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setDocs(await api<Doc[]>('/documents')); } catch {}
    setLoading(false); setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const list = filter === 'All' ? docs : docs.filter(d => d.doc_type === filter);

  return (
    <View style={styles.root} testID="documents-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: THEME.surface }}>
        <View style={styles.header}>
          <Text style={styles.title}>Document Vault</Text>
          <Pressable style={styles.addBtn} onPress={() => router.push('/upload')} testID="header-upload-btn">
            <Ionicons name="add" size={22} color={THEME.onBrandPrimary} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {FILTERS.map(f => (
            <Pressable
              key={f} onPress={() => setFilter(f)}
              style={[styles.chip, filter === f && styles.chipActive]}
              testID={`filter-chip-${f}`}
            >
              <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}><Ionicons name="folder-open-outline" size={40} color={THEME.brandPrimary} /></View>
          <Text style={styles.emptyTitle}>No documents yet</Text>
          <Text style={styles.emptyText}>Upload W-2s, 1099s, K-1s or receipts to get started.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.push('/upload')} testID="empty-upload-btn">
            <Text style={styles.emptyBtnText}>Scan document</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={d => d.document_id}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120, paddingTop: SPACING.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={THEME.brandPrimary} />}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.docRow}
              onPress={() => router.push(`/document/${item.document_id}`)}
              testID={`doc-row-${item.document_id}`}
            >
              <View style={styles.docIcon}><Ionicons name="document-text" size={20} color={THEME.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName} numberOfLines={1}>{item.filename}</Text>
                <View style={styles.docMeta}>
                  <Text style={styles.docType}>{item.doc_type}</Text>
                  <View style={styles.dot} />
                  <StatusPill status={item.status} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={THEME.onSurfaceTertiary} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    uploaded: { color: THEME.warning, label: 'Uploaded' },
    classified: { color: THEME.success, label: 'Classified' },
    expected: { color: THEME.onSurfaceTertiary, label: 'Missing' },
  };
  const s = map[status] || map.uploaded;
  return (
    <View style={[styles.pill, { backgroundColor: s.color + '22', borderColor: s.color + '55' }]}>
      <Text style={[styles.pillText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: 24, fontWeight: '700', color: THEME.onSurface },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  chipsScroll: { flexGrow: 0 },
  chipsRow: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.sm },
  chip: { height: 36, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.pill, backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: THEME.brandPrimary, borderColor: THEME.brandPrimary },
  chipText: { fontSize: 13, color: THEME.onSurfaceTertiary, fontWeight: '600' },
  chipTextActive: { color: THEME.onBrandPrimary },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: THEME.surfaceSecondary, padding: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border },
  docIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  docName: { fontSize: 15, fontWeight: '600', color: THEME.onSurface },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 4 },
  docType: { fontSize: 12, color: THEME.onSurfaceTertiary },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: THEME.onSurfaceTertiary },
  pill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.xs },
  emptyText: { fontSize: 14, color: THEME.onSurfaceTertiary, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 20 },
  emptyBtn: { backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, borderRadius: RADIUS.md },
  emptyBtnText: { color: THEME.onBrandPrimary, fontSize: 15, fontWeight: '600' },
});
