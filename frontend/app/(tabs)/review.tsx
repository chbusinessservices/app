import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Item = { review_id: string; title: string; reason: string; severity: string; status: string; created_at: string; document_id?: string };

export default function Review() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api<Item[]>('/review-queue')); } catch {}
    setLoading(false); setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(review_id: string, action: 'acknowledge' | 'skip') {
    try {
      await api(`/review-queue/${review_id}/action`, { method: 'POST', body: JSON.stringify({ action }) });
      setItems(prev => prev.filter(i => i.review_id !== review_id));
    } catch {}
  }

  return (
    <View style={styles.root} testID="review-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: THEME.surface }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Review Queue</Text>
            <Text style={styles.sub}>Human-in-the-loop for risky items</Text>
          </View>
          <View style={styles.count}>
            <Text style={styles.countText}>{items.length}</Text>
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}><Ionicons name="checkmark-circle" size={44} color={THEME.brandPrimary} /></View>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptyText}>No items need your review. TaxPilot will notify you when something needs attention.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.review_id}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={THEME.brandPrimary} />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`review-card-${item.review_id}`}>
              <View style={styles.cardTop}>
                <View style={[styles.sevBadge, { backgroundColor: item.severity === 'warning' ? THEME.warning + '22' : THEME.brandTertiary }]}>
                  <Ionicons
                    name={item.severity === 'warning' ? 'warning' : 'information-circle'}
                    size={14}
                    color={item.severity === 'warning' ? THEME.warning : THEME.brandPrimary}
                  />
                  <Text style={[styles.sevText, { color: item.severity === 'warning' ? THEME.warning : THEME.brandPrimary }]}>
                    {item.severity === 'warning' ? 'Needs review' : 'Missing'}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardReason}>{item.reason}</Text>
              <View style={styles.actions}>
                <Pressable style={styles.skipBtn} onPress={() => act(item.review_id, 'skip')} testID={`skip-${item.review_id}`}>
                  <Text style={styles.skipText}>Skip</Text>
                </Pressable>
                <Pressable style={styles.ackBtn} onPress={() => act(item.review_id, 'acknowledge')} testID={`ack-${item.review_id}`}>
                  <Ionicons name="checkmark" size={16} color={THEME.onBrandPrimary} />
                  <Text style={styles.ackText}>Acknowledge</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: 24, fontWeight: '700', color: THEME.onSurface },
  sub: { fontSize: 13, color: THEME.onSurfaceTertiary, marginTop: 2 },
  count: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  countText: { color: THEME.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: THEME.border },
  cardTop: { flexDirection: 'row', marginBottom: SPACING.md },
  sevBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill },
  sevText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.xs },
  cardReason: { fontSize: 14, color: THEME.onSurfaceTertiary, lineHeight: 20, marginBottom: SPACING.lg },
  actions: { flexDirection: 'row', gap: SPACING.md },
  skipBtn: { flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  skipText: { color: THEME.onSurface, fontSize: 14, fontWeight: '600' },
  ackBtn: { flex: 1, flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.brandPrimary },
  ackText: { color: THEME.onBrandPrimary, fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.xs },
  emptyText: { fontSize: 14, color: THEME.onSurfaceTertiary, textAlign: 'center', lineHeight: 20 },
});
