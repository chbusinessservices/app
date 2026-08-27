import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Handoff = {
  handoff_id: string;
  item_id: string;
  item_title?: string;
  docs_count: number;
  review_items_count: number;
  tax_year: number;
  cpa_email: string | null;
  status: string;
  comments: { text: string; at: string }[];
  created_at: string;
  updated_at?: string;
};

const STATUS_ORDER = ['generated', 'shared', 'opened', 'commented', 'closed'];

export default function Handoffs() {
  const router = useRouter();
  const [items, setItems] = useState<Handoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ handoffs: Handoff[] }>('/handoffs');
      setItems(r.handoffs);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function setStatus(id: string, status: string) {
    try {
      await api(`/handoffs/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      setItems(prev => prev.map(i => i.handoff_id === id ? { ...i, status } : i));
    } catch {}
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="handoffs-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Handoffs</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}><Ionicons name="paper-plane" size={40} color={THEME.brandPrimary} /></View>
          <Text style={styles.emptyTitle}>No handoffs yet</Text>
          <Text style={styles.emptyText}>When you generate a reviewer packet from a potential item, it appears here so you can follow up.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.handoff_id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          renderItem={({ item }) => {
            const open = expanded === item.handoff_id;
            const statusIdx = STATUS_ORDER.indexOf(item.status);
            return (
              <View style={styles.card} testID={`handoff-${item.handoff_id}`}>
                <Pressable style={styles.cardHead} onPress={() => setExpanded(open ? null : item.handoff_id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.item_title || item.item_id}</Text>
                    <Text style={styles.meta}>Tax year {item.tax_year} · {item.docs_count} docs · {item.review_items_count} audit entries</Text>
                    <Text style={styles.meta}>Sent to: {item.cpa_email || 'no CPA on file'}</Text>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={THEME.onSurfaceTertiary} />
                </Pressable>

                <View style={styles.pipeline}>
                  {STATUS_ORDER.map((s, i) => (
                    <View key={s} style={styles.stepWrap}>
                      <View style={[styles.stepDot, { backgroundColor: i <= statusIdx ? THEME.brandPrimary : THEME.border }]}>
                        {i <= statusIdx && <Ionicons name="checkmark" size={10} color={THEME.onBrandPrimary} />}
                      </View>
                      {i < STATUS_ORDER.length - 1 && (
                        <View style={[styles.stepLine, { backgroundColor: i < statusIdx ? THEME.brandPrimary : THEME.border }]} />
                      )}
                    </View>
                  ))}
                </View>
                <View style={styles.pipelineLabels}>
                  {STATUS_ORDER.map(s => (
                    <Text key={s} style={[styles.pipelineLabel, item.status === s && { color: THEME.brandPrimary, fontWeight: '700' }]}>{s}</Text>
                  ))}
                </View>

                {open && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
                    {STATUS_ORDER.map(s => (
                      <Pressable
                        key={s}
                        style={[styles.statusBtn, item.status === s && styles.statusBtnActive]}
                        onPress={() => setStatus(item.handoff_id, s)}
                        testID={`set-status-${item.handoff_id}-${s}`}
                      >
                        <Text style={[styles.statusBtnText, item.status === s && { color: THEME.onBrandPrimary }]}>{s}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  list: { padding: SPACING.lg, paddingBottom: 40 },
  card: { padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border },
  cardHead: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: THEME.onSurface },
  meta: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  pipeline: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, paddingHorizontal: 4 },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, height: 2, marginHorizontal: 2 },
  pipelineLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 4 },
  pipelineLabel: { fontSize: 9, color: THEME.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, width: 46, textAlign: 'center' },
  actions: { gap: SPACING.sm, paddingTop: SPACING.md },
  statusBtn: { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: THEME.brandTertiary },
  statusBtnActive: { backgroundColor: THEME.brandPrimary },
  statusBtnText: { fontSize: 12, fontWeight: '600', color: THEME.brandPrimary, textTransform: 'capitalize' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.xs },
  emptyText: { fontSize: 14, color: THEME.onSurfaceTertiary, textAlign: 'center', lineHeight: 20 },
});
